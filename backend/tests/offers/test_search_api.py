import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from tests.helpers import exec_as_tenant, make_client, signup
from tests.offers.offer_factory import make_offer
from travelmind.config import get_settings
from travelmind.offers import router as offers_router
from travelmind.offers.fx import ECB_DAILY_URL
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError
from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier

SEARCH = "/api/v1/flights/search"
ECB_XML = (Path(__file__).parent / "fixtures" / "ecb_daily.xml").read_text(encoding="utf-8")


def trip(**changes) -> dict:
    day = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
    return {"origin": "DEL", "destination": "BOM", "departure_date": day} | changes


class StubSupplier:
    def __init__(
        self,
        code: str,
        offers=None,
        *,
        error: SupplierError | None = None,
        delay: float = 0,
        price=None,
    ):
        self.code = code
        self._offers = offers or []
        self._error = error
        self._delay = delay
        self._price = price

    async def search(self, request):
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._error:
            raise self._error
        return self._offers

    async def price(self, supplier_ref):
        if isinstance(self._price, SupplierError):
            raise self._price
        return self._price


def use_suppliers(monkeypatch, *extra):
    def factory(settings, lookup):
        return [SandboxFlightSupplier(lookup), *extra]

    monkeypatch.setattr(offers_router, "flight_suppliers", factory)


async def test_search_requires_sign_in(client, airports):
    assert (await client.post(SEARCH, json=trip())).status_code == 401


async def test_sandbox_search_returns_labelled_sorted_offers(client, airports):
    await signup(client)
    r = await client.post(SEARCH, json=trip())
    assert r.status_code == 200
    body = r.json()
    assert body["display_currency"] == "INR"
    assert body["sources"] == [
        {
            "supplier": "sandbox",
            "status": "ok",
            "offer_count": len(body["offers"]),
            "latency_ms": body["sources"][0]["latency_ms"],
            "message": None,
        }
    ]
    prices = [o["display_total"]["amount_minor"] for o in body["offers"]]
    assert prices == sorted(prices)
    first = body["offers"][0]
    assert first["provenance"] == "SANDBOX"
    assert first["display_total"] == first["total"]
    assert first["stops"] == 0 and first["total_duration_minutes"] > 0
    assert body["baseline"] is None and first["insight"] is None


async def test_repeat_searches_build_a_baseline(client, airports):
    await signup(client)
    for _ in range(2):
        await client.post(SEARCH, json=trip())
    body = (await client.post(SEARCH, json=trip())).json()
    assert body["baseline"]["family"] == "sandbox"
    assert body["baseline"]["sample_size"] >= 8
    assert body["offers"][0]["insight"]["signal"] in {"good", "typical", "high"}


async def test_round_trips_are_not_compared_with_one_way_history(client, airports):
    await signup(client)
    for _ in range(3):
        await client.post(SEARCH, json=trip())
    back = (datetime.now(UTC).date() + timedelta(days=35)).isoformat()
    body = (await client.post(SEARCH, json=trip(return_date=back))).json()
    assert body["baseline"] is None


async def test_searches_are_logged_for_the_agency_only(client, app, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    await client.post(SEARCH, json=trip())
    async with make_client(app) as other:
        other_agency = (
            await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        ).json()["agency"]["id"]
    assert await exec_as_tenant(agency, "SELECT origin, destination FROM flight_searches") == [
        ("DEL", "BOM")
    ]
    assert await exec_as_tenant(other_agency, "SELECT count(*) FROM flight_searches") == [(0,)]


async def test_unknown_airports_and_impossible_trips(client, airports):
    await signup(client)
    unknown = await client.post(SEARCH, json=trip(origin="XXX"))
    assert unknown.status_code == 422 and unknown.json()["detail"] == "Unknown airport code XXX."
    same = await client.post(SEARCH, json=trip(destination="DEL"))
    assert same.status_code == 422
    assert "must be different airports" in same.json()["errors"][0]["message"]


async def test_searches_are_rate_limited_per_agency(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_max_per_minute", 2)
    await signup(client)
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    blocked = await client.post(SEARCH, json=trip())
    assert blocked.status_code == 429
    assert "Too many searches" in blocked.json()["detail"]


async def test_a_failing_supplier_doesnt_sink_the_search(client, airports, monkeypatch):
    use_suppliers(
        monkeypatch,
        StubSupplier("broken", error=SupplierError("unavailable", "Broken Air is down.")),
    )
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    statuses = {s["supplier"]: s for s in body["sources"]}
    assert statuses["sandbox"]["status"] == "ok"
    assert statuses["broken"] == {
        **statuses["broken"],
        "status": "error",
        "offer_count": 0,
        "message": "Broken Air is down.",
    }
    assert body["offers"]


async def test_a_slow_supplier_times_out_alone(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_timeout_seconds", 0.3)
    use_suppliers(monkeypatch, StubSupplier("slow", delay=5))
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    slow = next(s for s in body["sources"] if s["supplier"] == "slow")
    assert slow["status"] == "timeout" and "0.3" in slow["message"]
    assert body["offers"]


async def test_no_suppliers_is_a_plain_503(client, airports, monkeypatch):
    monkeypatch.setattr(offers_router, "flight_suppliers", lambda settings, lookup: [])
    await signup(client)
    r = await client.post(SEARCH, json=trip())
    assert r.status_code == 503
    assert "No flight suppliers are connected" in r.json()["detail"]


async def test_mixed_currencies_sort_by_display_price(client, airports, monkeypatch, respx_mock):
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=ECB_XML))
    monkeypatch.setattr(get_settings(), "fx_enabled", True)
    cheap_usd = make_offer(
        [("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")],
        offer_ref="usd",
        total_minor=1000,
        currency="USD",
    )
    monkeypatch.setattr(
        offers_router,
        "flight_suppliers",
        lambda settings, lookup: [SandboxFlightSupplier(lookup), StubSupplier("stub", [cheap_usd])],
    )
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    first = body["offers"][0]
    assert first["id"] == "stub~usd"
    assert first["total"] == {"amount_minor": 1000, "currency": "USD"}
    # 10.00 USD → €9.2166 → ₹833.18
    assert first["display_total"] == {"amount_minor": 83318, "currency": "INR"}
    assert body["fx_as_of"] == "2026-09-28"


async def test_without_rates_foreign_prices_are_not_converted(client, airports, monkeypatch):
    usd = make_offer(
        [("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")],
        offer_ref="usd",
        total_minor=1000,
        currency="USD",
    )
    use_suppliers(monkeypatch, StubSupplier("stub", [usd]))
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    foreign = next(o for o in body["offers"] if o["id"] == "stub~usd")
    assert foreign["display_total"] is None
    assert body["offers"][-1]["id"] == "stub~usd"  # unconverted prices sort after comparable ones


async def test_reprice_confirms_an_unchanged_price(client, airports):
    await signup(client)
    offer = (await client.post(SEARCH, json=trip())).json()["offers"][0]
    r = await client.post(f"/api/v1/flights/offers/{offer['id']}/price")
    assert r.status_code == 200
    assert r.json()["price_changed"] is False
    assert r.json()["offer"]["total"] == offer["total"]


async def test_reprice_reports_a_changed_price(client, airports, monkeypatch):
    original = make_offer(
        [("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="moving", total_minor=500000
    )
    moved = original.model_copy(update={"total": Money(amount_minor=530000, currency="INR")})
    use_suppliers(monkeypatch, StubSupplier("stub", [original], price=moved))
    await signup(client)
    await client.post(SEARCH, json=trip())
    body = (await client.post("/api/v1/flights/offers/stub~moving/price")).json()
    assert body["price_changed"] is True
    assert body["previous_total"] == {"amount_minor": 500000, "currency": "INR"}
    assert body["offer"]["total"] == {"amount_minor": 530000, "currency": "INR"}


async def test_reprice_of_an_expired_offer(client, airports, monkeypatch):
    offer = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="old")
    expired = SupplierError(
        "offer_expired", "This offer has expired. Search again for a fresh price."
    )
    use_suppliers(monkeypatch, StubSupplier("stub", [offer], price=expired))
    await signup(client)
    await client.post(SEARCH, json=trip())
    r = await client.post("/api/v1/flights/offers/stub~old/price")
    assert r.status_code == 410
    assert r.json()["detail"] == "This offer has expired. Search again for a fresh price."


async def test_offers_are_cached_per_agency(client, app, airports):
    await signup(client)
    offer_id = (await client.post(SEARCH, json=trip())).json()["offers"][0]["id"]
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        r = await other.post(f"/api/v1/flights/offers/{offer_id}/price")
    assert r.status_code == 404
    assert r.json()["detail"] == "This offer is no longer available. Run the search again."


async def test_supplier_status_never_exposes_secrets(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "duffel_token", "duffel_test_supersecret")
    await signup(client)
    r = await client.get("/api/v1/suppliers")
    assert r.status_code == 200
    statuses = {s["code"]: s for s in r.json()}
    assert statuses["duffel"]["connected"] is True and statuses["duffel"]["mode"] == "test"
    assert statuses["sandbox"]["connected"] is True
    assert statuses["liteapi"]["connected"] is False
    assert "supersecret" not in r.text


@pytest.mark.parametrize("path", ["/api/v1/suppliers"])
async def test_supplier_status_requires_sign_in(client, path):
    assert (await client.get(path)).status_code == 401


async def test_live_offers_are_never_compared_with_sandbox_history(client, airports, monkeypatch):
    agency = (await signup(client)).json()["agency"]["id"]
    for _ in range(3):
        await client.post(SEARCH, json=trip())  # plenty of SANDBOX history for DEL→BOM
    live = make_offer(
        [("DEL", "BOM", "AI", "101", "2026-11-20T06:00")], offer_ref="live", provenance="LIVE"
    )
    use_suppliers(monkeypatch, StubSupplier("stub", [live]))
    body = (await client.post(SEARCH, json=trip())).json()
    assert body["baseline"] is None  # the market family has no history yet
    assert all(o["insight"] is None for o in body["offers"])
    rows = await exec_as_tenant(
        agency,
        "SELECT provenance, count(*) FROM fare_snapshots GROUP BY provenance ORDER BY provenance",
    )
    assert dict(rows)["LIVE"] == 1


class RecordingTim:
    created: list[dict] = []

    def __init__(self, api_key, redis, **kwargs):
        RecordingTim.created.append(kwargs)

    async def enrich(self, offers, cabin):
        return [o.model_copy(update={"co2_kg_per_passenger": 77}) for o in offers]


async def test_emissions_enrichment_is_capped_at_four_seconds(client, airports, monkeypatch):
    RecordingTim.created = []
    monkeypatch.setattr(get_settings(), "google_tim_api_key", "tim-key")
    monkeypatch.setattr(offers_router, "TimClient", RecordingTim)
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    assert RecordingTim.created == [{"timeout_s": 4.0}]
    assert {o["co2_kg_per_passenger"] for o in body["offers"]} == {77}
    assert "tim-key" not in str(body)
