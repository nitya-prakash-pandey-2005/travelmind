"""Seed fare history with Travelpayouts cached prices (indications only — never bookable).

Seeding is best-effort and never raises: an HTTP, Redis, parse or database failure adds nothing.
After a failed fetch or save, a marker makes callers skip Travelpayouts for FAILURE_TTL_SECONDS so
a search never waits on a service that is down. The token travels in a header and is never logged:
errors are logged by status or exception type only, never with the exception text.
"""

import asyncio
import re
from datetime import UTC, date, datetime

import httpx
import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.fareintel.models import FareSnapshot
from travelmind.offers.money import Money

TP_PRICES_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"
SEED_TTL_SECONDS = 24 * 3600
CLAIM_TTL_SECONDS = 60  # one search fetches a route while concurrent ones skip it
FAILURE_KEY = "tp:down"
FAILURE_TTL_SECONDS = 300
FETCH_TIMEOUT = httpx.Timeout(3.0, connect=1.0)  # runs inside a search request
FETCH_DEADLINE_SECONDS = 3.0  # caps the whole call; httpx timeouts are per phase
_MAX_PRICE = 10**9  # major units; far beyond any real fare, and keeps totals in a BIGINT
_MAX_STOPS = 10
_CARRIER = re.compile(r"[A-Z0-9]{2,3}")
_CURRENCY = re.compile(r"[A-Z]{3}")
log = structlog.get_logger()


class _Unusable(ValueError):
    """A Travelpayouts response we can't trust."""


def _items(payload: object, currency: str) -> list[object]:
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise _Unusable("unsuccessful response")
    reported = payload.get("currency")
    if not isinstance(reported, str) or reported.lower() != currency.lower():
        raise _Unusable("prices are not in the requested currency")
    items = payload.get("data")
    if not isinstance(items, list):
        raise _Unusable("data is not a list")
    return items


def _snapshot(
    item: object, *, origin: str, destination: str, currency: str, today: date
) -> FareSnapshot | None:
    """One cached fare as a snapshot, or `None` when its price or departure is unusable."""
    if not isinstance(item, dict):
        return None
    price, departing = item.get("price"), item.get("departure_at")
    if isinstance(price, bool) or not isinstance(price, int | float):
        return None
    if not 0 < price < _MAX_PRICE:  # also rejects NaN and infinities
        return None
    if not isinstance(departing, str):
        return None
    try:
        day = datetime.fromisoformat(departing).date()
    except ValueError:
        return None
    days_out = (day - today).days
    try:
        total = Money.from_decimal(price, currency).amount_minor
    except ValueError:  # includes pydantic's ValidationError
        return None
    if days_out < 0 or total <= 0:
        return None
    airline, transfers = item.get("airline"), item.get("transfers")
    carrier = airline if isinstance(airline, str) and _CARRIER.fullmatch(airline) else None
    usable_stops = (
        isinstance(transfers, int)
        and not isinstance(transfers, bool)
        and 0 <= transfers <= _MAX_STOPS
    )
    return FareSnapshot(
        origin=origin,
        destination=destination,
        departure_date=day,
        days_to_departure=days_out,
        cabin="economy",
        carrier=carrier,
        stops=transfers if usable_stops else None,
        total_minor=total,
        currency=currency,
        provenance="CACHED",
        source="travelpayouts",
    )


async def _back_off(redis: Redis) -> None:
    try:
        await redis.set(FAILURE_KEY, "1", ex=FAILURE_TTL_SECONDS)
    except RedisError as exc:
        log.warning("travelpayouts_cache_unavailable", error_type=type(exc).__name__)


async def seed_route(
    db: AsyncSession,
    redis: Redis,
    *,
    token: str,
    origin: str,
    destination: str,
    departure_date: date,
    currency: str,
    market: str,
) -> int:
    """Add CACHED economy snapshots for the route's departure month; returns how many were added.

    Runs at most once per route, month and currency every SEED_TTL_SECONDS: the first caller
    claims the route with SET NX, so concurrent searches never fetch it twice. Rows are written in
    a savepoint, so a database error never spoils the caller's transaction.
    """
    currency = currency.strip().upper()
    if not _CURRENCY.fullmatch(currency):
        log.warning("travelpayouts_skipped", reason="unusable currency code")
        return 0
    month = departure_date.strftime("%Y-%m")
    key = f"tp:seed:{origin}{destination}:{month}:{currency}"
    try:
        if await redis.exists(FAILURE_KEY):
            return 0
        if not await redis.set(key, "1", nx=True, ex=CLAIM_TTL_SECONDS):
            return 0  # seeded recently, or another search is seeding it right now
    except RedisError as exc:
        # Without the cache we can't rate-limit ourselves, so skip seeding this time.
        log.warning("travelpayouts_cache_unavailable", error_type=type(exc).__name__)
        return 0
    params = {
        "origin": origin,
        "destination": destination,
        "departure_at": month,
        "one_way": "true",
        "currency": currency.lower(),
        "market": market,
        "limit": "100",
        "sorting": "price",
    }
    try:
        async with asyncio.timeout(FETCH_DEADLINE_SECONDS):
            async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
                response = await client.get(
                    TP_PRICES_URL, params=params, headers={"X-Access-Token": token}
                )
        response.raise_for_status()
        items = _items(response.json(), currency)
    except httpx.HTTPStatusError as exc:
        log.warning("travelpayouts_unavailable", status=exc.response.status_code)
        await _back_off(redis)
        return 0
    except _Unusable as exc:
        log.warning("travelpayouts_unavailable", reason=str(exc))
        await _back_off(redis)
        return 0
    except (httpx.HTTPError, ValueError, TimeoutError) as exc:
        log.warning("travelpayouts_unavailable", error_type=type(exc).__name__)
        await _back_off(redis)
        return 0

    today = datetime.now(UTC).date()
    rows = [
        row
        for item in items
        if (
            row := _snapshot(
                item, origin=origin, destination=destination, currency=currency, today=today
            )
        )
        is not None
    ]
    if rows:
        try:
            async with db.begin_nested():
                db.add_all(rows)
        except SQLAlchemyError as exc:
            log.warning("travelpayouts_seed_not_saved", error_type=type(exc).__name__)
            await _back_off(redis)
            return 0
    try:
        await redis.set(key, "1", ex=SEED_TTL_SECONDS)
    except RedisError as exc:
        log.warning("travelpayouts_cache_unavailable", error_type=type(exc).__name__)
    return len(rows)
