from tests.helpers import make_client
from travelmind.db import get_db
from travelmind.main import create_app


async def test_health_reports_database_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}
    assert len(r.headers["X-Request-ID"]) == 32


async def test_health_reports_degraded_when_database_down(app, client):
    class BrokenSession:
        async def execute(self, *args, **kwargs):
            raise ConnectionRefusedError("database is down")

    async def broken_db():
        yield BrokenSession()

    app.dependency_overrides[get_db] = broken_db
    r = await client.get("/health")
    assert r.status_code == 503
    assert r.json() == {"status": "degraded", "database": "unavailable"}


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


def _app_with_boom_route():
    app = create_app()

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    return app


async def test_unhandled_error_carries_cors_headers_for_allowed_origin():
    app = _app_with_boom_route()

    async with make_client(app, raise_app_exceptions=False) as c:
        r = await c.get("/boom", headers={"Origin": "http://localhost:5173"})

    assert r.status_code == 500
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert r.json() == {
        "detail": "Something went wrong on our side. Please try again.",
        "trace_id": r.headers["X-Request-ID"],
    }
    assert "secret internal detail" not in r.text


async def test_unhandled_error_uses_client_supplied_request_id_as_trace_id():
    app = _app_with_boom_route()

    async with make_client(app, raise_app_exceptions=False) as c:
        r = await c.get(
            "/boom", headers={"Origin": "http://localhost:5173", "X-Request-ID": "abc-123"}
        )

    assert r.status_code == 500
    assert r.json()["trace_id"] == "abc-123"
    assert r.headers["X-Request-ID"] == "abc-123"
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
