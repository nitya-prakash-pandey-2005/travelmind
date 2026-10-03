"""Prometheus metrics: route-template labels, guarded `/metrics`, supplier latency, no secrets.

Collectors are created once at import and counts only increase, so tests read values before and
after the action, or look for label sets that only the test itself produces.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import structlog
from prometheus_client import REGISTRY, CollectorRegistry

from tests.helpers import make_client, signup
from travelmind import metrics
from travelmind.config import get_settings
from travelmind.main import create_app
from travelmind.offers.fx import ECB_DAILY_URL, get_fx_rates
from travelmind.offers.suppliers.base import SupplierError

ECB_XML = (Path(__file__).parent / "offers" / "fixtures" / "ecb_daily.xml").read_text(
    encoding="utf-8"
)


def _count(supplier: str, outcome: str) -> float:
    value = REGISTRY.get_sample_value(
        "supplier_request_duration_seconds_count", {"supplier": supplier, "outcome": outcome}
    )
    return value or 0.0


async def _scrape(client: httpx.AsyncClient, **headers: str) -> httpx.Response:
    return await client.get("/metrics", headers=headers)


async def test_request_metrics_use_route_template(client):
    await client.get("/api/v1/public/quotes/abc123secret")
    await client.get("/no/such/path/xyz789secret")

    r = await _scrape(client)

    assert r.status_code == 200
    assert 'route="/api/v1/public/quotes/{token}"' in r.text
    assert 'route="unmatched"' in r.text
    assert "abc123secret" not in r.text
    assert "xyz789secret" not in r.text
    assert "http_request_duration_seconds_bucket" in r.text


async def test_status_label_counts_handled_errors():
    app = create_app()

    @app.get("/metrics-test/boom/{item_id}")
    async def boom(item_id: str) -> None:
        raise RuntimeError("secret internal detail")

    labels = {"method": "GET", "route": "/metrics-test/boom/{item_id}", "status": "500"}
    before = REGISTRY.get_sample_value("http_requests_total", labels) or 0.0
    async with make_client(app, raise_app_exceptions=False) as c:
        assert (await c.get("/metrics-test/boom/42")).status_code == 500

    assert REGISTRY.get_sample_value("http_requests_total", labels) == before + 1


async def test_request_log_is_structured_and_uses_route_template(client):
    with structlog.testing.capture_logs() as logs:
        r = await client.get("/api/v1/public/quotes/abc123secret")

    requests = [e for e in logs if e["event"] == "request"]
    assert len(requests) == 1
    entry = requests[0]
    assert entry["method"] == "GET"
    assert entry["route"] == "/api/v1/public/quotes/{token}"
    assert entry["status"] == r.status_code
    assert entry["request_id"] == r.headers["X-Request-ID"]
    assert isinstance(entry["duration_ms"], float)
    assert "abc123secret" not in repr(logs)


async def test_metrics_served_outside_production_without_token(client):
    r = await _scrape(client)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain; version=0.0.4")


async def test_metrics_hidden_in_production_without_token(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "production")
    assert (await _scrape(client)).status_code == 404


async def test_metrics_token_required(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "metrics_token", "mtok-canary-5e1d")

    assert (await _scrape(client)).status_code == 404
    assert (await _scrape(client, Authorization="Bearer wrong")).status_code == 404
    assert (await _scrape(client, Authorization="mtok-canary-5e1d")).status_code == 404

    r = await _scrape(client, Authorization="Bearer mtok-canary-5e1d")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain; version=0.0.4")
    assert "mtok-canary-5e1d" not in r.text


async def test_metrics_token_also_guards_production(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "production")
    monkeypatch.setattr(get_settings(), "metrics_token", "mtok-canary-5e1d")
    assert (await _scrape(client)).status_code == 404
    r = await _scrape(client, Authorization="Bearer mtok-canary-5e1d")
    assert r.status_code == 200


async def test_supplier_latency_recorded(client, airports):
    before = _count("sandbox", "ok")
    await signup(client)
    day = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
    r = await client.post(
        "/api/v1/flights/search",
        json={"origin": "DEL", "destination": "BOM", "departure_date": day},
    )
    assert r.status_code == 200

    assert _count("sandbox", "ok") >= before + 1
    body = (await _scrape(client)).text
    assert 'supplier_request_duration_seconds_count{outcome="ok",supplier="sandbox"}' in body


async def test_no_secret_values_in_metrics(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "duffel_token", "sk_test_canary")
    monkeypatch.setattr(settings, "liteapi_key", "sand_canary_lite")
    monkeypatch.setattr(settings, "google_tim_api_key", "tim_canary_key")
    monkeypatch.setattr(settings, "travelpayouts_token", "tp_canary_token")
    await client.get("/api/v1/suppliers")

    body = (await _scrape(client)).text

    for canary in ("sk_test_canary", "sand_canary_lite", "tim_canary_key", "tp_canary_token"):
        assert canary not in body


@pytest.mark.parametrize(
    ("raised", "outcome"),
    [
        (None, "ok"),
        (TimeoutError(), "timeout"),
        (httpx.ReadTimeout("slow"), "timeout"),
        (SupplierError("timeout", "Didn't answer in time."), "timeout"),
        (SupplierError("unavailable", "Couldn't reach it."), "error"),
        (httpx.ConnectError("refused"), "error"),
        (ValueError("bad payload"), "error"),
    ],
)
def test_supplier_call_classifies_outcomes(raised, outcome):
    supplier = f"unit_{outcome}"
    before = _count(supplier, outcome)
    try:
        with metrics.supplier_call(supplier):
            if raised is not None:
                raise raised
    except Exception as exc:
        assert exc is raised  # the timer never swallows or replaces the error
    assert _count(supplier, outcome) == before + 1


async def test_cancelled_supplier_call_counts_as_timeout():
    before = _count("unit_cancel", "timeout")

    async def slow() -> None:
        with metrics.supplier_call("unit_cancel"):
            await asyncio.sleep(10)

    with pytest.raises(TimeoutError):
        await asyncio.wait_for(slow(), timeout=0.01)
    assert _count("unit_cancel", "timeout") == before + 1


async def test_fx_feed_is_observed(respx_mock):
    from redis.asyncio import Redis

    from travelmind.cache import get_shared_redis

    redis: Redis = get_shared_redis()
    before_ok, before_error = _count("ecb", "ok"), _count("ecb", "error")
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=ECB_XML))
    assert await get_fx_rates(redis) is not None
    assert _count("ecb", "ok") == before_ok + 1

    await redis.flushdb()
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(503))
    assert await get_fx_rates(redis) is None
    assert _count("ecb", "error") == before_error + 1


async def test_hotel_supplier_timeout_is_observed(client, airports, monkeypatch):
    from travelmind.hotels.liteapi import LiteApiHotelSupplier

    async def hang(self, *args, **kwargs):
        await asyncio.sleep(10)

    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    monkeypatch.setattr(get_settings(), "search_timeout_seconds", 0.05)
    monkeypatch.setattr(LiteApiHotelSupplier, "search", hang)
    before = _count("liteapi", "timeout")
    await signup(client)
    day = datetime.now(UTC).date() + timedelta(days=30)
    r = await client.post(
        "/api/v1/hotels/search",
        json={
            "destination": "BOM",
            "checkin": day.isoformat(),
            "checkout": (day + timedelta(days=2)).isoformat(),
        },
    )
    assert r.status_code == 200
    assert _count("liteapi", "timeout") == before + 1


def test_multiprocess_dir_uses_a_multiprocess_registry(monkeypatch, tmp_path):
    monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", str(tmp_path))
    registry = metrics.exposition_registry()
    assert registry is not REGISTRY
    assert isinstance(registry, CollectorRegistry)


def test_single_process_uses_the_default_registry(monkeypatch):
    monkeypatch.delenv("PROMETHEUS_MULTIPROC_DIR", raising=False)
    monkeypatch.delenv("prometheus_multiproc_dir", raising=False)
    assert metrics.exposition_registry() is REGISTRY


async def test_scrape_samples_pool_and_queue_gauges(client):
    body = (await _scrape(client)).text
    assert "db_pool_checked_out " in body
    assert 'queue_depth{queue="arq:queue"} 0.0' in body


async def test_queue_depth_is_minus_one_when_redis_is_down(monkeypatch):
    from redis.exceptions import ConnectionError as RedisConnectionError

    class DownRedis:
        async def zcard(self, key):
            raise RedisConnectionError("down")

    monkeypatch.setattr(metrics, "get_shared_redis", lambda: DownRedis())
    await metrics.sample_gauges()
    assert REGISTRY.get_sample_value("queue_depth", {"queue": "arq:queue"}) == -1


async def test_tim_and_travelpayouts_are_observed(respx_mock):
    from tests.offers.offer_factory import make_offer
    from travelmind.cache import get_shared_redis
    from travelmind.db import get_sessionmaker
    from travelmind.fareintel.travelpayouts import TP_PRICES_URL, seed_route
    from travelmind.offers.carbon import TIM_BASE_URL, TimClient

    redis = get_shared_redis()
    before_tim = _count("google_tim", "error")
    before_tp = _count("travelpayouts", "timeout")
    respx_mock.post(url__startswith=TIM_BASE_URL).mock(return_value=httpx.Response(500))
    respx_mock.get(url__startswith=TP_PRICES_URL).mock(side_effect=httpx.ConnectTimeout("slow"))

    offer = make_offer([("DEL", "BOM", "6E", "2045", "2026-11-20T06:10")])
    await TimClient("tim-key", redis).enrich([offer], "economy")
    async with get_sessionmaker()() as db:
        added = await seed_route(
            db,
            redis,
            token="tp-token",
            origin="DEL",
            destination="BOM",
            departure_date=datetime.now(UTC).date() + timedelta(days=40),
            currency="INR",
            market="in",
        )
    assert added == 0

    assert _count("google_tim", "error") >= before_tim + 1
    assert _count("travelpayouts", "timeout") == before_tp + 1


async def test_flight_supplier_error_is_observed(client, airports, monkeypatch):
    from travelmind.offers import service as offers_service
    from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier

    class Failing:
        code = "duffel"

        async def search(self, request):
            raise SupplierError("unavailable", "Couldn't reach Duffel.")

    monkeypatch.setattr(
        offers_service,
        "flight_suppliers",
        lambda settings, lookup: [SandboxFlightSupplier(lookup), Failing()],
    )
    before = _count("duffel", "error")
    await signup(client)
    day = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
    r = await client.post(
        "/api/v1/flights/search",
        json={"origin": "DEL", "destination": "BOM", "departure_date": day},
    )
    assert r.status_code == 200
    assert _count("duffel", "error") == before + 1
