from datetime import UTC, datetime, timedelta

from tests.helpers import exec_as_tenant, make_client, signup

DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
ITEM_KEYS = {"id", "kind", "summary", "occurred_at", "actor"}


async def agency_of(client) -> str:
    return (await client.get("/api/v1/agency")).json()["id"]


async def new_client(client, name: str, email: str) -> dict:
    return (await client.post("/api/v1/clients", json={"name": name, "email": email})).json()


async def new_enquiry(client, client_id: str | None = None, **fields) -> dict:
    body = {"origin": "DEL", "destination": "BOM", "depart_date": DAY, "client_id": client_id}
    return (await client.post("/api/v1/enquiries", json=body | fields)).json()


async def sent_quote(client, enquiry: dict) -> dict:
    offers = (
        await client.post(
            "/api/v1/flights/search",
            json={
                "origin": enquiry["origin"],
                "destination": enquiry["destination"],
                "departure_date": DAY,
            },
        )
    ).json()["offers"]
    quote = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[0]["id"]], "message": ""},
    )
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 200
    return quote


async def timeline(client, kind: str, entity_id: str) -> list[dict]:
    r = await client.get(f"/api/v1/{kind}/{entity_id}/activity")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert all(set(item) == ITEM_KEYS for item in items)
    times = [item["occurred_at"] for item in items]
    assert [datetime.fromisoformat(t) for t in times] == sorted(
        (datetime.fromisoformat(t) for t in times), reverse=True
    )
    return items


def summaries(items: list[dict]) -> set[str]:
    return {item["summary"] for item in items}


async def test_enquiry_timeline_covers_the_enquiry_and_its_quotes(client, airports):
    me = (await signup(client)).json()["user"]
    priya = await new_client(client, "Priya Sharma", "priya@example.com")
    enquiry = await new_enquiry(client, priya["id"])
    other = await new_enquiry(client, priya["id"], destination="GOI")
    quote = await sent_quote(client, enquiry)
    await sent_quote(client, other)

    items = await timeline(client, "enquiries", enquiry["id"])
    assert summaries(items) == {
        "New enquiry E-0001 DEL → BOM",
        "New quote Q-0001 for E-0001",
        "E-0001 moved to quoting",
        "Q-0001 version 1 (1 options)",
        "Q-0001 sent",
        "E-0001 moved to quoted",
    }, summaries(items)
    assert {item["kind"] for item in items} >= {
        "enquiry.created",
        "quote.created",
        "quote.version_added",
        "quote.sent",
    }
    assert all(item["actor"] == {"id": me["id"], "full_name": "Asha Owner"} for item in items)
    assert quote["number"] == "Q-0001"


async def test_client_timeline_covers_client_enquiries_and_quotes(client, airports):
    await signup(client)
    priya = await new_client(client, "Priya Sharma", "priya@example.com")
    ravi = await new_client(client, "Ravi Kumar", "ravi@example.com")
    enquiry = await new_enquiry(client, priya["id"])
    await sent_quote(client, enquiry)
    await new_enquiry(client, ravi["id"], destination="GOI")
    await new_enquiry(client, None, origin="BOM", destination="GOI")

    items = await timeline(client, "clients", priya["id"])
    assert summaries(items) == {
        "Added client Priya Sharma",
        "New enquiry E-0001 DEL → BOM",
        "New quote Q-0001 for E-0001",
        "E-0001 moved to quoting",
        "Q-0001 version 1 (1 options)",
        "Q-0001 sent",
        "E-0001 moved to quoted",
    }, summaries(items)
    assert summaries(await timeline(client, "clients", ravi["id"])) == {
        "Added client Ravi Kumar",
        "New enquiry E-0002 DEL → GOI",
    }


async def test_quote_timeline_is_the_quote_only(client, airports):
    await signup(client)
    enquiry = await new_enquiry(client)
    quote = await sent_quote(client, enquiry)
    items = await timeline(client, "quotes", quote["id"])
    assert summaries(items) == {
        "New quote Q-0001 for E-0001",
        "Q-0001 version 1 (1 options)",
        "Q-0001 sent",
    }
    assert {item["kind"] for item in items} == {
        "quote.created",
        "quote.version_added",
        "quote.sent",
    }


async def test_timelines_are_newest_first_and_capped_at_fifty(client, airports):
    await signup(client)
    agency = await agency_of(client)
    enquiry = await new_enquiry(client)
    quote = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    base = datetime(2026, 1, 1, 9, 0, tzinfo=UTC)
    for i in range(55):
        await exec_as_tenant(
            agency,
            "INSERT INTO activity_events "
            "(id, agency_id, occurred_at, kind, entity_type, entity_id, summary, data) "
            "VALUES (gen_random_uuid(), :a, :at, 'quote.viewed', 'quote', :q, :s, '{}')",
            {"a": agency, "at": base + timedelta(minutes=i), "q": quote["id"], "s": f"view {i}"},
        )
    items = await timeline(client, "quotes", quote["id"])
    assert len(items) == 50
    # The real events (created just now) come first, then the newest inserted ones.
    inserted = [item for item in items if item["summary"].startswith("view ")]
    assert [item["summary"] for item in inserted][:3] == ["view 54", "view 53", "view 52"]
    assert inserted[0]["actor"] is None
    assert (await timeline(client, "enquiries", enquiry["id"]))[0]["summary"] in {
        "New quote Q-0001 for E-0001",
        "E-0001 moved to quoting",
    }


async def test_timelines_are_isolated_between_agencies(client, app, airports):
    await signup(client)
    priya = await new_client(client, "Priya Sharma", "priya@example.com")
    enquiry = await new_enquiry(client, priya["id"])
    quote = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        for kind, entity_id, message in (
            ("enquiries", enquiry["id"], "Enquiry not found."),
            ("clients", priya["id"], "Client not found."),
            ("quotes", quote["id"], "Quote not found."),
        ):
            r = await other.get(f"/api/v1/{kind}/{entity_id}/activity")
            assert (r.status_code, r.json()["detail"]) == (404, message)
    async with make_client(app) as anonymous:
        assert (await anonymous.get(f"/api/v1/quotes/{quote['id']}/activity")).status_code == 401
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.get(f"/api/v1/enquiries/{missing}/activity")).status_code == 404


async def test_quote_timeline_shows_lazy_expiry(client, airports):
    await signup(client)
    agency = await agency_of(client)
    enquiry = await new_enquiry(client)
    quote = await sent_quote(client, enquiry)
    await exec_as_tenant(agency, "UPDATE quotes SET share_expires_at = now() - interval '1 minute'")
    items = await timeline(client, "quotes", quote["id"])
    assert items[0]["kind"] == "quote.expired" and items[0]["summary"] == "Q-0001 expired"
    assert items[0]["actor"] is None
    assert "Q-0001 expired" in summaries(await timeline(client, "enquiries", enquiry["id"]))
    # Expiry was kept (one event), not recomputed per read.
    rows = await exec_as_tenant(
        agency, "SELECT count(*) FROM activity_events WHERE kind = 'quote.expired'"
    )
    assert rows == [(1,)]
