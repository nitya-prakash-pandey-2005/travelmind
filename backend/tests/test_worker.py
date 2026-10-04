"""The arq worker's jobs and settings, the job helpers and the demo-generation semaphore."""

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import text
from structlog.testing import capture_logs

from tests.helpers import exec_as_tenant, make_client, run_as_owner, signup
from tests.workspace.test_timelines import agency_of, new_enquiry, sent_quote
from travelmind import jobs, worker
from travelmind.cache import get_shared_redis
from travelmind.db import get_sessionmaker
from travelmind.readcache import agency_version

OVERDUE = "UPDATE quotes SET share_expires_at = now() - interval '1 minute'"


async def _agency_with_sent_quote(app, email: str, name: str) -> str:
    async with make_client(app) as c:
        await signup(c, email=email, agency_name=name)
        quote = await sent_quote(c, await new_enquiry(c))
        assert quote["id"]
        return await agency_of(c)


async def _quote_state(agency: str) -> tuple[list[str], int]:
    statuses = [row[0] for row in await exec_as_tenant(agency, "SELECT status FROM quotes")]
    events = await exec_as_tenant(
        agency, "SELECT count(*) FROM activity_events WHERE kind = 'quote.expired'"
    )
    return statuses, events[0][0]


async def test_expire_sweep_expires_all_agencies(app, airports):
    alpha = await _agency_with_sent_quote(app, "owner@alpha.com", "Alpha Travels")
    beta = await _agency_with_sent_quote(app, "owner@beta.com", "Beta Trips")
    fresh = await _agency_with_sent_quote(app, "owner@gamma.com", "Gamma Tours")
    await exec_as_tenant(alpha, OVERDUE)
    await exec_as_tenant(beta, OVERDUE)
    redis = get_shared_redis()
    versions = {a: await agency_version(redis, UUID(a)) for a in (alpha, beta, fresh)}

    assert await worker.expire_overdue_quotes_all({}) == 2

    assert await _quote_state(alpha) == (["expired"], 1)
    assert await _quote_state(beta) == (["expired"], 1)
    assert await _quote_state(fresh) == (["sent"], 0)
    # Each agency that changed has its read cache invalidated; the untouched one keeps it.
    assert await agency_version(redis, UUID(alpha)) == versions[alpha] + 1
    assert await agency_version(redis, UUID(beta)) == versions[beta] + 1
    assert await agency_version(redis, UUID(fresh)) == versions[fresh]
    # A second sweep finds nothing left to do.
    assert await worker.expire_overdue_quotes_all({}) == 0
    assert await _quote_state(alpha) == (["expired"], 1)


async def test_expire_sweep_keeps_going_after_one_agency_fails(app, airports, monkeypatch):
    alpha = await _agency_with_sent_quote(app, "owner@alpha.com", "Alpha Travels")
    beta = await _agency_with_sent_quote(app, "owner@beta.com", "Beta Trips")
    await exec_as_tenant(alpha, OVERDUE)
    await exec_as_tenant(beta, OVERDUE)
    real = worker.expire_overdue_quotes

    async def flaky(db, agency_id, *, now=None):  # type: ignore[no-untyped-def]
        if str(agency_id) == alpha:
            raise RuntimeError("boom")
        return await real(db, agency_id, now=now)

    monkeypatch.setattr(worker, "expire_overdue_quotes", flaky)
    assert await worker.expire_overdue_quotes_all({}) == 1
    assert await _quote_state(alpha) == (["sent"], 0)
    assert await _quote_state(beta) == (["expired"], 1)


def _alpha_first(alpha: str):
    """A sweep order with `alpha` first, so the agencies after it show what its failure did."""

    def order(ids: list[UUID]) -> list[UUID]:
        return sorted(ids, key=lambda a: str(a) != alpha)

    return order


async def test_expire_sweep_visits_only_agencies_with_overdue_quotes(app, airports, monkeypatch):
    due = await _agency_with_sent_quote(app, "owner@alpha.com", "Alpha Travels")
    live = await _agency_with_sent_quote(app, "owner@beta.com", "Beta Trips")  # not yet due
    async with make_client(app) as c:  # no quotes at all
        await signup(c, email="owner@gamma.com", agency_name="Gamma Tours")
    await exec_as_tenant(due, OVERDUE)
    visited: list[str] = []
    real = worker.expire_overdue_quotes

    async def spy(db, agency_id, *, now=None):  # type: ignore[no-untyped-def]
        visited.append(str(agency_id))
        return await real(db, agency_id, now=now)

    monkeypatch.setattr(worker, "expire_overdue_quotes", spy)
    assert await worker.expire_overdue_quotes_all({}) == 1
    assert visited == [due]
    assert await _quote_state(live) == (["sent"], 0)
    visited.clear()
    assert await worker.expire_overdue_quotes_all({}) == 0
    assert visited == []  # nothing is due any more: nobody is visited


async def test_overdue_agency_lookup_keeps_the_tenant_binding(app, airports):
    """The lookup binds each agency in turn inside the database; the caller's own binding is
    back afterwards, and RLS still hides other agencies' quotes from it."""
    from travelmind.db import bind_tenant, utcnow
    from travelmind.workspace.quotes import agencies_with_overdue_quotes

    alpha = await _agency_with_sent_quote(app, "owner@alpha.com", "Alpha Travels")
    beta = await _agency_with_sent_quote(app, "owner@beta.com", "Beta Trips")
    await exec_as_tenant(alpha, OVERDUE)
    await exec_as_tenant(beta, OVERDUE)
    async with get_sessionmaker()() as db:
        await bind_tenant(db, UUID(alpha))
        await db.execute(text("SELECT 1"))
        found = await agencies_with_overdue_quotes(db, now=utcnow())
        assert sorted(map(str, found)) == sorted([alpha, beta])
        setting = await db.scalar(text("SELECT current_setting('app.agency_id', true)"))
        assert setting == alpha
        assert await db.scalar(text("SELECT count(*) FROM quotes")) == 1  # alpha's only
    async with get_sessionmaker()() as db:  # unbound: the setting stays unset
        await agencies_with_overdue_quotes(db, now=utcnow())
        assert not await db.scalar(text("SELECT current_setting('app.agency_id', true)"))


def test_sweep_order_is_a_shuffled_permutation():
    ids = [UUID(int=n) for n in range(50)]
    orders = {tuple(worker._sweep_order(list(ids))) for _ in range(5)}
    assert all(sorted(o) == ids for o in orders)
    assert len(orders) > 1  # not always the same order, so no agency is always last


async def test_a_failing_rollback_does_not_stop_the_sweep(app, airports, monkeypatch):
    alpha = await _agency_with_sent_quote(app, "owner@alpha.com", "Alpha Travels")
    beta = await _agency_with_sent_quote(app, "owner@beta.com", "Beta Trips")
    gamma = await _agency_with_sent_quote(app, "owner@gamma.com", "Gamma Tours")
    for agency in (alpha, beta, gamma):
        await exec_as_tenant(agency, OVERDUE)
    real = worker.expire_overdue_quotes

    async def broken_rollback():  # type: ignore[no-untyped-def]
        raise ConnectionResetError("connection lost")

    async def flaky(db, agency_id, *, now=None):  # type: ignore[no-untyped-def]
        if str(agency_id) == alpha:
            db.rollback = broken_rollback  # the connection died with the failure
            raise ConnectionResetError("connection lost")
        return await real(db, agency_id, now=now)

    monkeypatch.setattr(worker, "expire_overdue_quotes", flaky)
    monkeypatch.setattr(worker, "_sweep_order", _alpha_first(alpha))
    with capture_logs() as logs:
        assert await worker.expire_overdue_quotes_all({}) == 2
    assert await _quote_state(alpha) == (["sent"], 0)
    assert await _quote_state(beta) == (["expired"], 1)
    assert await _quote_state(gamma) == (["expired"], 1)
    events = [e["event"] for e in logs]
    assert "quote_expiry_rollback_failed" in events
    summary = next(e for e in logs if e["event"] == "overdue_quotes_expired")
    assert (summary["count"], summary["changed"], summary["failed"]) == (2, 2, 1)


async def test_a_failed_agency_leaves_no_cache_marks_behind(app, airports, monkeypatch):
    from travelmind.readcache import mark_agency_changed

    alpha = await _agency_with_sent_quote(app, "owner@alpha.com", "Alpha Travels")
    beta = await _agency_with_sent_quote(app, "owner@beta.com", "Beta Trips")
    await exec_as_tenant(alpha, OVERDUE)
    await exec_as_tenant(beta, OVERDUE)
    redis = get_shared_redis()
    before = await agency_version(redis, UUID(alpha))
    real = worker.expire_overdue_quotes
    leftovers: list[object] = []

    async def flaky(db, agency_id, *, now=None):  # type: ignore[no-untyped-def]
        leftovers.append(db.info.get("tm_changed_agencies"))
        if str(agency_id) == alpha:
            mark_agency_changed(db, agency_id)  # marked, then failed and rolled back
            raise RuntimeError("boom")
        return await real(db, agency_id, now=now)

    monkeypatch.setattr(worker, "expire_overdue_quotes", flaky)
    monkeypatch.setattr(worker, "_sweep_order", _alpha_first(alpha))
    assert await worker.expire_overdue_quotes_all({}) == 1
    assert leftovers == [None, None]  # beta's turn starts with no marks from alpha's
    assert await agency_version(redis, UUID(alpha)) == before  # rolled back: no bump


async def test_cleanup_job_removes_expired_demo(client, airports):
    await signup(client)
    await run_as_owner(
        "INSERT INTO agencies (id, name, is_demo, demo_expires_at) VALUES "
        "(gen_random_uuid(), 'Old demo', true, now() - interval '1 minute'), "
        "(gen_random_uuid(), 'Live demo', true, now() + interval '1 day')"
    )

    assert await worker.cleanup_expired_demos({}) == 1

    async with get_sessionmaker()() as db:
        names = (await db.execute(text("SELECT name FROM agencies ORDER BY name"))).scalars()
        assert list(names) == ["Alpha Travels", "Live demo"]


def test_worker_settings_schedule_the_jobs():
    settings = worker.WorkerSettings
    assert settings.functions == [worker.generate_demo_job]
    crons = {job.name: job for job in settings.cron_jobs}
    assert set(crons) == {"cron:cleanup_expired_demos", "cron:expire_overdue_quotes_all"}
    cleanup, sweep = crons["cron:cleanup_expired_demos"], crons["cron:expire_overdue_quotes_all"]
    assert (cleanup.minute, cleanup.second, cleanup.run_at_startup) == (0, 0, True)
    assert sweep.minute == set(range(0, 60, 5)) and sweep.second == 0
    assert cleanup.unique and sweep.unique  # one run per tick across worker replicas
    assert settings.on_startup is worker.startup and settings.on_shutdown is worker.shutdown
    assert settings.redis_settings.database == 15  # from TM_REDIS_URL (the test database)


async def test_worker_sessions_get_a_60s_statement_timeout():
    async def timeout() -> str:
        async with get_sessionmaker()() as db:
            return str(await db.scalar(text("SHOW statement_timeout")))

    before = await timeout()
    ctx: dict[str, object] = {}
    await worker.startup(ctx)
    try:
        assert await timeout() == "1min"
        async with get_sessionmaker()() as db:  # every transaction, including after a commit
            await db.execute(text("SELECT 1"))
            await db.commit()
            assert await db.scalar(text("SHOW statement_timeout")) == "1min"
    finally:
        await worker.shutdown(ctx)
    assert await timeout() == before  # the hook is the worker's alone


async def test_enqueue_and_job_status():
    job_id = await jobs.enqueue("generate_demo_job", job_id="demo-test-1")
    assert job_id == "demo-test-1"
    assert await jobs.job_status(job_id) == "queued"
    assert await jobs.job_status("no-such-job") == "unknown"
    # The same id is not queued twice.
    assert await jobs.enqueue("generate_demo_job", job_id="demo-test-1") == "demo-test-1"
    assert await get_shared_redis().zcard("arq:queue") == 1


async def test_the_job_queue_has_its_own_redis_pool():
    """arq gets its own connection settings and pool: not the read cache's shared pool with its
    2 s socket timeouts (and not its breaker)."""
    queue = await jobs.queue()
    assert queue.connection_pool is not get_shared_redis().connection_pool
    assert queue.connection_pool.connection_kwargs.get("socket_timeout") is None
    assert await jobs.queue() is queue  # one pool per process
    assert worker.WorkerSettings.redis_settings == jobs.arq_redis_settings()
    await jobs.close_job_queue()
    assert await jobs.queue() is not queue  # reopened after a close


async def test_job_status_reports_done_and_failed(monkeypatch):
    from arq.worker import Worker, func

    async def ok_job(ctx):  # type: ignore[no-untyped-def]
        return "fine"

    async def bad_job(ctx):  # type: ignore[no-untyped-def]
        raise ValueError("nope")

    ok = await jobs.enqueue("ok_job")
    bad = await jobs.enqueue("bad_job")
    w = Worker(
        functions=[func(ok_job, name="ok_job"), func(bad_job, name="bad_job")],
        redis_pool=await jobs.queue(),
        burst=True,
        poll_delay=0,
        handle_signals=False,
    )
    await w.main()
    assert await jobs.job_status(ok) == "done"
    assert await jobs.job_status(bad) == "failed"


async def test_generate_demo_job_builds_a_demo(airports):
    agency_id = await worker.generate_demo_job({})
    rows = await exec_as_tenant(agency_id, "SELECT count(*) FROM clients")
    assert rows[0][0] > 0
    async with get_sessionmaker()() as db:
        demo = await db.scalar(
            text("SELECT is_demo FROM agencies WHERE id = :id"), {"id": agency_id}
        )
    assert demo is True


async def test_demo_semaphore_limits_concurrency(app, airports, monkeypatch):
    from travelmind.demo import service

    monkeypatch.setattr(service, "DEMO_CONCURRENCY", 1)
    release = asyncio.Event()
    started = asyncio.Event()

    async def slow_seed(*args, **kwargs):  # type: ignore[no-untyped-def]
        started.set()
        await release.wait()  # holds its slot until released (seeding itself isn't under test)

    monkeypatch.setattr(service, "seed_demo_workspace", slow_seed)

    async def start_demo() -> int:
        async with make_client(app) as c:
            return (await c.post("/api/v1/demo")).status_code

    first = asyncio.create_task(start_demo())
    await started.wait()
    second = asyncio.create_task(start_demo())
    await asyncio.sleep(0.3)
    assert not second.done()  # waiting for the one slot
    release.set()
    assert await first == 201
    assert await second == 201

    # With a short wait, a request that can't get a slot is turned away.
    monkeypatch.setattr(service, "DEMO_WAIT_SECONDS", 0.1)
    release.clear()
    started.clear()
    first = asyncio.create_task(start_demo())
    await started.wait()
    async with make_client(app) as c:
        busy = await c.post("/api/v1/demo")
    assert busy.status_code == 503
    assert busy.json()["detail"] == "Demo workspaces are busy. Try again in a moment."
    release.set()
    assert await first == 201
    assert await get_shared_redis().zcard("tm:sem:demo") == 0  # every slot handed back


async def test_demo_semaphore_fails_open_when_redis_is_down(monkeypatch):
    from redis.exceptions import ConnectionError as RedisConnectionError

    from travelmind.semaphore import redis_semaphore

    class DownRedis:
        def register_script(self, script):  # type: ignore[no-untyped-def]
            async def run(*args, **kwargs):  # type: ignore[no-untyped-def]
                raise RedisConnectionError("down")

            return run

        async def zrem(self, *args):  # type: ignore[no-untyped-def]
            raise RedisConnectionError("down")

    entered = False
    async with redis_semaphore(DownRedis(), "tm:sem:x", limit=1, ttl_s=60, wait_s=0.1):  # type: ignore[arg-type]
        entered = True
    assert entered


async def test_a_slot_granted_as_the_caller_is_cancelled_is_released():
    """Redis may grant the slot just as the waiting task is cancelled: the slot is given back
    instead of being held until its TTL."""
    from travelmind.semaphore import redis_semaphore

    redis = get_shared_redis()

    class CancelledAfterGrant:
        def register_script(self, script):  # type: ignore[no-untyped-def]
            real = redis.register_script(script)

            async def call(**kwargs):  # type: ignore[no-untyped-def]
                await real(**kwargs)  # Redis took the slot,
                raise asyncio.CancelledError  # and the caller was cancelled before the reply

            return call

        def __getattr__(self, name):  # type: ignore[no-untyped-def]
            return getattr(redis, name)

    with pytest.raises(asyncio.CancelledError):
        async with redis_semaphore(
            CancelledAfterGrant(),  # type: ignore[arg-type]
            "tm:sem:c",
            limit=1,
            ttl_s=60,
            wait_s=1,
        ):
            pytest.fail("the body never runs")
    assert await redis.zcard("tm:sem:c") == 0


async def test_stale_semaphore_slots_lapse():
    from travelmind.semaphore import SemaphoreBusy, redis_semaphore

    redis = get_shared_redis()
    async with redis_semaphore(redis, "tm:sem:t", limit=1, ttl_s=0.2, wait_s=0):
        with pytest.raises(SemaphoreBusy):
            async with redis_semaphore(redis, "tm:sem:t", limit=1, ttl_s=0.2, wait_s=0):
                pass
        await asyncio.sleep(0.3)  # the holder "crashed": its slot times out
        async with redis_semaphore(redis, "tm:sem:t", limit=1, ttl_s=0.2, wait_s=0):
            pass
