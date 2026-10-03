"""Tenant-free reads served through the Redis cache: airport search and route fare aggregates
(whose agency's own searches stay live)."""

import os
from datetime import UTC, datetime, timedelta

import pytest
from redis.asyncio import Redis

from tests.fareintel.test_route_intel import _log_search, add, ago, intel
from tests.helpers import make_client, signup


@pytest.fixture
async def redis():
    client = Redis.from_url(os.environ["TM_REDIS_URL"])
    yield client
    await client.aclose()


async def keys(redis, pattern: str) -> list[str]:
    return sorted(k.decode() for k in await redis.keys(pattern))


async def test_suppliers_list_is_not_cached(client, redis):
    """The list is built in memory from the process settings: a Redis round trip would only
    make it slower, so it is deliberately left out of the cache."""
    await signup(client)
    first = await client.get("/api/v1/suppliers")
    assert first.status_code == 200
    assert await keys(redis, "tm:rc:*") == []
    client.cookies.clear()
    assert (await client.get("/api/v1/suppliers")).status_code == 401


async def test_airport_search_is_cached_by_normalised_query(client, airports, redis):
    await signup(client)
    first = await client.get("/api/v1/reference/airports", params={"q": "Delhi", "limit": 3})
    assert first.status_code == 200 and first.json()[0]["iata_code"] == "DEL"
    second = await client.get("/api/v1/reference/airports", params={"q": "  delhi ", "limit": 3})
    assert second.json() == first.json()
    cached = await keys(redis, "tm:rc:airports:*")
    assert len(cached) == 1
    assert 3500 < await redis.ttl(cached[0]) <= 3600
    await client.get("/api/v1/reference/airports", params={"q": "delhi", "limit": 4})
    assert len(await keys(redis, "tm:rc:airports:*")) == 2  # the limit is part of the key
    client.cookies.clear()
    anonymous = await client.get("/api/v1/reference/airports", params={"q": "delhi"})
    assert anonymous.status_code == 401


async def test_route_fare_aggregates_are_cached_for_five_minutes(client, airports, redis):
    await signup(client)
    await add([100000, 200000])
    first = await intel(client)
    await add([900000, 900000, 900000])  # a new observation: up to 5 min stale, by design
    second = await intel(client)
    assert second == first
    cached = await keys(redis, "tm:rc:route:*")
    assert len(cached) == 1
    assert "DEL:BOM:economy:INR:Asia/Kolkata" in cached[0]
    assert 290 < await redis.ttl(cached[0]) <= 300


async def test_your_searches_stay_live(client, airports):
    await signup(client)
    agency = (await client.get("/api/v1/agency")).json()["id"]
    await add([100000])
    assert (await intel(client))["your_searches"] == []
    await _log_search(agency, datetime.now(UTC) - timedelta(hours=1), cheapest=12345)
    body = await intel(client)
    assert [s["cheapest_minor"] for s in body["your_searches"]] == [12345]


async def test_fare_aggregates_are_shared_but_searches_are_not(client, app, airports, redis):
    await signup(client)
    alpha = (await client.get("/api/v1/agency")).json()["id"]
    await add([100000, 300000], day=ago(2))
    await _log_search(alpha, datetime.now(UTC) - timedelta(hours=1), cheapest=11111)
    mine = await intel(client)
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        theirs = await intel(other)
        assert theirs["your_searches"] == []  # alpha's search is never served to beta
        assert {k: v for k, v in theirs.items() if k != "your_searches"} == {
            k: v for k, v in mine.items() if k != "your_searches"
        }
        # Another time zone has its own local days and hours: its own entry.
        moved = await other.patch("/api/v1/agency", json={"timezone": "America/New_York"})
        assert moved.status_code == 200, moved.text
        await intel(other)
    assert len(await keys(redis, "tm:rc:route:*")) == 2
    assert [s["cheapest_minor"] for s in (await intel(client))["your_searches"]] == [11111]
