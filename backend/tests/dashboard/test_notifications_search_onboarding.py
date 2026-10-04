from datetime import UTC, datetime, timedelta

from tests.dashboard.fixtures import join_agent
from tests.helpers import make_client, run_as_owner, signup
from travelmind.config import Settings

DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
# Agency details and sending quotes have no screen yet: listed as coming, without a link.
ONBOARDING = [
    ("profile", "Add your agency details", "/app/settings", True),
    ("supplier", "Connect a live supplier", "/app/suppliers", True),
    ("team", "Invite a teammate", "/app/team", True),
    ("fare_scan", "Run your first fare scan", "/app/fares", True),
    ("client", "Add a client", "/app", True),
    ("quote", "Send your first quote", "/app/quotes", True),
]


async def _send_quote(client):
    enquiry = (
        await client.post(
            "/api/v1/enquiries", json={"origin": "DEL", "destination": "BOM", "depart_date": DAY}
        )
    ).json()
    offers = (
        await client.post(
            "/api/v1/flights/search",
            json={"origin": "DEL", "destination": "BOM", "departure_date": DAY},
        )
    ).json()["offers"]
    quote = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[0]["id"]], "message": ""},
    )
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 200
    return quote


async def _notifications(client):
    r = await client.get("/api/v1/notifications")
    assert r.status_code == 200
    return r.json()


async def test_notifications_follow_the_owners_quotes(client, app, airports):
    await signup(client)
    async with make_client(app) as agent:
        await join_agent(client, agent)
        joined = await _notifications(client)
        assert joined["unread"] == 1
        assert [(i["kind"], i["summary"], i["read"]) for i in joined["items"]] == [
            ("team.joined", "Ravi Agent joined the team", False)
        ]
        assert (await client.post("/api/v1/notifications/seen")).status_code == 204
        assert (await _notifications(client))["unread"] == 0

        quote = await _send_quote(client)
        r = await agent.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "accepted"})
        assert r.status_code == 200

        owner = await _notifications(client)
        assert owner["unread"] == 1
        assert [(i["kind"], i["read"]) for i in owner["items"]] == [
            ("quote.accepted", False),
            ("team.joined", True),
        ]
        assert set(owner["items"][0]) == {"id", "kind", "summary", "occurred_at", "read"}
        # The agent accepted it themselves, and their own joining is not news to them.
        assert await _notifications(agent) == {"unread": 0, "items": []}
        assert (await client.post("/api/v1/notifications/seen")).status_code == 204
        assert (await _notifications(client))["unread"] == 0


async def test_a_new_teammate_does_not_inherit_old_news(client, app):
    await signup(client)
    async with make_client(app) as first, make_client(app) as second:
        await join_agent(client, first)
        invite = await client.post(
            "/api/v1/invitations", json={"email": "neha@alphatravels.com", "role": "agent"}
        )
        joined = await second.post(
            "/api/v1/invitations/accept",
            json={"token": invite.json()["token"], "full_name": "Neha", "password": "x" * 12},
        )
        assert joined.status_code == 201
        # Ravi joined before Neha had an account: listed, but not unread for her.
        notes = await _notifications(second)
        assert notes["unread"] == 0
        assert [(i["summary"], i["read"]) for i in notes["items"]] == [
            ("Ravi Agent joined the team", True)
        ]
        # Ravi hasn't opened the bell yet: Neha joining after him is news to him.
        assert (await _notifications(first))["unread"] == 1


async def test_seen_stops_at_the_newest_event_shown(client, app):
    await signup(client)
    async with make_client(app) as agent:
        await join_agent(client, agent)
        shown = (await _notifications(client))["items"]
        newest = shown[0]["occurred_at"]
        # Someone else joins after the bell was opened but before it was marked seen.
        invite = await client.post(
            "/api/v1/invitations", json={"email": "neha@alphatravels.com", "role": "agent"}
        )
        async with make_client(app) as late:
            await late.post(
                "/api/v1/invitations/accept",
                json={"token": invite.json()["token"], "full_name": "Neha", "password": "x" * 12},
            )
        r = await client.post("/api/v1/notifications/seen", json={"until": newest})
        assert r.status_code == 204
        notes = await _notifications(client)
        assert notes["unread"] == 1
        assert [(i["summary"], i["read"]) for i in notes["items"]] == [
            ("Neha joined the team", False),
            ("Ravi Agent joined the team", True),
        ]
        # A time in the future counts only up to now; an older one never un-reads anything.
        future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
        assert (
            await client.post("/api/v1/notifications/seen", json={"until": future})
        ).status_code == 204
        assert (await _notifications(client))["unread"] == 0
        assert (
            await client.post("/api/v1/notifications/seen", json={"until": newest})
        ).status_code == 204
        assert (await _notifications(client))["unread"] == 0
        bad = await client.post("/api/v1/notifications/seen", json={"until": "yesterday"})
        assert bad.status_code == 422


async def test_assignment_notifies_the_assignee_only(client, app, airports):
    await signup(client)
    async with make_client(app) as agent:
        agent_user = await join_agent(client, agent)
        r = await client.post(
            "/api/v1/enquiries",
            json={"origin": "DEL", "destination": "BOM", "assignee_user_id": agent_user["id"]},
        )
        assert r.status_code == 201
        notes = await _notifications(agent)
        assert notes["unread"] == 1
        assert [(i["kind"], i["summary"]) for i in notes["items"]] == [
            ("enquiry.assigned", "E-0001 assigned to Ravi Agent")
        ]
        assert [i["kind"] for i in (await _notifications(client))["items"]] == ["team.joined"]


async def test_notifications_are_tenant_scoped(client, app):
    await signup(client)
    async with make_client(app) as agent:
        await join_agent(client, agent)
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        assert await _notifications(other) == {"unread": 0, "items": []}


async def test_onboarding_progression(client, airports):
    me = (await signup(client)).json()
    body = (await client.get("/api/v1/onboarding")).json()
    assert [(i["key"], i["label"], i["href"], i["available"]) for i in body["items"]] == ONBOARDING
    assert (body["completed"], body["total"]) == (0, 6)
    assert not any(i["done"] for i in body["items"])

    await client.post(
        "/api/v1/flights/search",
        json={"origin": "DEL", "destination": "BOM", "departure_date": DAY},
    )
    await client.post("/api/v1/clients", json={"name": "Meera Kapoor"})
    body = (await client.get("/api/v1/onboarding")).json()
    assert {i["key"] for i in body["items"] if i["done"]} == {"fare_scan", "client"}
    assert body["completed"] == 2

    await client.patch("/api/v1/agency", json={"brand_color": "#112233"})
    body = (await client.get("/api/v1/onboarding")).json()
    assert {i["key"] for i in body["items"] if i["done"]} == {"profile", "fare_scan", "client"}

    await run_as_owner(
        "UPDATE agencies SET is_demo = true WHERE id = :id", {"id": me["agency"]["id"]}
    )
    body = (await client.get("/api/v1/onboarding")).json()
    assert {i["key"] for i in body["items"] if i["done"]} == {
        "profile",
        "supplier",
        "fare_scan",
        "client",
    }


async def test_onboarding_team_quote_and_supplier_key(seeded, app, monkeypatch):
    client, _, _ = seeded
    body = (await client.get("/api/v1/onboarding")).json()
    assert {i["key"] for i in body["items"] if i["done"]} == {"fare_scan", "client", "quote"}

    async with make_client(app) as agent:
        await join_agent(client, agent)
    monkeypatch.setattr(
        "travelmind.dashboard.router.get_settings",
        lambda: Settings(_env_file=None, liteapi_key="sand_not_a_real_key"),
    )
    body = (await client.get("/api/v1/onboarding")).json()
    assert {i["key"] for i in body["items"] if i["done"]} == {
        "supplier",
        "team",
        "fare_scan",
        "client",
        "quote",
    }
    assert body["completed"] == 5


async def test_global_search(seeded):
    client, _, _ = seeded

    async def search(q):
        r = await client.get("/api/v1/search", params={"q": q})
        assert r.status_code == 200
        return r.json()

    by_name = await search("meera")
    assert [{k: v for k, v in c.items() if k != "id"} for c in by_name["clients"]] == [
        {
            "name": "Meera Kapoor",
            "email": "meera@example.com",
            "company_name": "Nimbus Analytics Pvt Ltd",
        }
    ]
    assert [e["number"] for e in by_name["enquiries"]] == ["E-0004", "E-0001"]
    assert [(q["number"], q["status"], q["client_name"]) for q in by_name["quotes"]] == [
        ("Q-0003", "accepted", "Meera Kapoor")
    ]
    assert [c["name"] for c in (await search("NIMBUS"))["clients"]] == ["Meera Kapoor"]

    by_number = await search("E-0002")
    assert by_number["clients"] == [] and by_number["quotes"] == []
    assert [{k: v for k, v in e.items() if k != "id"} for e in by_number["enquiries"]] == [
        {"number": "E-0002", "origin": "BOM", "destination": "GOI", "status": "new"}
    ]
    quote = await search("q-0001")
    assert quote["clients"] == [] and quote["enquiries"] == []
    assert [(q["number"], q["status"], q["client_name"]) for q in quote["quotes"]] == [
        ("Q-0001", "sent", "Rohan Shah")
    ]
    assert (await search("E-0099"))["enquiries"] == []
    assert [e["number"] for e in (await search("goi"))["enquiries"]] == [
        "E-0002",
        "E-0003",
        "E-0005",
    ]
    assert await search("%_") == {"clients": [], "enquiries": [], "quotes": []}
    for short in ("a", " a ", ""):
        assert (await client.get("/api/v1/search", params={"q": short})).status_code == 422
    assert (await client.get("/api/v1/search")).status_code == 422
