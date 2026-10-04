"""Recently returned offers, kept per agency so re-pricing never crosses tenants.

Price checks and quote versions resolve an offer id the agency was shown back to the offer, so
an offer is kept as long as its supplier sells it (`expires_at`, bounded to 1 min - 2 h; 30 min
when the supplier doesn't say). Keeping it for less would refuse price checks and quote options
the supplier would still honour.

Size: an entry is the offer's JSON without nulls and computed fields, zlib-compressed (about
550 bytes instead of 1.4 KB for a one-stop offer). Supplier offer ids can be long (a sandbox id
is about 250 characters), so an entry's key, and its member in the index below, use a 128-bit
digest of the id (`offer_key`); a recalled offer must carry the id asked for. Entries written
before this encoding (plain JSON, keyed by the raw id) are still read: a recall asks for both
keys in one MGET. That fallback can go once no such entry is left (they live 2 h at most).

Bound: each agency keeps at most `max_offers_per_agency()` offers. `offers:idx:<agency>` holds
the digests of the agency's offer ids, scored by expiry; storing past the cap drops the offers
that expire soonest (in practice the oldest search's). One Lua script stores a search's offers,
updates the index and applies the cap in one round trip. It deletes the dropped offers' keys,
which it can't declare up front: fine on a single Redis, not on Redis Cluster.
"""

import base64
import hashlib
import time
import zlib
from collections.abc import Awaitable, Iterable
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

import structlog
from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.config import get_settings
from travelmind.offers.models import FlightOffer

DEFAULT_TTL_SECONDS = 1800
MAX_TTL_SECONDS = 7200
MIN_TTL_SECONDS = 60
COMPRESSION_LEVEL = 6
log = structlog.get_logger()

# KEYS[1]: the agency's index. ARGV: key prefix, now (unix s), cap, then (id, ttl, value) triples.
_REMEMBER = """
local index, prefix = KEYS[1], ARGV[1]
local now, cap = tonumber(ARGV[2]), tonumber(ARGV[3])
local longest = 0
for i = 4, #ARGV, 3 do
    local id, ttl = ARGV[i], tonumber(ARGV[i + 1])
    redis.call('SET', prefix .. id, ARGV[i + 2], 'EX', ttl)
    redis.call('ZADD', index, now + ttl, id)
    if ttl > longest then longest = ttl end
end
redis.call('ZREMRANGEBYSCORE', index, '-inf', now)
local over = redis.call('ZCARD', index) - cap
if over > 0 then
    for _, id in ipairs(redis.call('ZRANGE', index, 0, over - 1)) do
        redis.call('DEL', prefix .. id)
    end
    redis.call('ZREMRANGEBYRANK', index, 0, over - 1)
end
if redis.call('TTL', index) < longest then
    redis.call('EXPIRE', index, longest)
end
return math.max(over, 0)
"""


def _digest(offer_id: str) -> str:
    raw = hashlib.blake2b(offer_id.encode(), digest_size=16).digest()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def offer_key(agency_id: UUID, offer_id: str) -> str:
    return f"offer:{agency_id}:{_digest(offer_id)}"


def _legacy_key(agency_id: UUID, offer_id: str) -> str:
    return f"offer:{agency_id}:{offer_id}"


def _index(agency_id: UUID) -> str:
    return f"offers:idx:{agency_id}"


def max_offers_per_agency() -> int:
    return get_settings().offer_store_max_per_agency


def _ttl(offer: FlightOffer) -> int:
    if offer.expires_at is None:
        return DEFAULT_TTL_SECONDS
    seconds = int((offer.expires_at - datetime.now(UTC)).total_seconds())
    return max(MIN_TTL_SECONDS, min(MAX_TTL_SECONDS, seconds))


def encode_offer(offer: FlightOffer) -> bytes:
    """Nulls and computed fields are left out: validation restores both."""
    json = offer.model_dump_json(exclude_none=True, exclude_computed_fields=True)
    return zlib.compress(json.encode(), COMPRESSION_LEVEL)


def decode_offer(raw: bytes) -> FlightOffer | None:
    """The stored offer, or None for an entry this code can't read."""
    try:
        json = raw if raw.startswith(b"{") else zlib.decompress(raw)
        return FlightOffer.model_validate_json(json)
    except (zlib.error, ValidationError):
        return None


async def remember_offers(redis: Redis, agency_id: UUID, offers: Iterable[FlightOffer]) -> None:
    args: list[Any] = [f"offer:{agency_id}:", int(time.time()), max_offers_per_agency()]
    for offer in offers:
        args += [_digest(offer.id), _ttl(offer), encode_offer(offer)]
    if len(args) == 3:
        return
    try:
        dropped = await cast(Awaitable[int], redis.eval(_REMEMBER, 1, _index(agency_id), *args))
    except RedisError as exc:
        log.warning("offer_cache_unavailable", error_type=type(exc).__name__)
        return
    if dropped:
        log.info("offer_cache_capped", agency_id=str(agency_id), dropped=dropped)


async def recall_offer(redis: Redis, agency_id: UUID, offer_id: str) -> FlightOffer | None:
    try:
        current, legacy = await redis.mget(
            offer_key(agency_id, offer_id), _legacy_key(agency_id, offer_id)
        )
    except RedisError as exc:
        log.warning("offer_cache_unavailable", error_type=type(exc).__name__)
        return None
    raw = current if current is not None else legacy
    offer = decode_offer(raw) if raw is not None else None
    return offer if offer is not None and offer.id == offer_id else None
