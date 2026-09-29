from tests.helpers import signup

LOGIN = "/api/v1/auth/login"
WRONG = {"email": "owner@alphatravels.com", "password": "wrong-password-123"}


async def test_cross_site_post_is_blocked(client):
    r = await client.post(LOGIN, json=WRONG, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert r.json() == {"detail": "Cross-site request blocked."}


async def test_same_site_post_is_allowed(client):
    await signup(client)
    r = await client.post(LOGIN, json=WRONG, headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 401


async def test_cors_preflight_allows_frontend_origin(client):
    r = await client.options(
        LOGIN,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert r.headers["access-control-allow-credentials"] == "true"


async def test_login_is_rate_limited_per_email(client):
    await signup(client)
    for _ in range(10):
        r = await client.post(LOGIN, json=WRONG)
        assert r.status_code == 401
    blocked = await client.post(LOGIN, json=WRONG)
    assert blocked.status_code == 429
    assert "Too many sign-in attempts" in blocked.json()["detail"]
    other = await client.post(
        LOGIN, json={"email": "someone@else.com", "password": "wrong-password-123"}
    )
    assert other.status_code == 401


async def test_validation_errors_are_plain_and_never_echo_input(client):
    r = await signup(client, password="short")
    assert r.status_code == 422
    body = r.json()
    assert body["detail"] == "Some of the information you entered isn't valid."
    assert any(e["field"] == "password" for e in body["errors"])
    assert "short" not in r.text
    assert "X-Request-ID" in r.headers


async def test_missing_login_field_is_reported_by_name(client):
    r = await client.post(LOGIN, json={"email": "owner@alphatravels.com"})
    assert r.status_code == 422
    assert [e["field"] for e in r.json()["errors"]] == ["password"]
