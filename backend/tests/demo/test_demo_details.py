"""Demo workspace details beyond the headline behaviour: panels, timing, failure and cleanup."""

import asyncio
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from tests.helpers import exec_as_tenant, make_client, run_as_owner
from travelmind.demo import cleanup
from travelmind.demo.data import ROUTES
from travelmind.demo.generator import (
    HISTORY_DAYS,
    WORKDAY_MINUTES,
    DemoUnavailable,
    build_demo_plan,
    demo_routes,
)
from travelmind.reference.search import AirportRecord

TODAY = date(2026, 9, 30)
FIXTURE_ROUTES = [("DEL", "BOM"), ("BOM", "GOI"), ("DEL", "GOI")]


def _lookup(codes: set[str]):
    def lookup(code: str) -> AirportRecord | None:
        if code not in codes:
            return None
        return AirportRecord(
            iata_code=code,
            name=code,
            city=None,
            country_code="IN",
            country_name="India",
            airport_type="large_airport",
            scheduled_service=True,
            latitude=0.0,
            longitude=0.0,
            keywords=None,
        )

    return lookup


def test_routes_keep_known_airports_and_fall_back_to_pairs():
    everything = {code for route in ROUTES for code in route}
    assert demo_routes(_lookup(everything)) == list(ROUTES)
    # The CI fixture knows DEL, BOM and GOI: only two curated routes, so every pair is used.
    pairs = demo_routes(_lookup({"DEL", "BOM", "GOI", "GRU"}))
    assert sorted(pairs) == sorted(
        [(a, b) for a in ("DEL", "BOM", "GOI") for b in ("DEL", "BOM", "GOI") if a != b]
    )
    with pytest.raises(DemoUnavailable):
        demo_routes(_lookup({"GRU"}))


def test_plan_pipeline_mix_dates_and_team_spread():
    plan = build_demo_plan(seed=42, routes=FIXTURE_ROUTES, today=TODAY)
    assert Counter(e.status for e in plan.enquiries) == {
        "new": 12,
        "quoting": 10,
        "quoted": 16,
        "won": 14,
        "lost": 8,
    }
    assert Counter(c.kind for c in plan.clients) == {"individual": 30, "company": 10}
    assert len(plan.extra_searches) == 30
    for enquiry in plan.enquiries:
        assert 1 <= len(enquiry.quote_versions) <= 3 or not enquiry.quote_versions
        if enquiry.status == "won":
            assert TODAY + timedelta(days=3) <= enquiry.depart_date <= TODAY + timedelta(days=75)
        assert enquiry.depart_date > TODAY
    assert set(Counter(e.assignee for e in plan.enquiries).values()) == {15}
    stamps = [c.created for c in plan.clients] + [e.created for e in plan.enquiries]
    stamps += [s.at for s in plan.extra_searches]
    for enquiry in plan.enquiries:
        stamps += [step.at for step in enquiry.status_path]
        for v in enquiry.quote_versions:
            stamps += [v.created] + ([v.sent] if v.sent else [])
    assert all(0 <= days <= HISTORY_DAYS and 0 <= m < WORKDAY_MINUTES for days, m in stamps)
    # Some routes are searched both this week and in the four weeks before it (market pulse).
    recent = Counter((s.origin, s.destination) for s in plan.extra_searches if s.at[0] <= 6)
    earlier = Counter((s.origin, s.destination) for s in plan.extra_searches if 8 <= s.at[0])
    assert any(n >= 2 and earlier[route] >= 2 for route, n in recent.items())
    assert any(s.at[0] == 0 for s in plan.extra_searches)


def test_plan_hands_new_enquiries_to_the_presenter_yesterday():
    plan = build_demo_plan(seed=42, routes=FIXTURE_ROUTES, today=TODAY)
    handoffs = [e for e in plan.enquiries if e.creator != e.assignee]
    assert len(handoffs) == 3
    assert all(e.assignee == 0 and e.creator != 0 for e in handoffs)
    assert all(e.status == "new" and e.created[0] == 1 for e in handoffs)


async def test_a_fresh_demo_has_unread_news_for_the_presenter(client, airports):
    await client.post("/api/v1/demo")
    notes = (await client.get("/api/v1/notifications")).json()
    assert notes["unread"] >= 3
    unread = [i for i in notes["items"] if not i["read"]]
    assert sum(i["kind"] == "enquiry.assigned" for i in unread) >= 3
    assert all("assigned to Demo Presenter" in i["summary"] for i in unread[:3])


async def test_demo_fills_every_panel_in_working_hours(client, airports):
    me = (await client.post("/api/v1/demo")).json()
    agency = me["agency"]["id"]
    assert me["user"]["full_name"] == "Demo Presenter" and me["user"]["role"] == "owner"
    team = (await client.get("/api/v1/team")).json()
    assert sorted(m["full_name"] for m in team) == [
        "Aarav Mehta",
        "Demo Presenter",
        "Leo Fernandes",
        "Sara Khan",
    ]
    assert all(m["email"].endswith("@demo.travelmind.invalid") for m in team)
    assert (await client.get("/api/v1/agency")).json()["is_demo"] is True

    assert (await client.get("/api/v1/dashboard/market-pulse")).json()["routes"]
    health = (await client.get("/api/v1/dashboard/supplier-health")).json()["suppliers"]
    assert [s["supplier"] for s in health] == ["sandbox"]
    members = (await client.get("/api/v1/dashboard/team")).json()["members"]
    assert len(members) == 4 and all(m["enquiries"] > 0 for m in members)

    zone = ZoneInfo("Asia/Kolkata")
    now = datetime.now(UTC)
    moments = await exec_as_tenant(agency, "SELECT occurred_at FROM activity_events")
    for (moment,) in moments:
        local = moment.astimezone(zone)
        assert time(9) <= local.time() < time(19), local
        assert now - timedelta(days=HISTORY_DAYS + 1) < moment <= now
    statuses = dict(
        await exec_as_tenant(agency, "SELECT status, count(*) FROM enquiries GROUP BY status")
    )
    assert statuses == {"new": 12, "quoting": 10, "quoted": 16, "won": 14, "lost": 8}


async def test_a_failed_demo_is_removed(client, app, airports, monkeypatch):
    from travelmind.demo import service

    async def unavailable(*args, **kwargs):
        raise DemoUnavailable("The demo needs airport reference data. Please try again later.")

    monkeypatch.setattr(service, "seed_demo_workspace", unavailable)
    r = await client.post("/api/v1/demo")
    assert r.status_code == 503 and "airport reference data" in r.json()["detail"]
    assert "tm_session" not in r.cookies

    async def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(service, "seed_demo_workspace", broken)
    async with make_client(app, raise_app_exceptions=False) as c:
        assert (await c.post("/api/v1/demo")).status_code == 500

    from travelmind.db import get_sessionmaker

    async with get_sessionmaker()() as db:
        assert (await db.execute(text("SELECT count(*) FROM agencies"))).scalar_one() == 0


async def test_cleanup_keeps_real_and_unexpired_agencies(client, airports):
    from travelmind.db import get_sessionmaker

    demo = (await client.post("/api/v1/demo")).json()["agency"]["id"]
    await run_as_owner(
        "UPDATE agencies SET demo_expires_at = now() - interval '1 minute' WHERE id = :id",
        {"id": demo},
    )
    assert await cleanup.run_demo_cleanup() == 1
    async with get_sessionmaker()() as db:
        assert (await db.execute(text("SELECT count(*) FROM agencies"))).scalar_one() == 0
        assert await cleanup.delete_expired_demos(db, now=datetime.now(UTC)) == 0


async def test_cleanup_failures_are_logged_and_the_loop_keeps_going(monkeypatch):
    calls = 0
    retried = asyncio.Event()

    async def failing(db, *, now):
        nonlocal calls
        calls += 1
        if calls >= 3:
            retried.set()
        raise RuntimeError("database away")

    monkeypatch.setattr(cleanup, "delete_expired_demos", failing)
    assert await cleanup.run_demo_cleanup() == 0
    task = asyncio.create_task(cleanup.demo_cleanup_loop(0.01))
    await asyncio.wait_for(retried.wait(), 5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_lifespan_runs_cleanup_outside_tests_and_stops_it(monkeypatch):
    from travelmind import main
    from travelmind.config import get_settings

    started = asyncio.Event()
    stopped = asyncio.Event()

    async def fake_loop(interval: float) -> None:
        started.set()
        try:
            await asyncio.sleep(3600)
        finally:
            stopped.set()

    monkeypatch.setattr(main, "demo_cleanup_loop", fake_loop)
    app = main.create_app()
    async with main.lifespan(app):
        await asyncio.sleep(0)
        assert not started.is_set()  # environment == "test"
    monkeypatch.setattr(get_settings(), "environment", "development")
    async with main.lifespan(app):
        await asyncio.wait_for(started.wait(), 1)
    assert stopped.is_set()


async def _seed_demo_backlog(expired: int) -> None:
    await run_as_owner(
        "INSERT INTO agencies (id, name, is_demo, demo_expires_at) "
        "SELECT gen_random_uuid(), 'Expired demo ' || n, true, now() - n * interval '1 minute' "
        "FROM generate_series(1, :expired) AS n",
        {"expired": expired},
    )
    await run_as_owner(
        "INSERT INTO agencies (id, name, is_demo, demo_expires_at) VALUES "
        "(gen_random_uuid(), 'Live demo', true, now() + interval '1 day'), "
        "(gen_random_uuid(), 'Real Co', false, NULL)"
    )


async def _agency_names() -> list[str]:
    from travelmind.db import get_sessionmaker

    async with get_sessionmaker()() as db:
        rows = await db.execute(text("SELECT name FROM agencies ORDER BY name"))
        return list(rows.scalars().all())


async def test_cleanup_drains_a_large_backlog_in_committed_batches(monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession

    from travelmind.identity import service as identity_service

    await _seed_demo_backlog(45)
    batches: list[int] = []
    commits = 0
    delete_batch = identity_service.delete_expired_demo_agencies
    commit = AsyncSession.commit

    async def counting_delete(db, *, now, limit):
        ids = await delete_batch(db, now=now, limit=limit)
        batches.append(len(ids))
        return ids

    async def counting_commit(self):
        nonlocal commits
        commits += 1
        await commit(self)

    monkeypatch.setattr(cleanup, "CLEANUP_BATCH_SIZE", 10)
    monkeypatch.setattr(identity_service, "delete_expired_demo_agencies", counting_delete)
    monkeypatch.setattr(AsyncSession, "commit", counting_commit)

    assert await cleanup.run_demo_cleanup() == 45
    assert batches == [10, 10, 10, 10, 5]
    assert commits == 5
    assert await _agency_names() == ["Live demo", "Real Co"]


async def test_cleanup_caps_batches_per_run_and_the_next_run_continues(monkeypatch):
    await _seed_demo_backlog(25)
    monkeypatch.setattr(cleanup, "CLEANUP_BATCH_SIZE", 10)
    monkeypatch.setattr(cleanup, "CLEANUP_MAX_BATCHES", 2)

    assert await cleanup.run_demo_cleanup() == 20
    assert len(await _agency_names()) == 7
    assert await cleanup.run_demo_cleanup() == 5
    assert await _agency_names() == ["Live demo", "Real Co"]


async def test_cleanup_publishes_one_eviction_per_batch(monkeypatch):
    """Each committed batch's agencies go out in one message, not one message per agency."""
    from travelmind.cache import get_shared_redis
    from travelmind.identity.sessioncache import EVICT_CHANNEL

    await _seed_demo_backlog(25)
    monkeypatch.setattr(cleanup, "CLEANUP_BATCH_SIZE", 10)
    listener = get_shared_redis().pubsub()
    await listener.subscribe(EVICT_CHANNEL)
    try:
        assert await cleanup.run_demo_cleanup() == 25
        messages: list[str] = []
        for _ in range(20):  # the subscribe confirmation reads as None too
            m = await listener.get_message(ignore_subscribe_messages=True, timeout=0.05)
            if m is not None:
                messages.append(m["data"].decode())
    finally:
        await listener.unsubscribe()
        await listener.aclose()
    assert [m.split(":", 1)[0] for m in messages] == ["agency"] * 3
    assert [len(m.split(":", 1)[1].split(",")) for m in messages] == [10, 10, 5]


async def test_cleanup_stops_publishing_after_a_failed_publish(monkeypatch):
    """Redis being down costs one publish timeout per run, not one per batch; this process's
    own cache is still evicted for every batch."""
    from travelmind.identity import sessioncache

    await _seed_demo_backlog(25)
    monkeypatch.setattr(cleanup, "CLEANUP_BATCH_SIZE", 10)
    attempts: list[str] = []
    applied: list[str] = []

    async def failing_publish(redis, kind, value) -> bool:  # type: ignore[no-untyped-def]
        attempts.append(value)
        return False

    real_apply = sessioncache.SessionCache.apply

    def recording_apply(self, message: str) -> None:  # type: ignore[no-untyped-def]
        applied.append(message)
        real_apply(self, message)

    monkeypatch.setattr(cleanup, "publish_eviction", failing_publish)
    monkeypatch.setattr(sessioncache.SessionCache, "apply", recording_apply)
    assert await cleanup.run_demo_cleanup() == 25
    assert len(attempts) == 1
    assert len(applied) == 3
