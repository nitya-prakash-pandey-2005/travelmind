from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from tests.helpers import exec_as_tenant, make_client, signup
from travelmind.config import get_settings


async def test_demo_workspace_is_created_signed_in_and_labelled(client, airports):
    r = await client.post("/api/v1/demo")
    assert r.status_code == 201
    me = r.json()
    assert me["agency"]["is_demo"] is True and me["agency"]["name"] == "Orbit Travel Co."
    agency = me["agency"]["id"]
    counts = await exec_as_tenant(
        agency,
        """
        SELECT (SELECT count(*) FROM clients), (SELECT count(*) FROM enquiries),
               (SELECT count(*) FROM quotes), (SELECT count(*) FROM activity_events),
               (SELECT count(*) FROM flight_searches)""",
    )
    clients, enquiries, quotes, events, searches = counts[0]
    assert clients == 40 and enquiries == 60 and quotes == 35 and events >= 200 and searches >= 60
    emails = await exec_as_tenant(agency, "SELECT email FROM clients WHERE email IS NOT NULL")
    assert all(e[0].endswith("@example.com") for e in emails)
    summary = {
        k["key"]: k["value"] for k in (await client.get("/api/v1/dashboard/summary")).json()["kpis"]
    }
    assert (
        summary["open_enquiries"] > 0
        and summary["quotes_sent"] > 0
        and summary["win_rate"] is not None
    )
    assert (await client.get("/api/v1/dashboard/departures")).json()["items"]


async def test_demo_workspace_is_isolated_and_labelled(client, app, airports):
    demo = (await client.post("/api/v1/demo")).json()["agency"]["id"]
    async with make_client(app) as real:
        await signup(real)
        assert (await real.get("/api/v1/clients")).json()["total"] == 0
        assert (await real.get("/api/v1/agency")).json()["is_demo"] is False
    offers = await exec_as_tenant(
        demo,
        "SELECT DISTINCT o->'offer'->>'provenance' "
        "FROM quote_versions, jsonb_array_elements(options) o",
    )
    assert offers == [("SANDBOX",)]


def test_demo_plan_is_deterministic_and_fictional():
    from datetime import date

    from travelmind.demo.data import CLIENT_NAMES, COMPANY_NAMES
    from travelmind.demo.generator import build_demo_plan

    routes = [("DEL", "BOM"), ("BOM", "GOI"), ("DEL", "GOI")]
    a = build_demo_plan(seed=42, routes=routes, today=date(2026, 9, 30))
    b = build_demo_plan(seed=42, routes=routes, today=date(2026, 9, 30))
    assert a == b
    assert (
        len(a.clients) == 40
        and len(a.enquiries) == 60
        and sum(1 for e in a.enquiries if e.quote_versions) == 35
    )
    assert {c.name for c in a.clients} <= set(CLIENT_NAMES) | set(COMPANY_NAMES)
    assert all(c.email is None or c.email.endswith("@example.com") for c in a.clients)
    assert build_demo_plan(seed=7, routes=routes, today=date(2026, 9, 30)) != a


async def test_demo_is_rate_limited(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_max_per_ip", 1)
    assert (await client.post("/api/v1/demo")).status_code == 201
    blocked = await client.post("/api/v1/demo")
    assert blocked.status_code == 429 and "Too many demo workspaces" in blocked.json()["detail"]


async def test_expired_demos_are_deleted_with_their_data(client, app, airports):
    from travelmind.db import get_sessionmaker
    from travelmind.demo.cleanup import delete_expired_demos

    demo = (await client.post("/api/v1/demo")).json()["agency"]["id"]
    async with make_client(app) as real:
        real_agency = (await signup(real, email="real@alpha.com", agency_name="Real Co")).json()[
            "agency"
        ]["id"]
    async with get_sessionmaker()() as db:
        assert await delete_expired_demos(db, now=datetime.now(UTC)) == 0
        assert await delete_expired_demos(db, now=datetime.now(UTC) + timedelta(days=8)) == 1
        await db.commit()
    assert await exec_as_tenant(demo, "SELECT count(*) FROM clients") == [(0,)]
    assert await exec_as_tenant(demo, "SELECT count(*) FROM activity_events") == [(0,)]
    async with get_sessionmaker()() as db:
        remaining = (await db.execute(text("SELECT id::text FROM agencies"))).scalars().all()
    assert remaining == [real_agency]


async def test_exit_signs_out(client, airports):
    await client.post("/api/v1/demo")
    assert (await client.post("/api/v1/demo/exit")).status_code == 204
    assert (await client.get("/api/v1/auth/me")).status_code == 401


async def _replay_me(app, token: str) -> int:  # type: ignore[no-untyped-def]
    cookie = get_settings().session_cookie_name
    async with make_client(app) as replay:
        r = await replay.get("/api/v1/auth/me", headers={"Cookie": f"{cookie}={token}"})
    return r.status_code


async def test_starting_a_demo_revokes_the_browsers_previous_session(client, app, airports):
    """Starting a demo replaces the browser's cookie; the session it replaced is revoked
    (database and session cache)."""
    cookie = get_settings().session_cookie_name
    await signup(client)
    old = client.cookies.get(cookie)
    assert (await client.get("/api/v1/auth/me")).status_code == 200  # cached now
    r = await client.post("/api/v1/demo")
    assert r.status_code == 201
    new = client.cookies.get(cookie)
    assert new and new != old
    assert await _replay_me(app, old) == 401
    assert await _replay_me(app, new) == 200
