from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from tests.dashboard.fixtures import DAY, add_search, join_agent
from tests.helpers import make_client
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.workspace.enquiries import EnquiryCreate, create_enquiry, set_enquiry_status


async def test_market_pulse(seeded):
    client, _, _ = seeded
    route = (await client.get("/api/v1/dashboard/market-pulse")).json()["routes"][0]
    fares = (route["origin"], route["destination"], route["current_minor"], route["previous_minor"])
    assert fares == ("DEL", "BOM", 455000, 510000)
    assert route["change_pct"] == -10.8 and route["provenance"] == "SANDBOX"
    assert len(route["weekly"]) == 8


async def test_market_pulse_routes_and_weeks(seeded):
    client, _, _ = seeded
    body = (await client.get("/api/v1/dashboard/market-pulse")).json()
    assert body["currency"] == "INR"
    # DEL-GOI has no searches this week, so it is not compared; biggest mover first.
    assert [(r["origin"], r["destination"]) for r in body["routes"]] == [
        ("DEL", "BOM"),
        ("BOM", "DEL"),
    ]
    del_bom, bom_del = body["routes"]
    # The child and USD searches are left out; searches without offers have no fare.
    assert del_bom["samples"] == 4
    assert del_bom["weekly"] == [None, None, None, None, None, 500000, 520000, 455000]
    assert bom_del == {
        "origin": "BOM",
        "destination": "DEL",
        "current_minor": 400000,
        "previous_minor": 400000,
        "change_pct": 0.0,
        "samples": 4,
        "weekly": [None, None, None, None, None, 400000, 400000, 400000],
        "provenance": "LIVE",
    }


async def test_supplier_health(seeded):
    client, _, _ = seeded
    s = (await client.get("/api/v1/dashboard/supplier-health", params={"range": "7d"})).json()[
        "suppliers"
    ][0]
    assert (s["supplier"], s["calls"], s["ok"], s["success_pct"], s["p50_ms"]) == (
        "sandbox",
        4,
        3,
        75.0,
        200,
    )


async def test_supplier_health_details(seeded):
    client, _, _ = seeded
    week = (await client.get("/api/v1/dashboard/supplier-health", params={"range": "7d"})).json()
    # Latency and offers describe successful calls: the 12 s error only lowers the success rate.
    assert week["suppliers"] == [
        {
            "supplier": "sandbox",
            "kind": "flights",
            "calls": 4,
            "ok": 3,
            "success_pct": 75.0,
            "p50_ms": 200,
            "p95_ms": 290,
            "avg_offers": 7.0,
        },
        {
            "supplier": "duffel",
            "kind": "flights",
            "calls": 2,
            "ok": 2,
            "success_pct": 100.0,
            "p50_ms": 600,
            "p95_ms": 690,
            "avg_offers": 5.5,
        },
    ]
    day = (await client.get("/api/v1/dashboard/supplier-health")).json()  # default 24h
    assert day["suppliers"] == [
        {
            "supplier": "sandbox",
            "kind": "flights",
            "calls": 1,
            "ok": 0,
            "success_pct": 0.0,
            "p50_ms": None,
            "p95_ms": None,
            "avg_offers": None,
        }
    ]
    bad = await client.get("/api/v1/dashboard/supplier-health", params={"range": "30d"})
    assert bad.status_code == 422


async def test_pipeline_stages(seeded):
    client, _, _ = seeded
    body = (await client.get("/api/v1/dashboard/pipeline")).json()
    assert body == {
        "currency": "INR",
        "stages": [
            {"status": "new", "count": 2, "value_minor": 0},
            # E-0003's most recent quote is the Q-0002 draft (700000).
            {"status": "quoting", "count": 1, "value_minor": 700000},
            {"status": "quoted", "count": 0, "value_minor": 0},
            {"status": "won", "count": 1, "value_minor": 800000},
            {"status": "lost", "count": 1, "value_minor": 0},
        ],
    }


async def test_activity_is_newest_first_and_pages(seeded):
    client, _, _ = seeded
    first = (await client.get("/api/v1/dashboard/activity")).json()["items"]
    assert len(first) == 20
    times = [datetime.fromisoformat(i["occurred_at"]) for i in first]
    assert times == sorted(times, reverse=True)
    newest = first[0]
    assert newest["kind"] == "search.flights" and newest["summary"] == "Searched DEL → BOM"
    assert newest["actor"]["full_name"] == "Asha Owner"
    assert newest["entity_type"] is None and newest["entity_id"] is None
    quote_sent = next(i for i in first if i["kind"] == "quote.sent")
    assert quote_sent["entity_type"] == "quote" and UUID(quote_sent["entity_id"])

    page = (
        await client.get(
            "/api/v1/dashboard/activity", params={"limit": 3, "before": first[3]["occurred_at"]}
        )
    ).json()["items"]
    assert len(page) == 3
    assert all(datetime.fromisoformat(i["occurred_at"]) < times[3] for i in page)
    # first[4] and first[5] happened at the same moment: ties keep one order across pages.
    assert [i["id"] for i in page] == [i["id"] for i in first[4:7]]
    # Paging from first[4] by time alone skips first[5], which happened at the same instant;
    # the item's id keeps it.
    assert first[4]["occurred_at"] == first[5]["occurred_at"]
    tied = {"limit": 3, "before": first[4]["occurred_at"], "before_id": first[4]["id"]}
    page = (await client.get("/api/v1/dashboard/activity", params=tied)).json()["items"]
    assert [i["id"] for i in page] == [i["id"] for i in first[5:8]]
    assert (await client.get("/api/v1/dashboard/activity", params={"limit": 0})).status_code == 422
    assert (
        await client.get("/api/v1/dashboard/activity", params={"before": "yesterday"})
    ).status_code == 422


async def test_team_includes_members_with_nothing_yet(seeded, app):
    client, _, _ = seeded
    async with make_client(app) as agent:
        agent_user = await join_agent(client, agent)
    members = (await client.get("/api/v1/dashboard/team")).json()["members"]
    assert members == [
        {
            "user": {
                "id": (await client.get("/api/v1/auth/me")).json()["user"]["id"],
                "full_name": "Asha Owner",
                "role": "owner",
            },
            "enquiries": 5,
            "quotes_sent": 2,
            "won_value_minor": 800000,
        },
        {
            "user": {"id": agent_user["id"], "full_name": "Ravi Agent", "role": "agent"},
            "enquiries": 0,
            "quotes_sent": 0,
            "won_value_minor": 0,
        },
    ]
    week = (await client.get("/api/v1/dashboard/team", params={"range": "7d"})).json()["members"]
    # This week: E-0002 and E-0003 were created and Q-0001 sent; Q-0003 was won 8 days ago.
    assert [(m["enquiries"], m["quotes_sent"], m["won_value_minor"]) for m in week] == [
        (2, 1, 0),
        (0, 0, 0),
    ]


async def test_departures_are_upcoming_won_trips(seeded):
    client, agency_id, now = seeded
    today = now.astimezone(ZoneInfo("Asia/Kolkata")).date()
    user_id = UUID((await client.get("/api/v1/auth/me")).json()["user"]["id"])
    async with get_sessionmaker()() as db:  # a won trip that already departed
        await bind_tenant(db, agency_id)
        past = await create_enquiry(
            db,
            agency_id,
            user_id,
            EnquiryCreate(origin="DEL", destination="GOI", depart_date=today - timedelta(days=2)),
            now=now - timedelta(days=15),
        )
        await set_enquiry_status(db, past, "quoted", user_id, now=now - timedelta(days=14))
        await set_enquiry_status(db, past, "won", user_id, now=now - timedelta(days=13))
        await db.commit()
    items = (await client.get("/api/v1/dashboard/departures")).json()["items"]
    assert [{k: v for k, v in item.items() if k != "enquiry_id"} for item in items] == [
        {
            "number": "E-0004",
            "client": "Meera Kapoor",
            "origin": "BOM",
            "destination": "DEL",
            "depart_date": (now + timedelta(days=20)).date().isoformat(),
            "travellers": 3,
        }
    ]
    assert UUID(items[0]["enquiry_id"])


async def test_market_pulse_route_with_sandbox_and_live_sources_is_mixed(seeded):
    client, agency_id, now = seeded
    me = (await client.get("/api/v1/auth/me")).json()
    user_id = UUID(me["user"]["id"])
    both = [("sandbox", "ok", 4, 100), ("duffel", "ok", 3, 600)]
    sandbox_only = [("sandbox", "ok", 4, 100), ("duffel", "error", 0, 9000)]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        for at, route, cheapest, sources in [
            (1 * DAY, ("GOI", "DEL"), 300000, both),
            (3 * DAY, ("GOI", "DEL"), 310000, sandbox_only),
            (10 * DAY, ("GOI", "DEL"), 350000, both),
            (12 * DAY, ("GOI", "DEL"), 360000, sandbox_only),
            # A failed live call doesn't make a route's fares live.
            (1 * DAY, ("BOM", "GOI"), 200000, sandbox_only),
            (2 * DAY, ("BOM", "GOI"), 210000, sandbox_only),
            (9 * DAY, ("BOM", "GOI"), 250000, sandbox_only),
            (11 * DAY, ("BOM", "GOI"), 260000, sandbox_only),
        ]:
            await add_search(db, agency_id, user_id, now - at, route, cheapest, sources)
        await db.commit()
    routes = {
        (r["origin"], r["destination"]): r
        for r in (await client.get("/api/v1/dashboard/market-pulse")).json()["routes"]
    }
    assert routes["GOI", "DEL"]["provenance"] == "MIXED"
    assert routes["GOI", "DEL"]["samples"] == 4
    assert routes["BOM", "GOI"]["provenance"] == "SANDBOX"
    assert routes["DEL", "BOM"]["provenance"] == "SANDBOX"
    assert routes["BOM", "DEL"]["provenance"] == "LIVE"
