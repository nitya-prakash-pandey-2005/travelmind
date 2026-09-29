"""Recently returned offers, kept per agency so re-pricing never crosses tenants."""

from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

import structlog
from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.offers.models import FlightOffer

DEFAULT_TTL_SECONDS = 1800
MAX_TTL_SECONDS = 7200
MIN_TTL_SECONDS = 60
log = structlog.get_logger()


def _key(agency_id: UUID, offer_id: str) -> str:
    return f"offer:{agency_id}:{offer_id}"


def _ttl(offer: FlightOffer) -> int:
    if offer.expires_at is None:
        return DEFAULT_TTL_SECONDS
    seconds = int((offer.expires_at - datetime.now(UTC)).total_seconds())
    return max(MIN_TTL_SECONDS, min(MAX_TTL_SECONDS, seconds))


async def remember_offers(redis: Redis, agency_id: UUID, offers: Iterable[FlightOffer]) -> None:
    try:
        async with redis.pipeline(transaction=False) as pipe:
            for offer in offers:
                pipe.set(_key(agency_id, offer.id), offer.model_dump_json(), ex=_ttl(offer))
            await pipe.execute()
    except RedisError as exc:
        log.warning("offer_cache_unavailable", error=str(exc))


async def recall_offer(redis: Redis, agency_id: UUID, offer_id: str) -> FlightOffer | None:
    try:
        raw = await redis.get(_key(agency_id, offer_id))
    except RedisError as exc:
        log.warning("offer_cache_unavailable", error=str(exc))
        return None
    if raw is None:
        return None
    try:
        return FlightOffer.model_validate_json(raw)
    except ValidationError:
        return None
