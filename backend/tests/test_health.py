import asyncio

import structlog
from redis.exceptions import RedisError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from tests.helpers import make_client
from travelmind import health as health_module
from travelmind.cache import get_redis
from travelmind.db import get_db
from travelmind.main import create_app
from travelmind.middleware import RequestIdMiddleware


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


async def test_health_shape_unchanged(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.content == b'{"status":"ok","database":"ok"}'
    assert r.headers["content-type"] == "application/json"


async def test_ready_ok(client):
    r = await client.get("/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready", "database": "ok", "redis": "ok"}
    assert len(r.headers["X-Request-ID"]) == 32


async def test_ready_redis_down(app, client):
    class BrokenRedis:
        async def ping(self):
            raise RedisError("redis is down")

    async def broken_redis():
        yield BrokenRedis()

    app.dependency_overrides[get_redis] = broken_redis
    r = await client.get("/ready")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable", "database": "ok", "redis": "unavailable"}


async def test_ready_database_down(app, client):
    class BrokenSession:
        async def execute(self, *args, **kwargs):
            raise ConnectionRefusedError("database is down")

    async def broken_db():
        yield BrokenSession()

    app.dependency_overrides[get_db] = broken_db
    r = await client.get("/ready")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable", "database": "unavailable", "redis": "ok"}


async def test_ready_times_out_a_hanging_check(app, client, monkeypatch):
    monkeypatch.setattr(health_module, "READY_TIMEOUT_SECONDS", 0.1)

    class HangingRedis:
        async def ping(self):
            await asyncio.sleep(10)

    async def hanging_redis():
        yield HangingRedis()

    class FastSession:  # a real connection could take longer than this test's tiny limit
        async def execute(self, *args, **kwargs):
            return None

    async def fast_db():
        yield FastSession()

    app.dependency_overrides[get_redis] = hanging_redis
    app.dependency_overrides[get_db] = fast_db
    r = await client.get("/ready")
    assert r.status_code == 503
    assert r.json() == {"status": "unavailable", "database": "ok", "redis": "unavailable"}


def test_request_id_middleware_is_pure_asgi():
    assert not issubclass(RequestIdMiddleware, BaseHTTPMiddleware)


async def test_request_id_is_bound_for_logs_and_request_state():
    app = create_app()

    @app.get("/whoami")
    async def whoami(request: Request) -> dict[str, str]:
        return {
            "state": request.state.request_id,
            "log": structlog.contextvars.get_contextvars()["request_id"],
        }

    async with make_client(app) as c:
        r = await c.get("/whoami", headers={"X-Request-ID": "req-42"})

    assert r.json() == {"state": "req-42", "log": "req-42"}
    assert r.headers["X-Request-ID"] == "req-42"
    assert "request_id" not in structlog.contextvars.get_contextvars()


def test_origin_check_middleware_is_pure_asgi():
    from travelmind.middleware import OriginCheckMiddleware

    assert not issubclass(OriginCheckMiddleware, BaseHTTPMiddleware)


async def test_db_pool_exhaustion_is_a_busy_503_with_retry_after():
    from sqlalchemy.exc import TimeoutError as PoolTimeoutError

    app = create_app()

    @app.get("/busy")
    async def busy() -> None:
        raise PoolTimeoutError("QueuePool limit of size 10 overflow 5 reached")

    async with make_client(app, raise_app_exceptions=False) as c:
        r = await c.get(
            "/busy", headers={"Origin": "http://localhost:5173", "X-Request-ID": "req-busy"}
        )

    assert r.status_code == 503
    assert r.json() == {
        "detail": "The service is busy. Please try again in a moment.",
        "trace_id": "req-busy",
    }
    assert r.headers["Retry-After"] == "2"
    assert r.headers["X-Request-ID"] == "req-busy"
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "QueuePool" not in r.text
