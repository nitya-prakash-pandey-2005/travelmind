"""The Redis read-through cache: loads once, falls through when Redis is down or hung, skips a
struggling Redis behind a circuit breaker, stops stampedes, and keeps tenant keys apart by agency
and version."""

import asyncio
import json
import os
import time
import typing
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

    get = set = delete = incr = eval = _fail

    def pipeline(self, *args, **kwargs):
        return DownPipeline(self)


class DownPipeline:
    def __init__(self, owner: DownRedis) -> None:
        self.owner = owner

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def incr(self, *args, **kwargs):
        return self

    expire = incr

    async def execute(self):
        await self.owner._fail()


class HungRedis:
    """A Redis that takes the command and never answers. Records how long callers waited."""

    def __init__(self) -> None:
        self.calls = 0
        self.waited = 0.0

    async def _hang(self, *args, **kwargs):
        self.calls += 1
        started = time.perf_counter()
        try:
            await asyncio.sleep(10)
        finally:
            self.waited += time.perf_counter() - started

    get = set = delete = incr = eval = _hang

    def pipeline(self, *args, **kwargs):
        return HungPipeline(self)


class HungPipeline:
    def __init__(self, owner: HungRedis) -> None:
        self.owner = owner

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def incr(self, *args, **kwargs):
        return self

    expire = incr

    async def execute(self):
        await self.owner._hang()


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    """A fresh breaker (3 failures, 10 s cool-down) on a clock the test moves by hand."""
    fake = FakeClock()
    breaker = readcache.CircuitBreaker(failures=3, cooldown_s=10.0, clock=fake)
    monkeypatch.setattr(readcache, "_breaker", breaker)
    return fake


def counting_loader(delay: float = 0.0):
    calls = {"n": 0}

    async def loader():
        calls["n"] += 1
        if delay:
            await asyncio.sleep(delay)
        return {"n": calls["n"], "items": [1, 2, 3]}

    return loader, calls


JSON = {"encode": json.dumps, "decode": json.loads, "cache": "airports"}


async def test_cached_json_loads_once(redis):
    loader, calls = counting_loader()
    key = CACHE_PREFIX + "test:once"
    first = await cached_json(redis, key, 30, loader, **JSON)
    second = await cached_json(redis, key, 30, loader, **JSON)
    assert first == second == {"n": 1, "items": [1, 2, 3]}
    assert calls["n"] == 1
    assert 0 < await redis.ttl(key) <= 30
    assert await redis.exists(readcache.LOCK_PREFIX + key) == 0  # the lock is released


async def test_cache_falls_through_when_redis_is_down():
    down = DownRedis()
    loader, calls = counting_loader()
    key = CACHE_PREFIX + "test:down"
    with capture_logs() as logs:
        first = await cached_json(down, key, 30, loader, **JSON)
        second = await cached_json(down, key, 30, loader, **JSON)
    assert first == {"n": 1, "items": [1, 2, 3]} and second["n"] == 2
    assert calls["n"] == 2
    for event in logs:  # naming only the error type (no message, host or key)
        assert "Connection refused" not in json.dumps(event, default=str)
        assert key not in json.dumps(event, default=str)


async def test_a_hung_redis_costs_one_short_timeout():
    hung = HungRedis()
    loader, calls = counting_loader()
    started = time.perf_counter()
    value = await cached_json(hung, CACHE_PREFIX + "test:hung", 30, loader, **JSON)
    elapsed = time.perf_counter() - started
    assert value["n"] == 1 and calls["n"] == 1
    assert hung.calls == 1  # gave up on the GET; did not go on to lock and SET
    assert elapsed < 0.25  # one 150 ms command timeout, not the pool's 2 s socket timeout


async def test_version_helpers_time_out_quickly():
    hung = HungRedis()
    agency = uuid4()
    started = time.perf_counter()
    assert await agency_version(hung, agency) is None  # unknown: callers skip the cache
    assert time.perf_counter() - started < 0.25
    started = time.perf_counter()
    await bump_agency_version(hung, agency)
    assert time.perf_counter() - started < 0.25


def test_read_cache_defaults():
    from travelmind.config import Settings

    settings = Settings(_env_file=None)
    assert settings.read_cache_timeout_ms == 150
    assert settings.read_cache_breaker_failures == 3
    assert settings.read_cache_breaker_cooldown_s == 10.0


async def test_breaker_opens_after_consecutive_failures_then_half_opens(clock, redis):
    down = DownRedis()
    loader, calls = counting_loader()
    key = CACHE_PREFIX + "test:breaker"
    with capture_logs() as logs:
        for _ in range(3):
            await cached_json(down, key, 30, loader, **JSON)
        assert down.calls == 3
        # Open: Redis is skipped for the cool-down, and every request still answers.
        for _ in range(5):
            await cached_json(down, key, 30, loader, **JSON)
        await bump_agency_version(down, uuid4())
        assert await agency_version(down, uuid4()) is None
        assert down.calls == 3
        assert calls["n"] == 8
        clock.now += 9.9
        await cached_json(down, key, 30, loader, **JSON)
        assert down.calls == 3
        # Half-open: after the cool-down one trial call goes through; it fails, so it opens again.
        clock.now += 0.2
        await cached_json(down, key, 30, loader, **JSON)
        assert down.calls == 4
        await cached_json(down, key, 30, loader, **JSON)
        assert down.calls == 4
    warnings = [e for e in logs if e["log_level"] == "warning"]
    # At most one warning per opening: here it opened twice.
    assert [w["event"] for w in warnings] == ["read_cache_unavailable"] * 2
    assert all(w["error_type"] == "ConnectionError" for w in warnings)
    # The next trial reaches a healthy Redis: the breaker closes and the cache is used again.
    clock.now += 10.1
    first = await cached_json(redis, key, 30, loader, **JSON)
    second = await cached_json(redis, key, 30, loader, **JSON)
    assert first == second
    assert json.loads(await redis.get(key)) == first


def test_half_open_lets_a_single_trial_through(clock):
    breaker = readcache._breaker
    for _ in range(3):
        assert breaker.allow()
        breaker.record_failure()
    assert not breaker.allow()
    clock.now += 10.0
    assert breaker.allow()  # the trial
    assert not breaker.allow()  # everyone else keeps skipping Redis while it runs
    breaker.record_success()
    assert breaker.allow() and breaker.allow()


def test_failures_must_be_consecutive(clock):
    breaker = readcache._breaker
    for _ in range(5):
        breaker.record_failure()
        breaker.record_failure()
        breaker.record_success()
    assert breaker.allow()


async def test_a_hung_redis_trips_the_breaker(clock):
    hung = HungRedis()
    loader, _ = counting_loader()
    key = CACHE_PREFIX + "test:hung-breaker"
    for _ in range(3):
        await cached_json(hung, key, 30, loader, **JSON)
    started = time.perf_counter()
    await cached_json(hung, key, 30, loader, **JSON)
    assert time.perf_counter() - started < 0.05  # skipped: no timeout to wait out
    assert hung.calls == 3


def test_cache_names_are_a_closed_set():
    assert set(typing.get_args(readcache.CacheName)) == {
        "summary",
        "pipeline",
        "airports",
        "route_intel",
    }


async def test_version_helpers_swallow_redis_errors():
    down = DownRedis()
    agency = uuid4()
    assert await agency_version(down, agency) is None
    await bump_agency_version(down, agency)  # no exception
    await invalidate_agency(down, agency)


async def test_stampede_lock(redis):
    loader, calls = counting_loader(delay=0.1)
    key = CACHE_PREFIX + "test:stampede"
    results = await asyncio.gather(
        *(cached_json(redis, key, 30, loader, **JSON) for _ in range(10))
    )
    assert calls["n"] in (1, 2)
    assert all(r["items"] == [1, 2, 3] for r in results)


async def test_a_crashed_lock_holder_never_blocks_readers(redis):
    key = CACHE_PREFIX + "test:crashed"
    # A holder that died mid-load leaves its lock behind (until the lock's own TTL).
    await redis.set(readcache.LOCK_PREFIX + key, "1", px=60_000)
    loader, calls = counting_loader()
    started = time.perf_counter()
    value = await cached_json(redis, key, 30, loader, **JSON)
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

    await cached_json(redis, key, 30, loader, **JSON)
    assert len(seen) == 1 and 0 < seen[0] <= readcache.LOCK_TTL_MS <= 10_000


async def test_the_lock_is_owned_by_its_holder(redis):
    """A holder whose lock lapsed (a load slower than LOCK_TTL_MS) must not release the lock a
    second holder has taken since."""
    key = CACHE_PREFIX + "test:lock-owner"
    tokens: list[bytes] = []

    async def slow_loader():
        lock = readcache.LOCK_PREFIX + key
        tokens.append(await redis.get(lock))
        await redis.set(lock, "someone-else", px=60_000)  # lapsed, then taken by another holder
        return {"ok": True}

    await cached_json(redis, key, 30, slow_loader, **JSON)
    assert await redis.get(readcache.LOCK_PREFIX + key) == b"someone-else"
    assert len(tokens[0]) >= 16 and tokens[0] != b"1"  # a random owner token
    key = CACHE_PREFIX + "test:lock-owner-2"
    await cached_json(redis, key, 30, slow_loader, **JSON)
    assert tokens[1] != tokens[0]


async def test_an_unreadable_entry_is_reloaded(redis):
    key = CACHE_PREFIX + "test:corrupt"
    await redis.set(key, "not json", ex=30)
    loader, calls = counting_loader()
    value = await cached_json(redis, key, 30, loader, **JSON)
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
        return CACHE_REQUESTS.labels(cache="airports", result=result)._value.get()

    before = {r: count(r) for r in ("hit", "miss", "error")}
    loader, _ = counting_loader()
    key = CACHE_PREFIX + "test:counted"
    kwargs = JSON
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
# Frequent writes that must NOT retire the agency's cache. A search only feeds the dashboard's
# "searches" KPI, which may be up to the summary TTL (30 s) stale; pricing an offer and marking
# notifications seen touch no cached data.
NEVER_BUMP = {
    ("POST", "/api/v1/flights/search"),
    ("POST", "/api/v1/flights/offers/{offer_id}/price"),
    ("POST", "/api/v1/hotels/search"),
    ("POST", "/api/v1/notifications/seen"),
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
    bumps, publishes, seen = set(), set(), set()
    for route in routes:
        for method in route.methods:
            pair = (method, route.path)
            seen.add(pair)
            if _depends_on(route.dependant, readcache.publish_agency_changes_after):
                bumps.add(pair)
            if _depends_on(route.dependant, readcache.publish_marked_changes_after):
                publishes.add(pair)
            if method in MUTATING and pair not in NO_INVALIDATION | NEVER_BUMP:
                assert pair in bumps, pair
    for pair in READS_THAT_WRITE:  # their marked changes are published
        assert pair in bumps | publishes, pair
    for pair in NEVER_BUMP:
        assert pair in seen and pair not in bumps, pair
    assert READS_THAT_WRITE <= seen  # every listed read still exists
    assert ("POST", "/api/v1/public/quotes/{token}/decision") in bumps
    assert ("POST", "/api/v1/demo") in bumps
