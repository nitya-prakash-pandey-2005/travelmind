from tests.helpers import make_client, signup

URL = "/api/v1/clients"


async def create(client, **fields):
    body = {
        "name": "Priya Sharma",
        "email": "priya@example.com",
        "tags": ["VIP", "vip", "family"],
    } | fields
    return await client.post(URL, json=body)


async def test_create_list_get_update(client, airports):
    await signup(client)
    r = await create(client, home_airport="del")
    assert r.status_code == 201
    made = r.json()
    assert (
        made["tags"] == ["vip", "family"]
        and made["home_airport"] == "DEL"
        and made["quote_count"] == 0
    )
    listing = (await client.get(URL)).json()
    assert listing["total"] == 1 and listing["items"][0]["name"] == "Priya Sharma"
    r = await client.patch(
        f"{URL}/{made['id']}", json={"phone": "+91 98100 00000", "tags": ["corporate"]}
    )
    assert r.json()["phone"] == "+91 98100 00000" and r.json()["tags"] == ["corporate"]


async def test_search_and_tag_filter(client, airports):
    await signup(client)
    await create(client)
    await create(
        client,
        name="Nimbus Analytics",
        kind="company",
        email="travel@nimbus.example",
        tags=["corporate"],
    )
    assert [c["name"] for c in (await client.get(URL, params={"q": "nimb"})).json()["items"]] == [
        "Nimbus Analytics"
    ]
    assert [c["name"] for c in (await client.get(URL, params={"tag": "vip"})).json()["items"]] == [
        "Priya Sharma"
    ]


async def test_validation(client, airports):
    await signup(client)
    assert (await create(client, home_airport="XXX")).json()[
        "detail"
    ] == "Unknown airport code XXX."
    await create(client)
    dup = await create(client, email="PRIYA@example.com")
    assert (
        dup.status_code == 409
        and dup.json()["detail"] == "A client with this email already exists."
    )
    assert (await create(client, name="")).status_code == 422
    assert (await create(client, tags=[f"t{i}" for i in range(11)])).status_code == 422


async def test_clients_are_isolated(client, app, airports):
    await signup(client)
    made = (await create(client)).json()
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        assert (await other.get(URL)).json()["total"] == 0
        assert (await other.get(f"{URL}/{made['id']}")).status_code == 404
        assert (await other.patch(f"{URL}/{made['id']}", json={"name": "x"})).status_code == 404


async def test_creation_is_logged(client, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    await create(client)
    from tests.helpers import exec_as_tenant

    rows = await exec_as_tenant(
        agency, "SELECT kind, summary FROM activity_events WHERE kind = 'client.created'"
    )
    assert rows == [("client.created", "Added client Priya Sharma")]


async def test_delete(client, airports):
    await signup(client)
    made = (await create(client)).json()
    assert (await client.delete(f"{URL}/{made['id']}")).status_code == 204
    assert (await client.get(f"{URL}/{made['id']}")).status_code == 404


async def test_update_validation_and_conflicts(client, airports):
    await signup(client)
    made = (await create(client)).json()
    await create(client, name="Nimbus Analytics", email="travel@nimbus.example")
    item = f"{URL}/{made['id']}"
    assert (await client.patch(item, json={"name": None})).status_code == 422
    r = await client.patch(item, json={"home_airport": "zzz"})
    assert r.status_code == 422 and r.json()["detail"] == "Unknown airport code ZZZ."
    r = await client.patch(item, json={"email": "Travel@Nimbus.example"})
    assert r.status_code == 409 and r.json()["detail"] == "A client with this email already exists."
    r = await client.patch(item, json={"email": None, "notes": "  "})
    assert r.status_code == 200 and (r.json()["email"], r.json()["notes"]) == (None, None)


async def test_search_escapes_wildcards(client, airports):
    await signup(client)
    await create(client)
    assert (await client.get(URL, params={"q": "%"})).json()["total"] == 0
    assert (await client.get(URL, params={"q": "_"})).json()["total"] == 0
    assert (await client.get(URL, params={"q": "SHAR"})).json()["total"] == 1


async def test_update_and_delete_are_logged(client, airports):
    from tests.helpers import exec_as_tenant

    agency = (await signup(client)).json()["agency"]["id"]
    made = (await create(client)).json()
    await client.patch(f"{URL}/{made['id']}", json={"phone": "+44 20 7946 0000"})
    await client.delete(f"{URL}/{made['id']}")
    rows = await exec_as_tenant(
        agency, "SELECT kind, summary FROM activity_events ORDER BY occurred_at"
    )
    assert rows == [
        ("client.created", "Added client Priya Sharma"),
        ("client.updated", "Updated client Priya Sharma"),
        ("client.deleted", "Removed client Priya Sharma"),
    ]
    assert (await client.delete(f"{URL}/{made['id']}")).status_code == 404


async def test_control_characters_are_rejected(client, airports):
    await signup(client)
    assert (await create(client, phone="+91\x00")).status_code == 422
    assert (await create(client, notes="bad\x00note")).status_code == 422
    assert (await create(client, tags=["a\nb"])).status_code == 422
    assert (await create(client, notes="line one\nline two")).status_code == 201


async def test_counts_and_clients_with_quotes_cannot_be_deleted(client, airports):
    from tests.helpers import exec_as_tenant

    agency = (await signup(client)).json()["agency"]["id"]
    made = (await create(client)).json()
    ids = {"a": agency, "c": made["id"]}
    await exec_as_tenant(
        agency,
        "INSERT INTO enquiries (id, agency_id, client_id, number, source) "
        "VALUES ('00000000-0000-0000-0000-00000000e001', :a, :c, 1, 'manual')",
        ids,
    )
    await exec_as_tenant(
        agency,
        "INSERT INTO quotes (id, agency_id, enquiry_id, client_id, number, currency) VALUES "
        "(gen_random_uuid(), :a, '00000000-0000-0000-0000-00000000e001', :c, 1, 'INR')",
        ids,
    )
    got = (await client.get(f"{URL}/{made['id']}")).json()
    assert (got["enquiry_count"], got["quote_count"]) == (1, 1)
    r = await client.delete(f"{URL}/{made['id']}")
    assert (
        r.status_code == 409
        and r.json()["detail"] == "This client has quotes, so it can't be deleted."
    )
