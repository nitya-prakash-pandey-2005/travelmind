import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.helpers import DEFAULT_PASSWORD, exec_as_tenant, make_client, signup
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.workspace.activity import record_activity


async def test_events_are_recorded_and_append_only(client):
    agency = (await signup(client)).json()["agency"]["id"]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        await record_activity(db, agency_id=agency, kind="client.created", summary="x" * 400)
        await db.commit()
    rows = await exec_as_tenant(agency, "SELECT kind, length(summary) FROM activity_events")
    assert rows == [("client.created", 300)]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(text("DELETE FROM activity_events"))


async def test_profile_update_and_team_join_are_logged(client, app):
    agency = (await signup(client)).json()["agency"]["id"]
    await client.patch("/api/v1/agency", json={"name": "Alpha Journeys"})
    kinds = [
        r[0]
        for r in await exec_as_tenant(
            agency, "SELECT kind FROM activity_events ORDER BY occurred_at"
        )
    ]
    assert kinds == ["agency.updated"]


async def test_team_join_is_logged(client, app):
    agency = (await signup(client)).json()["agency"]["id"]
    token = (
        await client.post(
            "/api/v1/invitations", json={"email": "ravi@alphatravels.com", "role": "agent"}
        )
    ).json()["token"]
    async with make_client(app) as invitee:
        joined = await invitee.post(
            "/api/v1/invitations/accept",
            json={"token": token, "full_name": "Ravi Agent", "password": DEFAULT_PASSWORD},
        )
        assert joined.status_code == 201
    rows = await exec_as_tenant(agency, "SELECT kind, summary FROM activity_events")
    assert rows == [("team.joined", "Ravi Agent joined the team")]
