"""The per-process session cache: token hash → signed-in user, for at most 30 s.

Revocation must still take effect at once: logout evicts in this process and publishes the
eviction over Redis for the others; deleting demo agencies evicts their users' sessions.
"""

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from sqlalchemy import event
from structlog.testing import capture_logs

from tests.helpers import make_client, run_as_owner, signup
from travelmind.cache import get_shared_redis
from travelmind.db import get_engine
from travelmind.identity import sessioncache
from travelmind.identity.sessioncache import SessionCache
from travelmind.identity.tokens import hash_token

SESSION_COOKIE = "tm_session"
ME = "/api/v1/auth/me"


@pytest.fixture
def session_lookups() -> Iterator[list[str]]:
    """SQL statements that read the sessions table."""
    seen: list[str] = []
    engine = get_engine().sync_engine

    def record(conn, cursor, statement, parameters, context, executemany) -> None:  # type: ignore[no-untyped-def]
        if "FROM sessions" in statement or "JOIN sessions" in statement:
            seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    yield seen
    event.remove(engine, "before_cursor_execute", record)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def far_future() -> datetime:
    return datetime.now(UTC) + timedelta(days=1)


# --- the cache itself -----------------------------------------------------------------------


def test_entry_lapses_after_the_ttl():
    clock = Clock()
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=10, clock=clock)
    cache.listening = True
    agency, user = uuid4(), uuid4()
    cache.put(
        "h",
        "alice",
        user_id=user,
        agency_id=agency,
        expires_at=far_future(),
        generation=cache.generation,
    )
    clock.now += 29.9
    assert cache.get("h") == "alice"
    clock.now += 0.2
    assert cache.get("h") is None


def test_entry_never_outlives_its_session():
    clock = Clock()
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=10, clock=clock)
    cache.listening = True
    soon = datetime.now(UTC) + timedelta(seconds=5)
    cache.put(
        "h",
        "alice",
        user_id=uuid4(),
        agency_id=uuid4(),
        expires_at=soon,
        generation=cache.generation,
    )
    clock.now += 4
    assert cache.get("h") == "alice"
    clock.now += 2
    assert cache.get("h") is None


def test_entries_are_short_lived_while_evictions_may_be_missed():
    """While the listener isn't subscribed, another process's revocation can't reach this one,
    so new entries live only the short TTL."""
    clock = Clock()
    cache: SessionCache[str] = SessionCache(
        ttl_s=30, unsubscribed_ttl_s=5, max_entries=10, clock=clock
    )
    assert cache.listening is False

    def store(token: str) -> None:
        cache.put(
            token,
            token,
            user_id=uuid4(),
            agency_id=uuid4(),
            expires_at=far_future(),
            generation=cache.generation,
        )

    store("while-away")
    cache.listening = True
    store("while-listening")
    clock.now += 5.1
    assert cache.get("while-away") is None
    assert cache.get("while-listening") == "while-listening"
    assert sessioncache.SESSION_CACHE_UNSUBSCRIBED_TTL_SECONDS == 5.0


def test_an_already_expired_session_is_not_stored():
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=10)
    past = datetime.now(UTC) - timedelta(seconds=1)
    cache.put(
        "h",
        "alice",
        user_id=uuid4(),
        agency_id=uuid4(),
        expires_at=past,
        generation=cache.generation,
    )
    assert cache.get("h") is None


def test_least_recently_used_entry_goes_first():
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=2)
    for name in ("a", "b"):
        cache.put(
            name,
            name,
            user_id=uuid4(),
            agency_id=uuid4(),
            expires_at=far_future(),
            generation=cache.generation,
        )
    assert cache.get("a") == "a"  # b is now the least recently used
    cache.put(
        "c",
        "c",
        user_id=uuid4(),
        agency_id=uuid4(),
        expires_at=far_future(),
        generation=cache.generation,
    )
    assert (cache.get("a"), cache.get("b"), cache.get("c")) == ("a", None, "c")


def test_evictions_by_token_user_and_agency():
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=10)
    agency, other_agency, user, other_user = uuid4(), uuid4(), uuid4(), uuid4()
    for token, u, a in (
        ("t1", user, agency),
        ("t2", user, agency),
        ("t3", other_user, agency),
        ("t4", uuid4(), other_agency),
    ):
        cache.put(
            token,
            token,
            user_id=u,
            agency_id=a,
            expires_at=far_future(),
            generation=cache.generation,
        )
    cache.evict_token("t1")
    assert cache.get("t1") is None and cache.get("t2") == "t2"
    cache.evict_user(user)
    assert cache.get("t2") is None and cache.get("t3") == "t3"
    cache.evict_agency(agency)
    assert cache.get("t3") is None and cache.get("t4") == "t4"


def test_a_lookup_that_raced_an_eviction_is_not_stored():
    """A lookup that read the database before a revocation committed must not cache what it
    read: any eviction after the lookup began makes its store a no-op."""
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=10)
    began = cache.generation
    cache.evict_token("someone-else")
    cache.put(
        "h", "alice", user_id=uuid4(), agency_id=uuid4(), expires_at=far_future(), generation=began
    )
    assert cache.get("h") is None


def test_eviction_messages_are_applied():
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=10)
    agency, user = uuid4(), uuid4()
    cache.put(
        "t1",
        "x",
        user_id=user,
        agency_id=agency,
        expires_at=far_future(),
        generation=cache.generation,
    )
    cache.put(
        "t2",
        "y",
        user_id=uuid4(),
        agency_id=agency,
        expires_at=far_future(),
        generation=cache.generation,
    )
    cache.put(
        "t3",
        "z",
        user_id=uuid4(),
        agency_id=uuid4(),
        expires_at=far_future(),
        generation=cache.generation,
    )
    cache.apply("token:t1")
    assert cache.get("t1") is None
    cache.apply(f"agency:{agency}")
    assert cache.get("t2") is None and cache.get("t3") == "z"
    cache.apply("nonsense")  # ignored
    cache.apply("user:not-a-uuid")  # ignored
    assert cache.get("t3") == "z"


def test_one_message_can_evict_several_agencies():
    cache: SessionCache[str] = SessionCache(ttl_s=30, max_entries=10)
    a, b, c = uuid4(), uuid4(), uuid4()
    for token, agency in (("ta", a), ("tb", b), ("tc", c)):
        cache.put(
            token,
            token,
            user_id=uuid4(),
            agency_id=agency,
            expires_at=far_future(),
            generation=cache.generation,
        )
    cache.apply(f"agency:{a},{b}")
    assert (cache.get("ta"), cache.get("tb"), cache.get("tc")) == (None, None, "tc")


# --- through the API ------------------------------------------------------------------------


async def test_repeat_requests_skip_the_session_lookup(client, session_lookups):
    await signup(client)
    assert (await client.get(ME)).status_code == 200
    assert len(session_lookups) == 1
    for _ in range(3):
        assert (await client.get(ME)).status_code == 200
    assert len(session_lookups) == 1


async def test_logout_revokes_a_cached_session_at_once(client, app):
    await signup(client)
    token = client.cookies.get(SESSION_COOKIE)
    assert (await client.get(ME)).status_code == 200  # now cached
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    async with make_client(app) as replay:
        r = await replay.get(ME, headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    assert r.status_code == 401


async def test_demo_exit_revokes_a_cached_session_at_once(client, app, airports):
    assert (await client.post("/api/v1/demo")).status_code == 201
    token = client.cookies.get(SESSION_COOKIE)
    assert (await client.get(ME)).status_code == 200
    assert (await client.post("/api/v1/demo/exit")).status_code == 204
    async with make_client(app) as replay:
        r = await replay.get(ME, headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    assert r.status_code == 401


async def test_logout_publishes_the_eviction_for_other_processes(client):
    await signup(client)
    token = client.cookies.get(SESSION_COOKIE)
    listener = get_shared_redis().pubsub()
    await listener.subscribe(sessioncache.EVICT_CHANNEL)
    try:
        assert (await client.post("/api/v1/auth/logout")).status_code == 204
        message = None
        for _ in range(50):
            message = await listener.get_message(ignore_subscribe_messages=True, timeout=0.1)
            if message is not None:
                break
    finally:
        await listener.unsubscribe()
        await listener.aclose()
    assert message is not None
    assert message["data"].decode() == f"token:{hash_token(token)}"


async def test_another_process_revoking_evicts_through_the_listener(client):
    """Another API process revoked the session (in the database) and published the eviction:
    this process's listener drops its cached entry."""
    await signup(client)
    token = client.cookies.get(SESSION_COOKIE)
    assert (await client.get(ME)).status_code == 200  # cached here
    ready = asyncio.Event()
    listener = asyncio.create_task(sessioncache.listen_for_evictions(ready=ready))
    try:
        await asyncio.wait_for(ready.wait(), 5)
        await run_as_owner("UPDATE sessions SET revoked_at = now()")
        await sessioncache.publish_eviction(get_shared_redis(), "token", hash_token(token))
        for _ in range(50):
            if sessioncache.session_cache().get(hash_token(token)) is None:
                break
            await asyncio.sleep(0.05)
        assert (await client.get(ME)).status_code == 401
    finally:
        listener.cancel()
        with pytest.raises(asyncio.CancelledError):
            await listener


async def test_the_listener_starts_from_an_empty_cache(client):
    """Evictions published while the listener was away were missed, so (re)subscribing clears
    the cache."""
    await signup(client)
    token = client.cookies.get(SESSION_COOKIE)
    assert (await client.get(ME)).status_code == 200
    assert sessioncache.session_cache().get(hash_token(token)) is not None
    ready = asyncio.Event()
    listener = asyncio.create_task(sessioncache.listen_for_evictions(ready=ready))
    try:
        await asyncio.wait_for(ready.wait(), 5)
        assert sessioncache.session_cache().get(hash_token(token)) is None
    finally:
        listener.cancel()
        with pytest.raises(asyncio.CancelledError):
            await listener


async def test_publishing_never_fails_the_request():
    broken = Redis.from_url("redis://localhost:1/0", socket_connect_timeout=0.1)
    try:
        await sessioncache.publish_eviction(broken, "token", "abc")  # logged, not raised
    finally:
        await broken.aclose()


async def test_deleting_expired_demos_evicts_their_sessions(client, airports):
    from travelmind.db import get_sessionmaker
    from travelmind.demo.cleanup import delete_expired_demos

    assert (await client.post("/api/v1/demo")).status_code == 201
    token = client.cookies.get(SESSION_COOKIE)
    assert (await client.get(ME)).status_code == 200
    assert sessioncache.session_cache().get(hash_token(token)) is not None
    async with get_sessionmaker()() as db:
        assert await delete_expired_demos(db, now=datetime.now(UTC) + timedelta(days=8)) == 1
    assert sessioncache.session_cache().get(hash_token(token)) is None
    assert (await client.get(ME)).status_code == 401


async def test_cached_sessions_still_bind_their_own_tenant(client, app):
    """A cache hit binds the caller's agency for RLS just like a lookup does."""
    await signup(client)
    created = await client.post("/api/v1/clients", json={"name": "Alpha's client"})
    assert created.status_code == 201
    async with make_client(app) as beta:
        await signup(beta, email="owner@beta.com", agency_name="Beta")
        created = await beta.post("/api/v1/clients", json={"name": "Beta's client"})
        assert created.status_code == 201
        for _ in range(2):
            names = [c["name"] for c in (await beta.get("/api/v1/clients")).json()["items"]]
            assert names == ["Beta's client"]
    for _ in range(2):
        names = [c["name"] for c in (await client.get("/api/v1/clients")).json()["items"]]
        assert names == ["Alpha's client"]


async def test_the_app_listens_for_evictions_while_it_runs(client, app):
    from travelmind.main import lifespan

    await signup(client)
    token_hash = hash_token(client.cookies.get(SESSION_COOKIE))
    assert (await client.get(ME)).status_code == 200
    cache = sessioncache.session_cache()

    async def evicted() -> bool:
        for _ in range(100):
            if cache.get(token_hash) is None:
                return True
            await asyncio.sleep(0.02)
        return False

    async with lifespan(app):
        assert await evicted()  # the listener subscribed and started from an empty cache
        assert (await client.get(ME)).status_code == 200
        assert cache.get(token_hash) is not None
        await sessioncache.publish_eviction(get_shared_redis(), "token", token_hash)
        assert await evicted()


async def _stop(task: asyncio.Task[None]) -> None:
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_the_cache_knows_while_the_listener_is_subscribed():
    ready = asyncio.Event()
    listener = asyncio.create_task(sessioncache.listen_for_evictions(ready=ready))
    try:
        await asyncio.wait_for(ready.wait(), 5)
        assert sessioncache.session_cache().listening is True
    finally:
        await _stop(listener)
    assert sessioncache.session_cache().listening is False


async def test_the_listener_survives_an_unexpected_error(monkeypatch):
    """Any error (not only a Redis one) is logged, and the listener backs off and subscribes
    again instead of dying for the rest of the process's life."""
    applied: list[str] = []
    real_apply = SessionCache.apply

    def flaky_apply(self, message: str) -> None:  # type: ignore[no-untyped-def]
        if message == "token:boom":
            raise RuntimeError("unexpected")
        applied.append(message)
        real_apply(self, message)

    monkeypatch.setattr(SessionCache, "apply", flaky_apply)
    monkeypatch.setattr(sessioncache, "LISTENER_BACKOFF_FIRST_S", 0.01)
    ready = asyncio.Event()
    redis = get_shared_redis()
    with capture_logs() as logs:
        listener = asyncio.create_task(sessioncache.listen_for_evictions(ready=ready))
        try:
            await asyncio.wait_for(ready.wait(), 5)
            await sessioncache.publish_eviction(redis, "token", "boom")
            for _ in range(100):
                await sessioncache.publish_eviction(redis, "token", "after")
                if applied:
                    break
                await asyncio.sleep(0.05)
            assert not listener.done()
        finally:
            await _stop(listener)
    assert applied and applied[0] == "token:after"
    down = [e for e in logs if e["event"] == "session_eviction_listener_down"]
    assert down and down[0]["error_type"] == "RuntimeError"


def test_the_listener_backs_off_exponentially_up_to_about_five_seconds():
    delays = [sessioncache.listener_backoff(attempt) for attempt in range(8)]
    assert delays == sorted(delays) and delays[0] < delays[1] < delays[2]
    assert delays[-1] == sessioncache.LISTENER_BACKOFF_MAX_S == 5.0


async def test_the_listener_pauses_before_subscribing_again_when_its_subscription_ends(
    monkeypatch,
):
    """A subscription that ends without an error (say, the server dropped it) is not retried in
    a tight loop."""
    from redis.asyncio.client import PubSub

    subscriptions = 0
    real_clear = SessionCache.clear

    def counting_clear(self) -> None:  # type: ignore[no-untyped-def]
        nonlocal subscriptions
        subscriptions += 1
        real_clear(self)

    monkeypatch.setattr(PubSub, "subscribed", property(lambda self: False))
    monkeypatch.setattr(SessionCache, "clear", counting_clear)
    monkeypatch.setattr(sessioncache, "LISTENER_BACKOFF_FIRST_S", 0.05)
    with capture_logs() as logs:
        listener = asyncio.create_task(sessioncache.listen_for_evictions())
        await asyncio.sleep(0.5)
        await _stop(listener)
    assert 1 <= subscriptions <= 6, subscriptions
    assert any(e["event"] == "session_eviction_listener_down" for e in logs)


async def test_shutdown_closes_the_clients_even_if_the_listener_failed(app, monkeypatch):
    from travelmind import main

    closed: list[str] = []

    async def broken_listener() -> None:
        raise RuntimeError("listener bug")

    async def close_redis() -> None:
        closed.append("redis")

    monkeypatch.setattr(main, "listen_for_evictions", broken_listener)
    monkeypatch.setattr(main, "close_redis", close_redis)
    async with main.lifespan(app):
        await asyncio.sleep(0.01)  # the listener task has failed by now
    assert closed == ["redis"]
