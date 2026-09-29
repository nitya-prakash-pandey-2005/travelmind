import asyncio
import os
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from redis.asyncio import Redis
from sqlalchemy import func, select
from structlog.testing import capture_logs

from travelmind.db import get_sessionmaker
from travelmind.fareintel import travelpayouts
from travelmind.fareintel.models import FareSnapshot
from travelmind.fareintel.travelpayouts import (
    CLAIM_TTL_SECONDS,
    FAILURE_KEY,
    FAILURE_TTL_SECONDS,
    SEED_TTL_SECONDS,
    TP_PRICES_URL,
    seed_route,
)

# Tests use respx's `respx_mock` fixture with full URLs; they never reach the real Travelpayouts.
DEPART = datetime.now(UTC).date() + timedelta(days=40)
SEED_KEY = f"tp:seed:DELBOM:{DEPART.strftime('%Y-%m')}:INR"


def item(**changes) -> dict:
    return {
        "price": 4210,
        "airline": "6E",
        "flight_number": "2045",
        "departure_at": f"{DEPART.isoformat()}T06:10:00+05:30",
        "transfers": 0,
    } | changes


def payload() -> dict:
    day = DEPART.isoformat()
    past = (datetime.now(UTC).date() - timedelta(days=2)).isoformat()
    return {
        "success": True,
        "currency": "inr",
        "data": [
            {
                "price": 4210,
                "airline": "6E",
                "flight_number": "2045",
                "departure_at": f"{day}T06:10:00+05:30",
                "transfers": 0,
            },
            {
                "price": 5120,
                "airline": "AI",
                "flight_number": "865",
                "departure_at": f"{day}T09:00:00+05:30",
                "transfers": 0,
            },
            {
                "price": 3999,
                "airline": "QP",
                "flight_number": "1101",
                "departure_at": f"{past}T09:00:00+05:30",
                "transfers": 0,
            },
            {"price": "n/a", "airline": "SG", "departure_at": f"{day}T11:00:00+05:30"},
        ],
    }


def tp_redis() -> Redis:
    return Redis.from_url(os.environ["TM_REDIS_URL"])


async def seed(redis: Redis, **changes) -> int:
    fields = {
        "token": "tp-token",
        "origin": "DEL",
        "destination": "BOM",
        "departure_date": DEPART,
        "currency": "INR",
        "market": "in",
    } | changes
    async with get_sessionmaker()() as db:
        added = await seed_route(db, redis, **fields)
        await db.commit()
        return added


async def count() -> int:
    async with get_sessionmaker()() as db:
        return (
            await db.scalar(
                select(func.count())
                .select_from(FareSnapshot)
                .where(FareSnapshot.provenance == "CACHED")
            )
            or 0
        )


async def snapshots() -> list[FareSnapshot]:
    async with get_sessionmaker()() as db:
        return list(
            (await db.scalars(select(FareSnapshot).order_by(FareSnapshot.total_minor))).all()
        )


async def test_seeds_cached_fares_once_per_day(respx_mock):
    route = respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        assert await seed(redis) == 2  # past departure and non-numeric price are skipped
        assert await seed(redis) == 0
        ttl = await redis.ttl(SEED_KEY)
    finally:
        await redis.aclose()
    assert await count() == 2
    assert CLAIM_TTL_SECONDS < ttl <= SEED_TTL_SECONDS
    assert route.call_count == 1
    sent = route.calls.last.request
    assert sent.headers["X-Access-Token"] == "tp-token"
    assert sent.url.params["currency"] == "inr"
    assert sent.url.params["market"] == "in"
    assert sent.url.params["departure_at"] == DEPART.strftime("%Y-%m")


async def test_seeded_rows_are_exact_cached_economy_fares(respx_mock):
    respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = tp_redis()
    try:
        await seed(redis)
    finally:
        await redis.aclose()
    rows = await snapshots()
    assert [(r.carrier, r.total_minor, r.currency, r.stops) for r in rows] == [
        ("6E", 421000, "INR", 0),
        ("AI", 512000, "INR", 0),
    ]
    for row in rows:
        assert (row.origin, row.destination, row.cabin) == ("DEL", "BOM", "economy")
        assert (row.provenance, row.source) == ("CACHED", "travelpayouts")
        assert row.departure_date == DEPART and row.days_to_departure == 40


async def test_failures_add_nothing(respx_mock):
    respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(500))
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert await count() == 0


async def test_a_failure_backs_off_for_five_minutes(respx_mock):
    route = respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(500))
    redis = tp_redis()
    try:
        assert await seed(redis) == 0
        assert await seed(redis, destination="BLR") == 0  # any route: the service is down
        ttl = await redis.ttl(FAILURE_KEY)
        assert await redis.ttl(SEED_KEY) <= CLAIM_TTL_SECONDS  # only the short claim remains
    finally:
        await redis.aclose()
    assert route.call_count == 1
    assert 0 < ttl <= FAILURE_TTL_SECONDS


async def test_network_errors_never_raise_or_log_the_token(respx_mock):
    respx_mock.get(TP_PRICES_URL).mock(side_effect=httpx.ConnectError("refused tp-token"))
    redis = tp_redis()
    try:
        with capture_logs() as logs:
            assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert logs and "tp-token" not in repr(logs)
    assert await count() == 0


async def test_http_errors_are_logged_by_status_only(respx_mock):
    respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(401))
    redis = tp_redis()
    try:
        with capture_logs() as logs:
            assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert [entry.get("status") for entry in logs] == [401]
    assert "tp-token" not in repr(logs)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="<html>not json</html>"),
        httpx.Response(200, json=[]),
        httpx.Response(200, json={"success": False, "error": "Unauthorized"}),
        httpx.Response(200, json={"success": True, "currency": "usd", "data": [item()]}),
        httpx.Response(200, json={"success": True, "data": [item()]}),
        httpx.Response(200, json={"success": True, "currency": "inr", "data": {"price": 1}}),
    ],
    ids=["not-json", "json-list", "unsuccessful", "other-currency", "no-currency", "data-not-list"],
)
async def test_unusable_responses_add_nothing_and_never_raise(respx_mock, response):
    respx_mock.get(TP_PRICES_URL).mock(return_value=response)
    redis = tp_redis()
    try:
        assert await seed(redis) == 0
        assert await redis.exists(FAILURE_KEY)
    finally:
        await redis.aclose()
    assert await count() == 0


async def test_unusable_items_are_skipped(respx_mock):
    day = f'"{DEPART.isoformat()}T06:10:00+05:30"'
    body = (
        '{"success":true,"currency":"inr","data":['
        f'{{"price":Infinity,"departure_at":{day}}},{{"price":NaN,"departure_at":{day}}},'
        f'{{"price":0,"departure_at":{day}}},{{"price":-10,"departure_at":{day}}},'
        f'{{"price":1e300,"departure_at":{day}}},{{"price":true,"departure_at":{day}}},'
        '{"price":100,"departure_at":"tomorrow"},{"price":100,"departure_at":12345},{"price":100},'
        '"not an object",null,'
        f'{{"price":4210.5,"airline":"TOOLONG","transfers":true,"departure_at":{day}}},'
        f'{{"price":5000,"airline":"ai","transfers":-1,"departure_at":{day}}}'
        "]}"
    )
    respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, text=body))
    redis = tp_redis()
    try:
        assert await seed(redis) == 2
    finally:
        await redis.aclose()
    # Unrecognisable carriers and stop counts are left unknown rather than guessed.
    assert [(r.total_minor, r.carrier, r.stops) for r in await snapshots()] == [
        (421050, None, None),
        (500000, None, None),
    ]


async def test_an_empty_month_is_remembered_too(respx_mock):
    route = respx_mock.get(TP_PRICES_URL).mock(
        return_value=httpx.Response(200, json={"success": True, "currency": "inr", "data": []})
    )
    redis = tp_redis()
    try:
        assert await seed(redis) == 0
        assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert route.call_count == 1


async def test_a_database_error_leaves_the_callers_session_usable(respx_mock):
    respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = tp_redis()
    try:
        async with get_sessionmaker()() as db:
            with capture_logs() as logs:
                # A 4-letter code doesn't fit the column, so the insert fails inside seed_route.
                added = await seed_route(
                    db,
                    redis,
                    token="tp-token",
                    origin="DELX",
                    destination="BOM",
                    departure_date=DEPART,
                    currency="INR",
                    market="in",
                )
            db.add(
                FareSnapshot(
                    origin="DEL",
                    destination="BOM",
                    departure_date=DEPART,
                    days_to_departure=40,
                    cabin="economy",
                    total_minor=100,
                    currency="INR",
                    provenance="LIVE",
                    source="test",
                )
            )
            await db.commit()
        claim_ttl = await redis.ttl(f"tp:seed:DELXBOM:{DEPART.strftime('%Y-%m')}:INR")
        backed_off = await redis.exists(FAILURE_KEY)
    finally:
        await redis.aclose()
    assert added == 0
    assert claim_ttl <= CLAIM_TTL_SECONDS  # never promoted to the 24 h "seeded" marker
    assert backed_off  # a database fault doesn't refetch on every search
    assert logs and "tp-token" not in repr(logs)
    assert [r.provenance for r in await snapshots()] == ["LIVE"]


async def test_redis_outage_skips_seeding_without_raising(respx_mock):
    route = respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2)
    try:
        assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert route.call_count == 0
    assert await count() == 0


async def test_a_claimed_route_is_not_fetched_twice(respx_mock):
    route = respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = tp_redis()
    try:
        await redis.set(SEED_KEY, "1", ex=CLAIM_TTL_SECONDS)  # another search is seeding it now
        assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert route.call_count == 0
    assert await count() == 0


async def test_concurrent_searches_fetch_once(respx_mock):
    route = respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = tp_redis()
    try:
        results = await asyncio.gather(seed(redis), seed(redis), seed(redis))
    finally:
        await redis.aclose()
    assert sorted(results) == [0, 0, 2]
    assert route.call_count == 1


@pytest.mark.parametrize("currency", ["RUPEES", "", "I1R"])
async def test_an_unusable_currency_never_raises_or_fetches(respx_mock, currency):
    route = respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = tp_redis()
    try:
        assert await seed(redis, currency=currency) == 0
    finally:
        await redis.aclose()
    assert route.call_count == 0
    assert await count() == 0


async def test_a_stalled_response_is_cut_off_by_the_deadline(respx_mock, monkeypatch):
    async def stall(request):
        await asyncio.sleep(5)
        return httpx.Response(200, json=payload())

    monkeypatch.setattr(travelpayouts, "FETCH_DEADLINE_SECONDS", 0.2)
    respx_mock.get(TP_PRICES_URL).mock(side_effect=stall)
    redis = tp_redis()
    try:
        started = time.monotonic()
        with capture_logs() as logs:
            assert await seed(redis) == 0
        elapsed = time.monotonic() - started
        backed_off = await redis.exists(FAILURE_KEY)
    finally:
        await redis.aclose()
    assert elapsed < 2
    assert backed_off
    assert [(e["event"], e.get("error_type")) for e in logs] == [
        ("travelpayouts_unavailable", "TimeoutError")
    ]
    assert await count() == 0
