import json

from tests.helpers import exec_as_tenant, make_client, run_as_owner, signup

DEMO_LOCKED = "Demo workspaces can't invite people or change settings."


async def test_signup_country_sets_currency_and_timezone(client):
    r = await client.post(
        "/api/v1/auth/signup",
        json={
            "agency_name": "Liberty Trips",
            "full_name": "Sam",
            "email": "sam@liberty.us",
            "password": "correct-horse-battery",
            "country_code": "us",
        },
    )
    agency = r.json()["agency"]
    assert (agency["country_code"], agency["currency"], agency["timezone"], agency["is_demo"]) == (
        "US",
        "USD",
        "America/New_York",
        False,
    )


async def test_signup_is_limited_to_supported_countries(client):
    for country in ("AE", "gb", "SG"):
        r = await client.post(
            "/api/v1/auth/signup",
            json={
                "agency_name": "Gulf Trips",
                "full_name": "Omar",
                "email": "omar@gulf.ae",
                "password": "correct-horse-battery",
                "country_code": country,
            },
        )
        assert r.status_code == 422
        assert r.json()["detail"] == "We support agencies in India and the United States for now."
    # The profile can still name any country (an agency set up before signup was limited).
    await signup(client)
    r = await client.patch("/api/v1/agency", json={"country_code": "AE"})
    assert r.status_code == 200 and r.json()["country_code"] == "AE"


async def test_signup_defaults_to_india(client):
    agency = (await signup(client)).json()["agency"]
    assert (agency["country_code"], agency["currency"]) == ("IN", "INR")


async def test_owner_updates_profile(client):
    await signup(client)
    r = await client.patch(
        "/api/v1/agency",
        json={"name": "Alpha Journeys", "brand_color": "#FF8800", "timezone": "Asia/Dubai"},
    )
    assert r.status_code == 200
    body = (await client.get("/api/v1/agency")).json()
    assert (body["name"], body["brand_color"], body["timezone"]) == (
        "Alpha Journeys",
        "#ff8800",
        "Asia/Dubai",
    )


async def test_profile_validation(client):
    await signup(client)
    assert (await client.patch("/api/v1/agency", json={"brand_color": "orange"})).status_code == 422
    assert (await client.patch("/api/v1/agency", json={"timezone": "Mars/Base"})).status_code == 422
    assert (await client.patch("/api/v1/agency", json={"currency": "XYZ1"})).status_code == 422


async def test_agents_cannot_edit_profile(client, app):
    await signup(client)
    token = (
        await client.post(
            "/api/v1/invitations", json={"email": "ravi@alphatravels.com", "role": "agent"}
        )
    ).json()["token"]
    async with make_client(app) as agent:
        await agent.post(
            "/api/v1/invitations/accept",
            json={"token": token, "full_name": "Ravi", "password": "correct-horse-battery"},
        )
        assert (await agent.patch("/api/v1/agency", json={"name": "Hijack"})).status_code == 403
        assert (await agent.get("/api/v1/agency")).status_code == 200


async def test_me_includes_agency_profile(client):
    await signup(client)
    agency = (await client.get("/api/v1/auth/me")).json()["agency"]
    assert {k: agency[k] for k in ("country_code", "currency", "timezone", "brand_color")} == {
        "country_code": "IN",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
        "brand_color": "#22d3ee",
    }
    assert agency["is_demo"] is False


async def test_profile_update_is_audited_with_only_the_changes(client):
    agency = (await signup(client)).json()["agency"]["id"]
    await client.patch("/api/v1/agency", json={"name": "Alpha Travels", "currency": "usd"})
    rows = await exec_as_tenant(
        agency, "SELECT before::text, after::text FROM audit_log WHERE action = 'agency.updated'"
    )
    assert [tuple(json.loads(v) for v in row) for row in rows] == [
        ({"currency": "INR"}, {"currency": "USD"})
    ]
    # Nothing changed: no audit event, still the profile back.
    r = await client.patch("/api/v1/agency", json={"currency": "USD"})
    assert r.status_code == 200 and r.json()["currency"] == "USD"
    rows = await exec_as_tenant(
        agency, "SELECT count(*) FROM audit_log WHERE action = 'agency.updated'"
    )
    assert rows == [(1,)]


async def test_signup_rejects_a_bad_country(client):
    r = await client.post(
        "/api/v1/auth/signup",
        json={
            "agency_name": "Gulf Trips",
            "full_name": "Omar",
            "email": "omar@gulf.ae",
            "password": "correct-horse-battery",
            "country_code": "UAE",
        },
    )
    assert r.status_code == 422


async def test_demo_workspace_settings_are_locked(client):
    agency = (await signup(client)).json()["agency"]["id"]
    await run_as_owner("UPDATE agencies SET is_demo = true WHERE id = :id", {"id": agency})
    r = await client.patch("/api/v1/agency", json={"name": "Renamed"})
    assert r.status_code == 403 and r.json()["detail"] == DEMO_LOCKED
    body = (await client.get("/api/v1/agency")).json()
    assert body["name"] == "Alpha Travels"
    rows = await exec_as_tenant(
        agency, "SELECT count(*) FROM audit_log WHERE action = 'agency.updated'"
    )
    assert rows == [(0,)]
