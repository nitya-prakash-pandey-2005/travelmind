from tests.helpers import (
    DEFAULT_PASSWORD,
    exec_as_tenant,
    make_client,
    on_event_loop,
    run_as_owner,
    signup,
)
from travelmind.identity import passwords

LOGIN = "/api/v1/auth/login"
SESSION_COOKIE = "tm_session"


async def test_signup_creates_agency_owner_and_session(client):
    r = await signup(client)
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["email"] == "owner@alphatravels.com"
    assert body["user"]["role"] == "owner"
    assert body["agency"]["name"] == "Alpha Travels"
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json() == body


async def test_session_cookie_is_httponly_and_lax(client):
    r = await signup(client)
    set_cookie = r.headers["set-cookie"].lower()
    assert set_cookie.startswith(f"{SESSION_COOKIE}=")
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


async def test_email_is_normalized(client, app):
    r = await signup(client, email="  Owner@AlphaTravels.COM ")
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "owner@alphatravels.com"
    async with make_client(app) as other:
        duplicate = await signup(other, email="OWNER@alphatravels.com", agency_name="Copycat")
        assert duplicate.status_code == 409
        assert duplicate.json() == {"detail": "An account with this email already exists."}
        login = await other.post(
            LOGIN, json={"email": "owner@ALPHATRAVELS.com", "password": DEFAULT_PASSWORD}
        )
        assert login.status_code == 200


async def test_short_password_is_rejected(client):
    r = await signup(client, password="short")
    assert r.status_code == 422


async def test_login_failures_are_generic(client, app):
    await signup(client)
    async with make_client(app) as anon:
        wrong = await anon.post(
            LOGIN, json={"email": "owner@alphatravels.com", "password": "wrong-password-123"}
        )
        unknown = await anon.post(
            LOGIN, json={"email": "nobody@alphatravels.com", "password": "wrong-password-123"}
        )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email or password."}


async def test_me_requires_session(client):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "Please sign in."}


async def test_logout_revokes_session_server_side(client, app):
    await signup(client)
    token = client.cookies.get(SESSION_COOKIE)
    out = await client.post("/api/v1/auth/logout")
    assert out.status_code == 204
    async with make_client(app) as replay:
        r = await replay.get("/api/v1/auth/me", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    assert r.status_code == 401


async def test_expired_session_is_rejected(client):
    await signup(client)
    await run_as_owner("UPDATE sessions SET expires_at = now() - interval '1 minute'")
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "Your session has expired. Please sign in again."}


async def test_signup_and_login_are_audited(client, app):
    body = (await signup(client)).json()
    async with make_client(app) as again:
        await again.post(
            LOGIN, json={"email": "owner@alphatravels.com", "password": DEFAULT_PASSWORD}
        )
    rows = await exec_as_tenant(
        body["agency"]["id"], "SELECT action FROM audit_log ORDER BY created_at"
    )
    assert [row[0] for row in rows] == ["agency.created", "auth.login"]


async def test_control_characters_in_full_name_are_rejected(client):
    r = await signup(client, full_name="Asha\u0000Owner")
    assert r.status_code == 422


async def test_control_characters_in_agency_name_are_rejected(client):
    r = await signup(client, agency_name="Beta\u0000Travels")
    assert r.status_code == 422


async def test_non_ascii_names_are_accepted(client):
    r = await signup(client, full_name="Zoë Ağaoğlu", agency_name="Ağaoğlu Seyahat")
    assert r.status_code == 201
    assert r.json()["user"]["full_name"] == "Zoë Ağaoğlu"
    assert r.json()["agency"]["name"] == "Ağaoğlu Seyahat"


class _LoopCheckingHasher:
    """Wraps the real argon2 hasher and records whether each call ran on the event loop."""

    def __init__(self, real):
        self._real = real
        self.calls: list[tuple[str, bool]] = []

    def hash(self, password):
        self.calls.append(("hash", on_event_loop()))
        return self._real.hash(password)

    def verify(self, password_hash, password):
        self.calls.append(("verify", on_event_loop()))
        return self._real.verify(password_hash, password)


async def test_password_hashing_runs_off_the_event_loop(client, app, monkeypatch):
    spy = _LoopCheckingHasher(passwords._hasher)
    monkeypatch.setattr(passwords, "_hasher", spy)

    assert (await signup(client)).status_code == 201
    token = (
        await client.post(
            "/api/v1/invitations", json={"email": "agent@alphatravels.com", "role": "agent"}
        )
    ).json()["token"]
    async with make_client(app) as anon:
        accepted = await anon.post(
            "/api/v1/invitations/accept",
            json={"token": token, "full_name": "Ravi Agent", "password": DEFAULT_PASSWORD},
        )
        assert accepted.status_code == 201
        ok = await anon.post(
            LOGIN, json={"email": "owner@alphatravels.com", "password": DEFAULT_PASSWORD}
        )
        wrong = await anon.post(
            LOGIN, json={"email": "owner@alphatravels.com", "password": "wrong-password-123"}
        )
        unknown = await anon.post(
            LOGIN, json={"email": "nobody@alphatravels.com", "password": "wrong-password-123"}
        )
    assert (ok.status_code, wrong.status_code, unknown.status_code) == (200, 401, 401)

    # signup + accept hash; ok/wrong/unknown(dummy) logins verify
    assert [name for name, _ in spy.calls] == ["hash", "hash", "verify", "verify", "verify"]
    assert not any(on_loop for _, on_loop in spy.calls), spy.calls


async def _replay_me(app, token: str) -> int:  # type: ignore[no-untyped-def]
    async with make_client(app) as replay:
        r = await replay.get("/api/v1/auth/me", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    return r.status_code


async def test_login_revokes_the_browsers_previous_session(client, app):
    """Signing in replaces the browser's cookie; the session it replaced is revoked (database
    and session cache), not left live for whoever kept the old token."""
    await signup(client)
    async with make_client(app) as other:
        await signup(other, email="second@alphatravels.com", agency_name="Second Co")
    old = client.cookies.get(SESSION_COOKIE)
    assert (await client.get("/api/v1/auth/me")).status_code == 200  # cached now
    r = await client.post(
        LOGIN, json={"email": "second@alphatravels.com", "password": DEFAULT_PASSWORD}
    )
    assert r.status_code == 200
    new = client.cookies.get(SESSION_COOKIE)
    assert new and new != old
    assert await _replay_me(app, old) == 401
    assert await _replay_me(app, new) == 200


async def test_a_failed_login_keeps_the_current_session(client, app):
    await signup(client)
    token = client.cookies.get(SESSION_COOKIE)
    r = await client.post(
        LOGIN, json={"email": "owner@alphatravels.com", "password": "wrong-password-123"}
    )
    assert r.status_code == 401
    assert await _replay_me(app, token) == 200


async def test_login_with_a_stale_cookie_just_signs_in(client):
    client.cookies.set(SESSION_COOKIE, "not-a-session")
    await signup(client)
    r = await client.post(
        LOGIN, json={"email": "owner@alphatravels.com", "password": DEFAULT_PASSWORD}
    )
    assert r.status_code == 200
    assert (await client.get("/api/v1/auth/me")).status_code == 200
