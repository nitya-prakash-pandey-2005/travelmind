"""/api/v1/platform/facts: public, tenant-free figures about what the platform is connected to
(for the landing and sign-in pages). Cached briefly in Redis."""

from collections import Counter

import structlog
from fastapi import APIRouter
from pydantic import BaseModel
from redis.exceptions import RedisError

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.fareintel.service import count_routes_with_history
from travelmind.offers.registry import supplier_statuses
from travelmind.reference.service import count_airports

log = structlog.get_logger()

FACTS_CACHE_KEY = "platform:facts"
FACTS_TTL_SECONDS = 300


class SupplierKindFacts(BaseModel):
    kind: str
    connected: int


class PlatformFacts(BaseModel):
    airports: int
    suppliers: list[SupplierKindFacts]
    routes_with_history: int


platform_router = APIRouter(prefix="/api/v1/platform", tags=["platform"])


@platform_router.get("/facts")
async def platform_facts_route(db: DbSession, redis: RedisClient) -> PlatformFacts:
    try:
        cached = await redis.get(FACTS_CACHE_KEY)
    except RedisError as exc:
        log.warning("platform_facts_cache_unavailable", error_type=type(exc).__name__)
        cached = None
    if cached is not None:
        return PlatformFacts.model_validate_json(cached)
    connected: Counter[str] = Counter()
    for supplier in supplier_statuses(get_settings()):
        connected[supplier.kind] += int(supplier.connected)
    facts = PlatformFacts(
        airports=await count_airports(db),
        suppliers=[SupplierKindFacts(kind=kind, connected=n) for kind, n in connected.items()],
        routes_with_history=await count_routes_with_history(db),
    )
    try:
        await redis.set(FACTS_CACHE_KEY, facts.model_dump_json(), ex=FACTS_TTL_SECONDS)
    except RedisError as exc:
        log.warning("platform_facts_cache_unavailable", error_type=type(exc).__name__)
    return facts
