"""Process-wide clients: one Redis pool, one httpx client per name, and DB pool sizing."""

import asyncio
from typing import Any

import httpx
import pytest
from structlog.testing import capture_logs

from travelmind import cache as cache_module
from travelmind import db as db_module
from travelmind.cache import close_redis, get_redis, get_shared_redis
from travelmind.config import Settings, get_settings
from travelmind.http import close_http_clients, get_http_client


async def test_get_redis_reuses_one_pool():
    first = await anext(get_redis())
    second = await anext(get_redis())
    assert first.connection_pool is second.connection_pool
    assert get_shared_redis().connection_pool is first.connection_pool
    assert first.connection_pool.max_connections == 100
    assert await first.ping()


async def test_redis_pool_waits_for_a_free_connection_instead_of_failing(monkeypatch):
    settings = get_settings().model_copy(
        update={"redis_max_connections": 1, "redis_pool_timeout_s": 2.0}
    )
    monkeypatch.setattr(cache_module, "get_settings", lambda: settings)
    await close_redis()
    redis = get_shared_redis()
    assert redis.connection_pool.max_connections == 1
    # The first command holds the only connection for ~0.2 s; the second must wait for it.
    popped, pushed = await asyncio.gather(
        redis.blpop(["pool-wait"], timeout=0.2), redis.rpush("pool-other", "x")
    )
    assert popped is None
    assert pushed == 1


async def test_close_redis_starts_a_fresh_pool():
    before = get_shared_redis().connection_pool
    await close_redis()
    after = get_shared_redis().connection_pool
    assert after is not before
    assert await get_shared_redis().ping()


async def test_http_client_is_shared_per_name():
    timeout = httpx.Timeout(2.0, connect=1.0)
    first = get_http_client("x", timeout=timeout)
    assert get_http_client("x", timeout=timeout) is first
    assert get_http_client("y", timeout=timeout) is not first
    await close_http_clients()
    assert first.is_closed
    fresh = get_http_client("x", timeout=timeout)
    assert fresh is not first
    assert not fresh.is_closed


async def test_http_client_keeps_its_base_url_and_timeout():
    timeout = httpx.Timeout(3.0, connect=1.0)
    client = get_http_client("based", timeout=timeout, base_url="https://api.example.test/v1")
    assert str(client.base_url) == "https://api.example.test/v1/"
    assert client.timeout == timeout


@pytest.fixture
def captured_engine_kwargs(monkeypatch):
    captured: dict[str, Any] = {}

    def fake_create_async_engine(url: str, **kwargs: Any) -> object:
        captured["url"] = url
        captured.update(kwargs)
        return object()

    def use(**overrides: Any) -> dict[str, Any]:
        settings = Settings(_env_file=None, environment="development", **overrides)  # type: ignore[call-arg]
        monkeypatch.setattr(db_module, "get_settings", lambda: settings)
        monkeypatch.setattr(db_module, "create_async_engine", fake_create_async_engine)
        db_module.get_engine.cache_clear()
        db_module.get_engine()
        return captured

    yield use
    db_module.get_engine.cache_clear()


def test_engine_pgbouncer_mode_disables_statement_cache(captured_engine_kwargs):
    kwargs = captured_engine_kwargs(db_pgbouncer=True)
    connect_args = kwargs["connect_args"]
    assert connect_args["statement_cache_size"] == 0
    assert connect_args["prepared_statement_cache_size"] == 0
    names = {connect_args["prepared_statement_name_func"]() for _ in range(3)}
    assert len(names) == 3
    assert all(name.startswith("__asyncpg_") for name in names)
    # PgBouncer rejects unknown startup parameters; the timeout is set per role instead.
    assert "server_settings" not in connect_args
    assert kwargs["pool_size"] == 10
    assert kwargs["max_overflow"] == 5
    assert kwargs["pool_timeout"] == 5.0
    assert kwargs["pool_pre_ping"] is True


def test_engine_direct_mode_sets_statement_timeout(captured_engine_kwargs):
    kwargs = captured_engine_kwargs(db_pool_size=7, db_max_overflow=2, db_pool_timeout_s=1.5)
    assert kwargs["connect_args"] == {"server_settings": {"statement_timeout": "5000"}}
    assert kwargs["pool_size"] == 7
    assert kwargs["max_overflow"] == 2
    assert kwargs["pool_timeout"] == 1.5
    assert kwargs["pool_pre_ping"] is True


def test_scale_settings_defaults():
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.db_pool_size == 10
    assert settings.db_max_overflow == 5
    assert settings.db_pool_timeout_s == 5.0
    assert settings.db_statement_timeout_ms == 5000
    assert settings.db_pgbouncer is False
    assert settings.redis_max_connections == 100
    assert settings.redis_pool_timeout_s == 1.0
    assert settings.run_scheduler is True


async def test_lifespan_closes_shared_clients():
    from travelmind.main import create_app, lifespan

    pool = get_shared_redis().connection_pool
    client = get_http_client("lifespan", timeout=httpx.Timeout(1.0))
    async with lifespan(create_app()):
        pass
    assert client.is_closed
    assert get_shared_redis().connection_pool is not pool


@pytest.mark.parametrize("run_scheduler", [True, False])
async def test_lifespan_starts_the_scheduler_only_when_enabled(monkeypatch, run_scheduler):
    from travelmind import main

    settings = Settings(_env_file=None, environment="development", run_scheduler=run_scheduler)  # type: ignore[call-arg]
    started: list[float] = []

    async def fake_cleanup_loop(interval_seconds: float) -> None:
        started.append(interval_seconds)

    monkeypatch.setattr(main, "get_settings", lambda: settings)
    monkeypatch.setattr(main, "demo_cleanup_loop", fake_cleanup_loop)
    async with main.lifespan(main.create_app()):
        await asyncio.sleep(0)
    assert started == ([3600] if run_scheduler else [])


async def test_shared_http_client_keeps_no_cookies(respx_mock):
    respx_mock.get("https://supplier.example.test/a").respond(
        200, headers={"Set-Cookie": "lb=node-7; Path=/"}
    )
    second = respx_mock.get("https://supplier.example.test/b").respond(200)
    client = get_http_client("cookies", timeout=httpx.Timeout(1.0))
    await client.get("https://supplier.example.test/a")
    await client.get("https://supplier.example.test/b")
    assert "cookie" not in second.calls.last.request.headers
    assert not client.cookies


async def test_close_http_clients_closes_every_client_even_if_one_fails():
    timeout = httpx.Timeout(1.0)
    broken = get_http_client("broken", timeout=timeout)
    healthy = get_http_client("healthy", timeout=timeout)

    async def failing_close() -> None:
        raise RuntimeError("socket already gone")

    broken.aclose = failing_close  # type: ignore[method-assign]
    with capture_logs() as logs:
        await close_http_clients()
    assert healthy.is_closed
    assert get_http_client("broken", timeout=timeout) is not broken
    assert [entry["event"] for entry in logs] == ["http_client_close_failed"]


async def test_http_client_warns_when_an_existing_name_gets_another_base_url():
    timeout = httpx.Timeout(1.0)
    first = get_http_client("named", timeout=timeout, base_url="https://a.example.test")
    with capture_logs() as logs:
        again = get_http_client("named", timeout=timeout, base_url="https://b.example.test")
        get_http_client("named", timeout=timeout, base_url="https://a.example.test")
    assert again is first
    assert [entry["event"] for entry in logs] == ["http_client_base_url_mismatch"]


async def test_lifespan_closes_redis_and_engine_even_if_http_close_fails(monkeypatch):
    from travelmind import main

    disposed: list[bool] = []

    class FakeEngine:
        async def dispose(self) -> None:
            disposed.append(True)

    async def failing_http_close() -> None:
        raise RuntimeError("boom")

    pool = get_shared_redis().connection_pool
    monkeypatch.setattr(main, "close_http_clients", failing_http_close)
    monkeypatch.setattr(main, "get_engine", lambda: FakeEngine())
    with pytest.raises(RuntimeError):
        async with main.lifespan(main.create_app()):
            pass
    assert get_shared_redis().connection_pool is not pool
    assert disposed == [True]
