from tests.helpers import DEFAULT_PASSWORD, exec_as_tenant, make_client, signup

INVITE = "/api/v1/invitations"
ACCEPT = "/api/v1/invitations/accept"
INVALID = {"detail": "This invitation link is invalid or has expired."}


async def _invite(client, email="agent@alphatravels.com", role="agent"):
    return await client.post(INVITE, json={"email": email, "role": role})


async def _accept(client, token, full_name="Ravi Agent"):
    return await client.post(
        ACCEPT, json={"token": token, "full_name": full_name, "password": DEFAULT_PASSWORD}
    )


async def test_owner_invites_agent_who_joins_same_agency(client, app):
    owner = (await signup(client)).json()
    invite = await _invite(client)
    assert invite.status_code == 201
    assert invite.json()["email"] == "agent@alphatravels.com"
    async with make_client(app) as invitee:
        joined = await _accept(invitee, invite.json()["token"])
        assert joined.status_code == 201
        assert joined.json()["user"]["role"] == "agent"
        assert joined.json()["agency"]["id"] == owner["agency"]["id"]
        assert (await invitee.get("/api/v1/auth/me")).status_code == 200
    team = await client.get("/api/v1/team")
    assert {m["email"] for m in team.json()} == {
        "owner@alphatravels.com",
        "agent@alphatravels.com",
    }


async def test_agent_cannot_invite(client, app):
    await signup(client)
    token = (await _invite(client)).json()["token"]
    async with make_client(app) as agent:
        await _accept(agent, token)
        r = await _invite(agent, email="another@alphatravels.com")
    assert r.status_code == 403


async def test_owner_role_cannot_be_invited(client):
    await signup(client)
    r = await _invite(client, role="owner")
    assert r.status_code == 422


async def test_invitation_cannot_be_reused(client, app):
    await signup(client)
    token = (await _invite(client)).json()["token"]
    async with make_client(app) as first:
        assert (await _accept(first, token)).status_code == 201
    async with make_client(app) as second:
        r = await _accept(second, token, full_name="Imposter")
    assert r.status_code == 400
    assert r.json() == INVALID


async def test_expired_invitation_is_rejected(client, app):
    owner = (await signup(client)).json()
    token = (await _invite(client)).json()["token"]
    await exec_as_tenant(
        owner["agency"]["id"], "UPDATE invitations SET expires_at = now() - interval '1 minute'"
    )
    async with make_client(app) as invitee:
        r = await _accept(invitee, token)
    assert r.status_code == 400
    assert r.json() == INVALID


async def test_forged_or_garbage_tokens_are_rejected(client, app):
    await signup(client)
    token = (await _invite(client)).json()["token"]
    async with make_client(app) as beta:
        beta_body = (
            await signup(beta, email="owner@betatrips.com", agency_name="Beta Trips")
        ).json()
    _, secret = token.split(".", 1)
    forged = f"{beta_body['agency']['id']}.{secret}"
    async with make_client(app) as attacker:
        assert (await _accept(attacker, forged)).json() == INVALID
        assert (await _accept(attacker, "not-a-token-at-all")).json() == INVALID


async def test_cannot_invite_someone_with_an_account(client, app):
    await signup(client)
    async with make_client(app) as beta:
        await signup(beta, email="owner@betatrips.com", agency_name="Beta Trips")
    r = await _invite(client, email="owner@betatrips.com")
    assert r.status_code == 409


async def test_pending_invitations_and_team_are_tenant_scoped(client, app):
    await signup(client)
    await _invite(client, email="a1@alphatravels.com")
    async with make_client(app) as beta:
        await signup(beta, email="owner@betatrips.com", agency_name="Beta Trips")
        await _invite(beta, email="b1@betatrips.com")
        listed = (await beta.get(INVITE)).json()
        team = (await beta.get("/api/v1/team")).json()
    assert [i["email"] for i in listed] == ["b1@betatrips.com"]
    assert "token" not in listed[0]
    assert [m["email"] for m in team] == ["owner@betatrips.com"]
