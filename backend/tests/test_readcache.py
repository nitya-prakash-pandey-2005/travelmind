"""The Redis read-through cache: loads once, falls through when Redis is down, stops stampedes,
and keeps tenant keys apart by agency and version."""

import asyncio
import json
import os
import time
from uuid import uuid4

import pytest
from fastapi.routing import APIRoute
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from structlog.testing import capture_logs

from travelmind import readcache
from travelmind.readcache import (
    CACHE_PREFIX,
    agency_key,
    agency_version,
    bump_agency_version,
    cached_json,
    invalidate_agency,
)


@pytest.fixture
async def redis():
    client = Redis.from_url(os.environ["TM_REDIS_URL"])
    yield client
    await client.aclose()


class DownRedis:
    """Every command fails the way a lost Redis does."""

    def __init__(self) -> None:
        self.calls = 0

    async def _fail(self, *args, **kwargs):
        self.calls += 1
        raise RedisConnectionError("Error 111 connecting to redis:6379. Connection refused.")

    get = set = delete = incr = _fail

    def pipeline(self, *args, **kwargs):
        return DownPipeline()


class DownPipeline:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def incr(self, *args, **kwargs):
        return self

    expire = incr

    async def execute(self):
        raise RedisConnectionError("Error 111 connecting to redis:6379. Connection refused.")


def counting_loader(delay: float = 0.0):
    calls = {"n": 0}

    async def loader():
        calls["n"] += 1
        if delay:
            await asyncio.sleep(delay)
        return {"n": calls["n"], "items": [1, 2, 3]}

    return loader, calls


async def test_cached_json_loads_once(redis):
    loader, calls = counting_loader()
    key = CACHE_PREFIX + "test:once"
    first = await cached_json(redis, key, 30, loader, encode=json.dumps, decode=json.loads)
    second = await cached_json(redis, key, 30, loader, encode=json.dumps, decode=json.loads)
    assert first == second == {"n": 1, "items": [1, 2, 3]}
    assert calls["n"] == 1
    assert 0 < await redis.ttl(key) <= 30
    assert await redis.exists(readcache.LOCK_PREFIX + key) == 0  # the lock is released


async def test_cache_falls_through_when_redis_is_down():
    down = DownRedis()
    loader, calls = counting_loader()
    key = CACHE_PREFIX + "test:down"
    with capture_logs() as logs:
        first = await cached_json(down, key, 30, loader, encode=json.dumps, decode=json.loads)
        second = await cached_json(down, key, 30, loader, encode=json.dumps, decode=json.loads)
    assert first == {"n": 1, "items": [1, 2, 3]} and second["n"] == 2
    assert calls["n"] == 2
    warnings = [e for e in logs if e["log_level"] == "warning"]
    # Once per call, naming only the error type (no message, host or key).
    assert len(warnings) == 2
    for event in warnings:
        assert event["error_type"] == "ConnectionError"
        assert "Connection refused" not in json.dumps(event, default=str)
        assert key not in json.dumps(event, default=str)


async def test_version_helpers_swallow_redis_errors():
    down = DownRedis()
    agency = uuid4()
    assert await agency_version(down, agency) == 0
    await bump_agency_version(down, agency)  # no exception
    await invalidate_agency(down, agency)


async def test_stampede_lock(redis):
    loader, calls = counting_loader(delay=0.1)
    key = CACHE_PREFIX + "test:stampede"
    results = await asyncio.gather(
        *(
            cached_json(redis, key, 30, loader, encode=json.dumps, decode=json.loads)
            for _ in range(10)
        )
    )
    assert calls["n"] in (1, 2)
    assert all(r["items"] == [1, 2, 3] for r in results)


async def test_a_crashed_lock_holder_never_blocks_readers(redis):
    key = CACHE_PREFIX + "test:crashed"
    # A holder that died mid-load leaves its lock behind (until the lock's own TTL).
    await redis.set(readcache.LOCK_PREFIX + key, "1", px=60_000)
    loader, calls = counting_loader()
    started = time.perf_counter()
    value = await cached_json(redis, key, 30, loader, encode=json.dumps, decode=json.loads)
    waited = time.perf_counter() - started
    assert value["n"] == 1 and calls["n"] == 1
    assert waited < 1.0  # waiters poll for at most ~250 ms, then load themselves
    assert json.loads(await redis.get(key)) == value  # and fill the cache for the next reader


async def test_a_lock_holder_sets_its_lock_with_a_short_ttl(redis):
    key = CACHE_PREFIX + "test:lock-ttl"
    seen: list[int] = []

    async def loader():
        seen.append(await redis.pttl(readcache.LOCK_PREFIX + key))
        return {"ok": True}

    await cached_json(redis, key, 30, loader, encode=json.dumps, decode=json.loads)
    assert len(seen) == 1 and 0 < seen[0] <= readcache.LOCK_TTL_MS <= 10_000


async def test_an_unreadable_entry_is_reloaded(redis):
    key = CACHE_PREFIX + "test:corrupt"
    await redis.set(key, "not json", ex=30)
    loader, calls = counting_loader()
    value = await cached_json(redis, key, 30, loader, encode=json.dumps, decode=json.loads)
    assert value["n"] == 1 and calls["n"] == 1
    assert json.loads(await redis.get(key)) == value


async def test_agency_version_and_keys(redis):
    a, b = uuid4(), uuid4()
    assert await agency_version(redis, a) == 0
    await bump_agency_version(redis, a)
    await invalidate_agency(redis, a)
    assert await agency_version(redis, a) == 2
    assert await agency_version(redis, b) == 0
    key = agency_key(a, 2, "summary", "30d", "2026-10-03")
    assert key == f"tm:rc:a:{a}:v2:summary:30d:2026-10-03"
    assert agency_key(b, 2, "summary", "30d", "2026-10-03") != key
    assert agency_key(a, 3, "summary", "30d", "2026-10-03") != key


async def test_cache_requests_are_counted(redis):
    from travelmind.metrics import CACHE_REQUESTS

    def count(result: str) -> float:
        return CACHE_REQUESTS.labels(cache="test", result=result)._value.get()

    before = {r: count(r) for r in ("hit", "miss", "error")}
    loader, _ = counting_loader()
    key = CACHE_PREFIX + "test:counted"
    kwargs = {"encode": json.dumps, "decode": json.loads, "cache": "test"}
    await cached_json(redis, key, 30, loader, **kwargs)
    await cached_json(redis, key, 30, loader, **kwargs)
    await cached_json(DownRedis(), key, 30, loader, **kwargs)
    after = {r: count(r) for r in ("hit", "miss", "error")}
    assert {r: after[r] - before[r] for r in after} == {"hit": 1, "miss": 1, "error": 1}


async def test_redis_commands_time_out_instead_of_hanging():
    from travelmind.cache import get_shared_redis

    kwargs = get_shared_redis().connection_pool.connection_kwargs
    assert kwargs["socket_connect_timeout"] == 2.0
    assert kwargs["socket_timeout"] == 2.0


# --- invalidation wiring ------------------------------------------------------------------------

# Writes that touch no cached data: signing up makes a brand-new agency, and logging in or out
# only changes sessions.
NO_INVALIDATION = {
    ("POST", "/api/v1/auth/signup"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/logout"),
}
# Reads that can write: lazy quote expiry, or the client's first view of a shared quote.
READS_THAT_WRITE = {
    ("GET", "/api/v1/quotes"),
    ("GET", "/api/v1/quotes/{quote_id}"),
    ("GET", "/api/v1/public/quotes/{token}"),
    ("GET", "/api/v1/search"),
    ("GET", "/api/v1/notifications"),
    ("GET", "/api/v1/enquiries/{enquiry_id}/activity"),
    ("GET", "/api/v1/clients/{client_id}/activity"),
    ("GET", "/api/v1/quotes/{quote_id}/activity"),
}
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def _depends_on(dependant, call) -> bool:
    return any(d.call is call or _depends_on(d, call) for d in dependant.dependencies)


def _api_routes(routes):
    """Every APIRoute, including those of included routers (kept lazily as `original_router`)."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from _api_routes(route.original_router.routes)


def test_every_write_invalidates_the_agency_cache(app):
    routes = list(_api_routes(app.routes))
    assert len(routes) > 40
    checked = set()
    for route in routes:
        for method in route.methods:
            pair = (method, route.path)
            if (method in MUTATING and pair not in NO_INVALIDATION) or pair in READS_THAT_WRITE:
                checked.add(pair)
                assert _depends_on(route.dependant, readcache.publish_agency_changes_after), pair
    assert READS_THAT_WRITE <= checked  # every listed read still exists
    assert ("POST", "/api/v1/public/quotes/{token}/decision") in checked
    assert ("POST", "/api/v1/flights/search") in checked
    assert ("POST", "/api/v1/demo") in checked
