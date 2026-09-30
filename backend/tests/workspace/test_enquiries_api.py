from datetime import UTC, datetime, timedelta

from tests.helpers import exec_as_tenant, make_client, signup

URL = "/api/v1/enquiries"
DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


async def new(client, **fields):
    body = {"origin": "DEL", "destination": "BOM", "depart_date": DAY, "adults": 2} | fields
    return await client.post(URL, json=body)


async def test_create_numbers_and_logs(client, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    first, second = (await new(client)).json(), (await new(client)).json()
    assert (first["number"], second["number"], first["status"]) == ("E-0001", "E-0002", "new")
    assert await exec_as_tenant(
        agency, "SELECT count(*) FROM activity_events WHERE kind='enquiry.created'"
    ) == [(2,)]


async def test_status_transitions(client, airports):
    await signup(client)
    e = (await new(client)).json()
    move = lambda s, **kw: client.post(f"{URL}/{e['id']}/status", json={"status": s} | kw)  # noqa: E731
    assert (await move("won")).status_code == 409
    assert (await move("won")).json()["detail"] == "Can't move an enquiry from new to won."
    assert (await move("quoting")).status_code == 200
    assert (await move("quoted")).status_code == 200
    assert (await move("lost")).status_code == 422
    r = await move("lost", lost_reason="Chose another agency")
    assert r.json()["status"] == "lost" and r.json()["closed_at"] is not None
    r = await move("new")
    assert r.json()["closed_at"] is None and r.json()["lost_reason"] is None


async def test_validation(client, airports):
    await signup(client)
    assert (await new(client, destination="DEL")).status_code == 422
    assert (await new(client, origin="XXX")).json()["detail"] == "Unknown airport code XXX."
    assert (await new(client, budget_minor=5000000)).status_code == 422  # currency missing
    assert (await new(client, assignee_user_id="00000000-0000-0000-0000-000000000000")).json()[
        "detail"
    ] == "That teammate isn't in your agency."


async def test_a_trip_has_at_most_nine_travellers(client, airports):
    await signup(client)
    too_many = "A trip can have at most 9 travellers."
    r = await new(client, adults=7, children_ages=[4, 6, 9])
    assert r.status_code == 422 and r.json()["detail"] == too_many
    e = (await new(client, adults=7, children_ages=[4, 6])).json()
    assert (e["adults"], e["children_ages"]) == (7, [4, 6])
    item = f"{URL}/{e['id']}"
    # Checked against the enquiry as it will be: 7 adults already there plus 3 children.
    r = await client.patch(item, json={"children_ages": [4, 6, 9]})
    assert r.status_code == 422 and r.json()["detail"] == too_many
    r = await client.patch(item, json={"adults": 8})
    assert r.status_code == 422 and r.json()["detail"] == too_many
    r = await client.patch(item, json={"adults": 6, "children_ages": [4, 6, 9]})
    assert r.status_code == 200 and r.json()["adults"] + len(r.json()["children_ages"]) == 9


async def test_filters(client, airports):
    await signup(client)
    await new(client)
    e2 = (await new(client, origin="BOM", destination="GOI")).json()
    await client.post(f"{URL}/{e2['id']}/status", json={"status": "quoting"})
    assert [
        x["number"] for x in (await client.get(URL, params={"status": "quoting"})).json()["items"]
    ] == ["E-0002"]
    assert [x["number"] for x in (await client.get(URL, params={"q": "GOI"})).json()["items"]] == [
        "E-0002"
    ]
    assert [
        x["number"] for x in (await client.get(URL, params={"q": "E-0001"})).json()["items"]
    ] == ["E-0001"]


async def test_enquiries_are_isolated(client, app, airports):
    await signup(client)
    e = (await new(client)).json()
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        assert (await other.get(f"{URL}/{e['id']}")).status_code == 404
        assert (
            await other.post(f"{URL}/{e['id']}/status", json={"status": "quoting"})
        ).status_code == 404


async def test_update_rules_and_null_clearing(client, airports):
    await signup(client)
    e = (await new(client, notes="Window seats", budget_minor=900000, budget_currency="inr")).json()
    assert e["budget"] == {"amount_minor": 900000, "currency": "INR"}
    item = f"{URL}/{e['id']}"
    r = await client.patch(item, json={"destination": "goi", "notes": None, "cabin": "business"})
    assert r.status_code == 200
    assert (r.json()["destination"], r.json()["notes"], r.json()["cabin"]) == (
        "GOI",
        None,
        "business",
    )
    assert (await client.patch(item, json={"adults": None})).status_code == 422
    assert (await client.patch(item, json={"origin": "GOI"})).status_code == 422  # same as dest
    r = await client.patch(item, json={"return_date": "2020-01-01"})
    assert r.json()["detail"] == "The return date can't be before the departure date."
    r = await client.patch(item, json={"budget_minor": None})
    assert r.json()["detail"] == "A budget needs both an amount and a currency."
    r = await client.patch(item, json={"budget_minor": None, "budget_currency": None})
    assert r.status_code == 200 and r.json()["budget"] is None
    r = await client.patch(item, json={"destination": "zzz"})
    assert r.json()["detail"] == "Unknown airport code ZZZ."
    assert (await client.patch(item, json={"source": "copilot"})).json()["source"] == "manual"


async def test_assignment_is_logged_and_filterable(client, airports):
    me = (await signup(client)).json()
    agency, user = me["agency"]["id"], me["user"]
    e = (await new(client)).json()
    assert e["assignee"] is None
    r = await client.patch(f"{URL}/{e['id']}", json={"assignee_user_id": user["id"]})
    assert r.json()["assignee"] == {"id": user["id"], "full_name": user["full_name"]}
    await new(client)
    mine = (await client.get(URL, params={"assignee": user["id"]})).json()
    assert [x["number"] for x in mine["items"]] == ["E-0001"] and mine["total"] == 1
    rows = await exec_as_tenant(
        agency,
        "SELECT summary, data->>'assignee_user_id' FROM activity_events "
        "WHERE kind = 'enquiry.assigned'",
    )
    assert rows == [(f"E-0001 assigned to {user['full_name']}", user["id"])]


async def test_client_link_search_and_quote_count(client, app, airports):
    me = (await signup(client)).json()
    agency = me["agency"]["id"]
    priya = (await client.post("/api/v1/clients", json={"name": "Priya Sharma"})).json()
    e = (await new(client, client_id=priya["id"])).json()
    await new(client)
    assert e["client"] == {"id": priya["id"], "name": "Priya Sharma"} and e["quote_count"] == 0
    found = (await client.get(URL, params={"q": "priya"})).json()
    assert [x["number"] for x in found["items"]] == ["E-0001"] and found["total"] == 1
    everything = (await client.get(URL)).json()
    assert [x["number"] for x in everything["items"]] == ["E-0002", "E-0001"]
    await exec_as_tenant(
        agency,
        "INSERT INTO quotes (id, agency_id, enquiry_id, number, currency) "
        "VALUES (gen_random_uuid(), :a, :e, 1, 'INR')",
        {"a": agency, "e": e["id"]},
    )
    assert (await client.get(f"{URL}/{e['id']}")).json()["quote_count"] == 1
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        r = await new(other, client_id=priya["id"])
        assert r.status_code == 422 and r.json()["detail"] == "Client not found."
        r = await new(other, assignee_user_id=me["user"]["id"])
        assert r.status_code == 422 and r.json()["detail"] == "That teammate isn't in your agency."
        assert (await other.get(URL)).json()["total"] == 0


async def test_service_helpers_back_date(client, airports):
    from travelmind.db import bind_tenant, get_sessionmaker
    from travelmind.workspace.enquiries import EnquiryCreate, create_enquiry, set_enquiry_status

    agency = (await signup(client)).json()["agency"]["id"]
    created_at = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    lost_at = created_at + timedelta(days=3)
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        data = EnquiryCreate(origin="DEL", destination="BOM")
        enquiry = await create_enquiry(db, agency, None, data, now=created_at)
        await set_enquiry_status(db, enquiry, "lost", None, lost_reason=" Price ", now=lost_at)
        await db.commit()
        enquiry_id = enquiry.id
    got = (await client.get(f"{URL}/{enquiry_id}")).json()
    assert (got["created_at"], got["closed_at"], got["lost_reason"]) == (
        "2026-09-01T10:00:00Z",
        "2026-09-04T10:00:00Z",
        "Price",
    )
    rows = await exec_as_tenant(
        agency, "SELECT kind, summary, occurred_at FROM activity_events ORDER BY occurred_at"
    )
    assert rows == [
        ("enquiry.created", "New enquiry E-0001 DEL → BOM", created_at),
        ("enquiry.status_changed", "E-0001 moved to lost", lost_at),
    ]
