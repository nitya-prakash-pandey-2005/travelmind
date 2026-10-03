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


async def _enquiry(
    agency,
    client_id,
    number,
    *,
    status="new",
    route=("DEL", "BOM"),
    depart=None,
    created_at=None,
):
    from datetime import UTC, datetime

    from tests.helpers import exec_as_tenant

    rows = await exec_as_tenant(
        agency,
        "INSERT INTO enquiries (id, agency_id, client_id, number, source, origin, destination, "
        "depart_date, status, created_at) VALUES (gen_random_uuid(), :a, :c, :n, 'manual', :o, "
        ":d, :dep, :s, :at) RETURNING id",
        {
            "a": agency,
            "c": client_id,
            "n": number,
            "o": route[0],
            "d": route[1],
            "dep": depart,
            "s": status,
            "at": created_at or datetime.now(UTC),
        },
    )
    return rows[0][0]


def _local_today():
    """Today in the agency's time zone (Asia/Kolkata, the signup default)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def _trip(route, depart):
    return {"origin": route[0], "destination": route[1], "depart_date": depart.isoformat()}


async def _quote(
    agency,
    client_id,
    enquiry_id,
    number,
    *,
    status="accepted",
    currency="INR",
    versions=((100000,),),
    sent_version=1,
    accepted_option=None,
):
    """A quote with one version per entry of `versions` (each a tuple of option sell prices)."""
    import json

    from tests.helpers import exec_as_tenant

    rows = await exec_as_tenant(
        agency,
        "INSERT INTO quotes (id, agency_id, enquiry_id, client_id, number, currency, status, "
        "current_version, sent_version, accepted_option) VALUES (gen_random_uuid(), :a, :e, :c, "
        ":n, :cur, :s, :cv, :sv, :ao) RETURNING id",
        {
            "a": agency,
            "e": enquiry_id,
            "c": client_id,
            "n": number,
            "cur": currency,
            "s": status,
            "cv": len(versions),
            "sv": sent_version,
            "ao": accepted_option,
        },
    )
    for version, sells in enumerate(versions, start=1):
        options = [{"sell": {"amount_minor": s, "currency": currency}} for s in sells]
        totals = {"currency": currency, "min_sell_minor": min(sells), "options": len(sells)}
        await exec_as_tenant(
            agency,
            "INSERT INTO quote_versions (id, agency_id, quote_id, version, options, totals) "
            "VALUES (gen_random_uuid(), :a, :q, :v, CAST(:o AS jsonb), CAST(:t AS jsonb))",
            {
                "a": agency,
                "q": rows[0][0],
                "v": version,
                "o": json.dumps(options),
                "t": json.dumps(totals),
            },
        )


async def test_client_stats_won_value_and_trips(client, airports):
    from datetime import timedelta

    agency = (await signup(client)).json()["agency"]["id"]
    priya = (await create(client)).json()
    ravi = (await create(client, name="Ravi Kumar", email="ravi@example.com")).json()
    fresh = (await create(client, name="New Person", email="new@example.com")).json()
    p, r = priya["id"], ravi["id"]
    today = _local_today()

    won = await _enquiry(agency, p, 1, status="won", depart=today - timedelta(days=20))
    await _enquiry(
        agency, p, 2, status="lost", route=("DEL", "GOI"), depart=today - timedelta(days=5)
    )
    await _enquiry(agency, p, 3, status="new", route=("BOM", "DEL"), depart=None)
    soon = await _enquiry(
        agency, p, 4, status="quoting", route=("BOM", "GOI"), depart=today + timedelta(days=17)
    )
    await _enquiry(
        agency, p, 6, status="lost", route=("GOI", "DEL"), depart=today + timedelta(days=3)
    )
    theirs = await _enquiry(agency, r, 5, status="won", depart=today + timedelta(days=90))

    # Accepted on the public page: the chosen option of the version the client was sent.
    await _quote(
        agency,
        p,
        won,
        1,
        versions=((90000,), (100000, 120000), (1,)),
        sent_version=2,
        accepted_option=1,
    )
    # Marked accepted by the agent (no option recorded): the sent version's cheapest option.
    await _quote(agency, p, won, 2, versions=((50000, 70000),))
    await _quote(agency, p, won, 3, currency="USD", versions=((999,),))  # not agency currency
    await _quote(agency, p, soon, 4, status="sent", versions=((40000,),))  # not won
    await _quote(agency, r, theirs, 5, versions=((7000,),))  # another client's

    got = (await client.get(f"{URL}/{p}")).json()
    assert (got["won_value_minor"], got["currency"]) == (120000 + 50000, "INR")
    # Lost enquiries are never trips; the latest past trip and the earliest upcoming one.
    assert got["last_trip"] == _trip(("DEL", "BOM"), today - timedelta(days=20))
    assert got["next_trip"] == _trip(("BOM", "GOI"), today + timedelta(days=17))
    assert (got["enquiry_count"], got["quote_count"]) == (5, 4)

    listed = {c["id"]: c for c in (await client.get(URL)).json()["items"]}
    assert listed[p]["won_value_minor"] == 170000
    assert (listed[p]["last_trip"], listed[p]["next_trip"]) == (got["last_trip"], got["next_trip"])
    assert listed[r]["won_value_minor"] == 7000
    assert listed[r]["last_trip"] is None
    assert listed[r]["next_trip"] == _trip(("DEL", "BOM"), today + timedelta(days=90))
    assert (
        listed[fresh["id"]]["won_value_minor"],
        listed[fresh["id"]]["currency"],
        listed[fresh["id"]]["last_trip"],
        listed[fresh["id"]]["next_trip"],
    ) == (0, "INR", None, None)
    made = (await create(client, name="Made Now", email="made@example.com")).json()
    assert (made["won_value_minor"], made["currency"], made["last_trip"], made["next_trip"]) == (
        0,
        "INR",
        None,
        None,
    )
    updated = (await client.patch(f"{URL}/{p}", json={"phone": "+91 98100 00000"})).json()
    assert updated["won_value_minor"] == 170000 and updated["next_trip"] == got["next_trip"]


async def test_trips_split_at_local_today_and_ties_go_to_the_newest_enquiry(client, airports):
    """A trip departing today (agency time) is the last trip, tomorrow's is the next one. On the
    same departure date the most recently created enquiry wins, then the highest number."""
    from datetime import UTC, datetime, timedelta

    agency = (await signup(client)).json()["agency"]["id"]
    today = _local_today()
    old, new = datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC)

    edge = (await create(client, name="Edge Case", email="edge@example.com")).json()["id"]
    await _enquiry(agency, edge, 1, route=("DEL", "GOI"), depart=today - timedelta(days=1))
    await _enquiry(agency, edge, 2, route=("DEL", "BOM"), depart=today)
    await _enquiry(agency, edge, 3, route=("BOM", "DEL"), depart=today + timedelta(days=1))
    await _enquiry(agency, edge, 4, route=("GOI", "DEL"), depart=today + timedelta(days=2))

    created = (await create(client, name="Tie Created", email="tc@example.com")).json()["id"]
    past, ahead = today - timedelta(days=10), today + timedelta(days=10)
    await _enquiry(agency, created, 12, route=("DEL", "GOI"), depart=past, created_at=old)
    await _enquiry(agency, created, 11, route=("DEL", "BOM"), depart=past, created_at=new)
    await _enquiry(agency, created, 14, route=("BOM", "GOI"), depart=ahead, created_at=old)
    await _enquiry(agency, created, 13, route=("BOM", "DEL"), depart=ahead, created_at=new)

    numbered = (await create(client, name="Tie Number", email="tn@example.com")).json()["id"]
    await _enquiry(agency, numbered, 21, route=("DEL", "GOI"), depart=past, created_at=old)
    await _enquiry(agency, numbered, 22, route=("DEL", "BOM"), depart=past, created_at=old)
    await _enquiry(agency, numbered, 24, route=("BOM", "GOI"), depart=ahead, created_at=old)
    await _enquiry(agency, numbered, 23, route=("BOM", "DEL"), depart=ahead, created_at=old)

    listed = {c["id"]: c for c in (await client.get(URL)).json()["items"]}
    expected = {
        edge: (_trip(("DEL", "BOM"), today), _trip(("BOM", "DEL"), today + timedelta(days=1))),
        created: (_trip(("DEL", "BOM"), past), _trip(("BOM", "DEL"), ahead)),
        numbered: (_trip(("DEL", "BOM"), past), _trip(("BOM", "GOI"), ahead)),
    }
    for client_id, trips in expected.items():
        assert (listed[client_id]["last_trip"], listed[client_id]["next_trip"]) == trips
        got = (await client.get(f"{URL}/{client_id}")).json()
        assert (got["last_trip"], got["next_trip"]) == trips
