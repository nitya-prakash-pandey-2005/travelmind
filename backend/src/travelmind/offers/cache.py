"""Recently returned offers, kept per agency so re-pricing never crosses tenants.

Price checks and quote versions resolve an offer id the agency was shown back to the offer, so
an offer is kept as long as its supplier sells it (`expires_at`, bounded to 1 min - 2 h; 30 min
when the supplier doesn't say). Keeping it for less would refuse price checks and quote options
the supplier would still honour.

Size: an entry is the offer's JSON without computed fields (validation restores them),
zlib-compressed (about 650 bytes instead of 1.4 KB for a one-stop offer). Nulls are kept: a field
left out would come back as its default, which need not be None. Supplier offer ids can be long
(a sandbox id is about 250 characters), so an entry's key, and its member in the indexes below,
use a 128-bit digest of the id (`offer_key`); a recalled offer must carry the id asked for.
Entries written before this encoding (plain JSON, keyed by the raw id) are still read: a recall
asks for both keys in one MGET. That fallback can go once no such entry is left (they live 2 h at
most).

Bound: each agency keeps at most `max_offers_per_agency()` offers. Two sorted sets hold the
digests of the agency's offer ids:
- `offers:idx:<agency>`, scored by when the offer was stored (Redis `TIME`, in microseconds,
  strictly increasing per agency). Storing past the cap drops the offers stored longest ago, but
  never one of the search being stored: its price checks and quote versions are about to need
  them. A single search bigger than the cap is kept whole (and drops every older offer).
- `offers:exp:<agency>`, scored by expiry (Redis `TIME` plus the TTL, in seconds). Offers past
  their expiry (their entries have lapsed already) leave both sets first, so they don't count
  against the cap.
A store refreshes an offer stored again (a price check) in both sets. Members of
`offers:idx:<agency>` written before these two sets were scored by expiry in seconds, so they
rank as the oldest and are the first to go.

One Lua script stores a search's offers, updates both sets and applies the cap in one round
trip, atomically. It deletes the dropped offers' keys, which it can't declare up front: fine on
a single Redis, not on Redis Cluster.
"""

import base64
import hashlib
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

# KEYS: the agency's insertion index, its expiry index. ARGV: key prefix, cap, then
# (id, ttl, value) triples. Returns how many older offers the cap dropped.
_REMEMBER = """
local inserted, expiry = KEYS[1], KEYS[2]
local prefix, cap = ARGV[1], tonumber(ARGV[2])
local clock = redis.call('TIME')
local now = tonumber(clock[1])
local stamp = now * 1000000 + tonumber(clock[2])
local newest = redis.call('ZRANGE', inserted, -1, -1, 'WITHSCORES')
if newest[2] and tonumber(newest[2]) >= stamp then stamp = tonumber(newest[2]) + 1 end
local batch, size, longest = {}, 0, 0
for i = 3, #ARGV, 3 do
    local id, ttl = ARGV[i], tonumber(ARGV[i + 1])
    redis.call('SET', prefix .. id, ARGV[i + 2], 'EX', ttl)
    redis.call('ZADD', inserted, stamp, id)
    redis.call('ZADD', expiry, now + ttl, id)
    if not batch[id] then batch[id] = true; size = size + 1 end
    if ttl > longest then longest = ttl end
end
local expired = redis.call('ZRANGEBYSCORE', expiry, '-inf', now)
for _, id in ipairs(expired) do
    redis.call('ZREM', inserted, id)
end
redis.call('ZREMRANGEBYSCORE', expiry, '-inf', now)
local over = redis.call('ZCARD', inserted) - cap
local dropped = 0
if over > 0 then
    for _, id in ipairs(redis.call('ZRANGE', inserted, 0, over + size - 1)) do
        if dropped == over then break end
        if not batch[id] then
            redis.call('DEL', prefix .. id)
            redis.call('ZREM', inserted, id)
            redis.call('ZREM', expiry, id)
            dropped = dropped + 1
        end
    end
end
for _, key in ipairs(KEYS) do
    if redis.call('TTL', key) < longest then redis.call('EXPIRE', key, longest) end
end
return dropped
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


def _expiry_index(agency_id: UUID) -> str:
    return f"offers:exp:{agency_id}"


def max_offers_per_agency() -> int:
    return get_settings().offer_store_max_per_agency


def _ttl(offer: FlightOffer) -> int:
    if offer.expires_at is None:
        return DEFAULT_TTL_SECONDS
    seconds = int((offer.expires_at - datetime.now(UTC)).total_seconds())
    return max(MIN_TTL_SECONDS, min(MAX_TTL_SECONDS, seconds))


def encode_offer(offer: FlightOffer) -> bytes:
    """Computed fields are left out (validation restores them); nulls are kept."""
    json = offer.model_dump_json(exclude_computed_fields=True)
    return zlib.compress(json.encode(), COMPRESSION_LEVEL)


def decode_offer(raw: bytes) -> FlightOffer | None:
    """The stored offer, or None for an entry this code can't read."""
    try:
        json = raw if raw.startswith(b"{") else zlib.decompress(raw)
        return FlightOffer.model_validate_json(json)
    except (zlib.error, ValidationError):
        return None


async def remember_offers(redis: Redis, agency_id: UUID, offers: Iterable[FlightOffer]) -> None:
    args: list[Any] = [f"offer:{agency_id}:", max_offers_per_agency()]
    for offer in offers:
        args += [_digest(offer.id), _ttl(offer), encode_offer(offer)]
    if len(args) == 2:
        return
    keys = (_index(agency_id), _expiry_index(agency_id))
    try:
        dropped = await cast(Awaitable[int], redis.eval(_REMEMBER, len(keys), *keys, *args))
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
