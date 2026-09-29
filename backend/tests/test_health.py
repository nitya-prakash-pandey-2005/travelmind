from tests.helpers import make_client
from travelmind.main import create_app


async def test_health_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert len(r.headers["X-Request-ID"]) == 32


async def test_request_id_is_echoed(client):
    r = await client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"


async def test_unsafe_request_id_is_replaced(client):
    r = await client.get("/health", headers={"X-Request-ID": "<script>alert(1)</script>"})
    assert r.headers["X-Request-ID"] != "<script>alert(1)</script>"
    assert len(r.headers["X-Request-ID"]) == 32


async def test_unhandled_error_returns_plain_message_with_trace_id():
    app = create_app()

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    async with make_client(app, raise_app_exceptions=False) as c:
        r = await c.get("/boom")

    assert r.status_code == 500
    assert r.json()["detail"] == "Something went wrong on our side. Please try again."
    assert r.json()["trace_id"] == r.headers["X-Request-ID"]
    assert "secret internal detail" not in r.text
