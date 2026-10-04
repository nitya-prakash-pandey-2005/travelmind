"""Command Center endpoints: /api/v1/dashboard/*, /notifications, /onboarding and /search.

All signed-in and bound to the caller's agency. The figures come from `metrics`, which takes
"now" explicitly; here it is always the current time.
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, TypeAdapter
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.dashboard import metrics
from travelmind.dashboard.schemas import (
    ActivityOut,
    DeparturesOut,
    HealthRange,
    Kpi,
    MarketPulseOut,
    NotificationsOut,
    OnboardingOut,
    PipelineOut,
    Range,
    SearchOut,
    SummaryOut,
    SupplierHealthOut,
    TeamOut,
)
from travelmind.db import DbSession, releasing, utcnow
from travelmind.identity import service as identity_service
from travelmind.identity.deps import AuthedUser
from travelmind.readcache import (
    PublishesMarkedAgencyChanges,
    as_bytes,
    cached_agency_json,
    json_response,
    publish_agency_changes,
    schema_tag,
)
from travelmind.workspace.quotes import expire_overdue_quotes

__all__ = [
    "dashboard_router",
    "notifications_router",
    "onboarding_router",
    "search_router",
]

SEARCH_MIN_LENGTH = 2
SEARCH_TOO_SHORT_MESSAGE = f"Type at least {SEARCH_MIN_LENGTH} characters to search."
# Summary and pipeline are read through the agency's Redis cache (readcache): a write to the
# agency's workspace retires them at once. The summary's "searches" KPI is not cached: searches
# are frequent and change nothing else, so it is computed on every read (one indexed query), and
# searching never retires the cache. A miss commits its read before writing the cache, so no
# connection is held while Redis answers.
DASHBOARD_TTL_SECONDS = 30

dashboard_router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])
# Notifications and global search run lazy quote expiry, which marks the agency when it expired
# a quote. Marking notifications seen changes nothing the cache holds, so it doesn't bump.
notifications_router = APIRouter(
    prefix="/api/v1/notifications",
    tags=["notifications"],
    dependencies=[PublishesMarkedAgencyChanges],
)
onboarding_router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])
search_router = APIRouter(
    prefix="/api/v1/search", tags=["search"], dependencies=[PublishesMarkedAgencyChanges]
)

RangeQuery = Annotated[Range, Query(alias="range")]


async def _expire_first(db: AsyncSession, redis: Redis, agency_id: UUID, now: datetime) -> None:
    """Run lazy quote expiry before the cache read and keep it; if it changed any quote, the
    agency's cached entries are retired first. Commits, so no transaction is held open while
    the cache read waits."""
    await expire_overdue_quotes(db, agency_id, now=now)
    await db.commit()
    await publish_agency_changes(db, redis)


# Cached as JSON and served as is (readcache: "Serving stored bytes").
_KPIS = TypeAdapter(list[Kpi])
KPIS_TAG = schema_tag(list[Kpi])
PIPELINE_TAG = schema_tag(PipelineOut)


def summary_body(range_: Range, currency: str, cached_kpis: bytes, searches: Kpi) -> bytes:
    """The summary's JSON: `SummaryOut(range_, currency, [*cached_kpis, searches])`, built around
    the cached cards' JSON array without decoding it. The same bytes as
    `SummaryOut.model_dump_json(by_alias=True)`, as FastAPI sends it (tested)."""
    live = SummaryOut(range=range_, currency=currency, kpis=[searches])
    tail = live.model_dump_json(by_alias=True).encode()
    at = tail.index(b'"kpis":[') + len(b'"kpis":[')
    cards = cached_kpis.strip()[1:-1]
    return tail[:at] + cards + (b"," if cards else b"") + tail[at:]


@dashboard_router.get("/summary", response_model=SummaryOut)
async def summary_route(
    current: AuthedUser, db: DbSession, redis: RedisClient, range_: RangeQuery = "30d"
) -> Response:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    now = utcnow()
    searches = await metrics.searches_kpi(db, agency, range_, now=now)
    await _expire_first(db, redis, agency.id, now)
    # The windows are the agency's local days, so the local date is part of the key.
    today = now.astimezone(ZoneInfo(agency.timezone)).date().isoformat()

    async def load() -> bytes:
        kpis = await metrics.workspace_kpis(db, agency, range_, now=now)
        return _KPIS.dump_json(kpis, by_alias=True)

    cached = await cached_agency_json(
        redis,
        agency.id,
        ("kpis", range_, today, KPIS_TAG),
        DASHBOARD_TTL_SECONDS,
        releasing(db, load),
        encode=as_bytes,
        decode=as_bytes,
        cache="summary",
    )
    return json_response(summary_body(range_, agency.currency, cached, searches))


@dashboard_router.get("/pipeline", response_model=PipelineOut)
async def pipeline_route(current: AuthedUser, db: DbSession, redis: RedisClient) -> Response:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    await _expire_first(db, redis, agency.id, utcnow())

    async def load() -> bytes:
        return (await metrics.pipeline(db, agency)).model_dump_json(by_alias=True).encode()

    body = await cached_agency_json(
        redis,
        agency.id,
        (PIPELINE_TAG,),
        DASHBOARD_TTL_SECONDS,
        releasing(db, load),
        encode=as_bytes,
        decode=as_bytes,
        cache="pipeline",
    )
    return json_response(body)


@dashboard_router.get("/activity")
async def activity_route(
    current: AuthedUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=metrics.ACTIVITY_MAX)] = 20,
    before: datetime | None = None,
    before_id: UUID | None = None,
) -> ActivityOut:
    """`before` (and optionally `before_id`) are the last item's `occurred_at` (and `id`)."""
    if before is not None and before.tzinfo is None:
        before = before.replace(tzinfo=UTC)
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    return await metrics.activity(db, agency, limit=limit, before=before, before_id=before_id)


@dashboard_router.get("/market-pulse")
async def market_pulse_route(current: AuthedUser, db: DbSession) -> MarketPulseOut:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    return await metrics.market_pulse(db, agency, now=utcnow())


@dashboard_router.get("/supplier-health")
async def supplier_health_route(
    current: AuthedUser,
    db: DbSession,
    range_: Annotated[HealthRange, Query(alias="range")] = "24h",
) -> SupplierHealthOut:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    return await metrics.supplier_health(db, agency, range_, now=utcnow())


@dashboard_router.get("/team")
async def team_route(current: AuthedUser, db: DbSession, range_: RangeQuery = "30d") -> TeamOut:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    return await metrics.team(db, agency, range_, now=utcnow())


@dashboard_router.get("/departures")
async def departures_route(current: AuthedUser, db: DbSession) -> DeparturesOut:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    return await metrics.departures(db, agency, now=utcnow())


@onboarding_router.get("")
async def onboarding_route(current: AuthedUser, db: DbSession) -> OnboardingOut:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    return await metrics.onboarding(db, agency, get_settings())


@notifications_router.get("")
async def notifications_route(current: AuthedUser, db: DbSession) -> NotificationsOut:
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    out = await metrics.notifications(db, agency, current.id, now=utcnow())
    await db.commit()  # keep any lazy quote expiry
    return out


class NotificationsSeen(BaseModel):
    # The newest event the user was shown: later ones stay unread.
    until: datetime | None = None


@notifications_router.post("/seen", status_code=status.HTTP_204_NO_CONTENT)
async def notifications_seen_route(
    current: AuthedUser, db: DbSession, body: NotificationsSeen | None = None
) -> Response:
    until = body.until if body is not None else None
    if until is not None and until.tzinfo is None:
        until = until.replace(tzinfo=UTC)
    await identity_service.mark_notifications_seen(db, current.id, until=until)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@search_router.get("")
async def search_route(
    current: AuthedUser, db: DbSession, q: Annotated[str, Query(max_length=200)]
) -> SearchOut:
    query = q.strip()
    if len(query) < SEARCH_MIN_LENGTH:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, SEARCH_TOO_SHORT_MESSAGE)
    agency = await identity_service.get_agency_settings(db, current.agency_id)
    out = await metrics.global_search(db, agency, query, now=utcnow())
    await db.commit()  # keep any lazy quote expiry
    return out
