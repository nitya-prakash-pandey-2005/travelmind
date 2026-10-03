"""Route fare intelligence: what one route has cost lately, read from fare history.

Fare history (`fare_snapshots`) is global market data, one traveller's one-way fare per row,
each in the currency it was observed in: a fare search shows (and records) prices in its origin's
currency (`display_currency_for`), so a route's figures are in that route currency, whatever the
agency's own currency is. They use that currency only, the given cabin, and the last
`WINDOW_DAYS` local days (today included, in the agency's time zone). They come from one family
of fares: "market" (live or cached) when the route has any, else "sandbox", else none (`family`
null, every list empty). `updated_at` (the family's latest observation) is truncated to the
agency's local hour, so other agencies' search times aren't visible to the second.

Percentiles and medians are Postgres `percentile_cont` (linear interpolation between the closest
ranks), rounded half-up to a whole minor unit: [1000, 2000, 3000, 4000] gives p25 1750, median
2500, p75 3250; [1001, 1002] gives a median of 1001.5, shown as 1002.

`your_searches` are the agency's own recent one-way, adults-only searches of the route in the
route currency (tenant data under RLS), each as one traveller's share of the cheapest offer.

Caching: the fare figures (`family`, `daily`, `by_days_out`, `carriers`, `updated_at`) are
tenant-free market data, cached in Redis for `ROUTE_FARES_TTL_SECONDS` under a key of origin,
destination, cabin, route currency, the agency's time zone and its local date (everything they
depend on). A new fare snapshot does not invalidate them: market figures up to five minutes old
are acceptable. `your_searches` is the agency's own data and is never cached.
"""

from collections.abc import Awaitable
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.cache import RedisClient
from travelmind.db import DbSession, utcnow
from travelmind.fareintel.service import PROVENANCES, Family
from travelmind.identity import service as identity_service
from travelmind.identity.deps import AuthedUser
from travelmind.offers.fx import display_currency_for
from travelmind.offers.models import Cabin
from travelmind.readcache import CACHE_PREFIX, cached_json
from travelmind.reference.service import get_airport_index

__all__ = [
    "CARRIERS_LIMIT",
    "ROUTE_FARES_TTL_SECONDS",
    "SEARCHES_LIMIT",
    "WINDOW_DAYS",
    "RouteFares",
    "RouteIntelOut",
    "route_currency",
    "route_intel",
    "routes_router",
]

WINDOW_DAYS = 60
ROUTE_FARES_TTL_SECONDS = 300
CARRIERS_LIMIT = 8
SEARCHES_LIMIT = 20
SAME_AIRPORTS_MESSAGE = "Origin and destination must be different airports."

DaysOutBucket = Literal["0-7", "8-21", "22-45", "46-90", "91+"]
BUCKETS: tuple[DaysOutBucket, ...] = ("0-7", "8-21", "22-45", "46-90", "91+")


class DailyFares(BaseModel):
    date: date
    p25_minor: int
    median_minor: int
    p75_minor: int
    samples: int


class DaysOutFares(BaseModel):
    bucket: DaysOutBucket
    median_minor: int
    samples: int


class CarrierFares(BaseModel):
    code: str
    samples: int
    median_minor: int


class RouteSearch(BaseModel):
    created_at: datetime
    cheapest_minor: int
    adults: int


class RouteFares(BaseModel):
    """The route's tenant-free fare figures (cached)."""

    family: Family | None
    daily: list[DailyFares]
    by_days_out: list[DaysOutFares]
    carriers: list[CarrierFares]
    updated_at: datetime | None


class RouteIntelOut(BaseModel):
    origin: str
    destination: str
    cabin: Cabin
    currency: str
    family: Family | None
    daily: list[DailyFares]
    by_days_out: list[DaysOutFares]
    carriers: list[CarrierFares]
    your_searches: list[RouteSearch]
    updated_at: datetime | None


def _minor(value: Any) -> int:
    """A percentile rounded half-up to a whole minor unit (Python's round() is half-to-even)."""
    return int(Decimal(str(value)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


# The route's fares in the route currency and window; `:provenances` picks one family.
_ROUTE = """
    FROM fare_snapshots
    WHERE origin = :origin AND destination = :destination
      AND cabin = :cabin AND currency = :currency AND observed_at >= :since
"""
_FAMILY_SQL = text(
    f"""
    SELECT max(observed_at) FILTER (WHERE provenance = ANY(:market)) AS market_at,
           max(observed_at) FILTER (WHERE provenance = ANY(:sandbox)) AS sandbox_at
    {_ROUTE}
    """
)
_DAILY_SQL = text(
    f"""
    SELECT (observed_at AT TIME ZONE :tz)::date AS day, count(*) AS samples,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY total_minor) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY total_minor) AS p50,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY total_minor) AS p75
    {_ROUTE} AND provenance = ANY(:provenances)
    GROUP BY 1
    ORDER BY 1
    """
)
_DAYS_OUT_SQL = text(
    f"""
    SELECT CASE WHEN days_to_departure <= 7 THEN 0
                WHEN days_to_departure <= 21 THEN 1
                WHEN days_to_departure <= 45 THEN 2
                WHEN days_to_departure <= 90 THEN 3
                ELSE 4 END AS bucket,
           count(*) AS samples,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY total_minor) AS p50
    {_ROUTE} AND provenance = ANY(:provenances)
    GROUP BY 1
    ORDER BY 1
    """
)
_CARRIERS_SQL = text(
    f"""
    SELECT carrier, count(*) AS samples,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY total_minor) AS p50
    {_ROUTE} AND provenance = ANY(:provenances) AND carrier IS NOT NULL
    GROUP BY carrier
    ORDER BY count(*) DESC, carrier
    LIMIT :limit
    """
)
# round(numeric) is half away from zero, i.e. half-up for these positive fares.
_SEARCHES_SQL = text(
    """
    SELECT created_at, round(cheapest_minor::numeric / adults) AS fare, adults
    FROM flight_searches
    WHERE agency_id = :agency AND origin = :origin AND destination = :destination
      AND cabin = :cabin AND return_date IS NULL AND children = 0 AND adults > 0
      AND display_currency = :currency AND cheapest_minor IS NOT NULL
    ORDER BY created_at DESC, id DESC
    LIMIT :limit
    """
)


def _local_hour(at: datetime, timezone: str) -> datetime:
    """`at` truncated to the start of its hour in the agency's time zone, in UTC."""
    local = at.astimezone(ZoneInfo(timezone))
    return local.replace(minute=0, second=0, microsecond=0).astimezone(UTC)


async def route_currency(db: AsyncSession, origin: str) -> str:
    """The currency a fare search from `origin` prices (and records) fares in."""
    airport = (await get_airport_index(db)).get(origin)
    if airport is None:
        raise ValueError(f"Unknown airport code {origin}.")
    return display_currency_for(airport.country_code)


def _window_start(now: datetime, timezone: str) -> datetime:
    """Local midnight starting the agency's last `WINDOW_DAYS` days, today included."""
    zone = ZoneInfo(timezone)
    first = now.astimezone(zone).date() - timedelta(days=WINDOW_DAYS - 1)
    return datetime.combine(first, time(), tzinfo=zone).astimezone(UTC)


async def _your_searches(
    db: AsyncSession, agency_id: UUID, params: dict[str, Any]
) -> list[RouteSearch]:
    rows = await db.execute(_SEARCHES_SQL, params | {"agency": agency_id, "limit": SEARCHES_LIMIT})
    return [
        RouteSearch(created_at=row.created_at, cheapest_minor=int(row.fare), adults=row.adults)
        for row in rows
    ]


async def _route_fares(db: AsyncSession, params: dict[str, Any], timezone: str) -> RouteFares:
    found = (
        await db.execute(
            _FAMILY_SQL,
            params
            | {"market": list(PROVENANCES["market"]), "sandbox": list(PROVENANCES["sandbox"])},
        )
    ).one()
    fares = RouteFares(family=None, daily=[], by_days_out=[], carriers=[], updated_at=None)
    if found.market_at is not None:
        fares.family, fares.updated_at = "market", _local_hour(found.market_at, timezone)
    elif found.sandbox_at is not None:
        fares.family, fares.updated_at = "sandbox", _local_hour(found.sandbox_at, timezone)
    if fares.family is None:
        return fares
    params = params | {"provenances": list(PROVENANCES[fares.family])}
    fares.daily = [
        DailyFares(
            date=row.day,
            p25_minor=_minor(row.p25),
            median_minor=_minor(row.p50),
            p75_minor=_minor(row.p75),
            samples=row.samples,
        )
        for row in await db.execute(_DAILY_SQL, params)
    ]
    fares.by_days_out = [
        DaysOutFares(bucket=BUCKETS[row.bucket], median_minor=_minor(row.p50), samples=row.samples)
        for row in await db.execute(_DAYS_OUT_SQL, params)
    ]
    fares.carriers = [
        CarrierFares(code=row.carrier, samples=row.samples, median_minor=_minor(row.p50))
        for row in await db.execute(_CARRIERS_SQL, params | {"limit": CARRIERS_LIMIT})
    ]
    return fares


async def route_intel(
    db: AsyncSession,
    agency_id: UUID,
    *,
    origin: str,
    destination: str,
    cabin: Cabin,
    now: datetime | None = None,
    redis: Redis | None = None,
) -> RouteIntelOut:
    """The route's fare figures for the agency (see the module docstring). The session must be
    bound to the agency; `origin` must be a known airport. With `redis`, the fare figures are
    read through the cache."""
    agency = await identity_service.get_agency_settings(db, agency_id)
    currency = await route_currency(db, origin)
    at = now or utcnow()
    params: dict[str, Any] = {
        "origin": origin,
        "destination": destination,
        "cabin": cabin,
        "currency": currency,
        "since": _window_start(at, agency.timezone),
        "tz": agency.timezone,
    }
    searches = await _your_searches(db, agency_id, params)

    def load() -> Awaitable[RouteFares]:
        return _route_fares(db, params, agency.timezone)

    if redis is None:
        fares = await load()
    else:
        today = at.astimezone(ZoneInfo(agency.timezone)).date().isoformat()
        parts = (origin, destination, cabin, currency, agency.timezone, today)
        fares = await cached_json(
            redis,
            f"{CACHE_PREFIX}route:" + ":".join(parts),
            ROUTE_FARES_TTL_SECONDS,
            load,
            encode=RouteFares.model_dump_json,
            decode=RouteFares.model_validate_json,
            cache="route_intel",
        )
    return RouteIntelOut(
        origin=origin,
        destination=destination,
        cabin=cabin,
        currency=currency,
        family=fares.family,
        daily=fares.daily,
        by_days_out=fares.by_days_out,
        carriers=fares.carriers,
        your_searches=searches,
        updated_at=fares.updated_at,
    )


async def _known_airport(db: AsyncSession, raw: str) -> str:
    code = raw.strip().upper()
    if (await get_airport_index(db)).get(code) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown airport code {code}.")
    return code


routes_router = APIRouter(prefix="/api/v1/routes", tags=["routes"])


@routes_router.get("/intel")
async def route_intel_route(
    current: AuthedUser,
    db: DbSession,
    redis: RedisClient,
    origin: Annotated[str, Query(min_length=1, max_length=10)],
    destination: Annotated[str, Query(min_length=1, max_length=10)],
    cabin: Cabin = "economy",
) -> RouteIntelOut:
    from_code = await _known_airport(db, origin)
    to_code = await _known_airport(db, destination)
    if from_code == to_code:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, SAME_AIRPORTS_MESSAGE)
    return await route_intel(
        db, current.agency_id, origin=from_code, destination=to_code, cabin=cabin, redis=redis
    )
