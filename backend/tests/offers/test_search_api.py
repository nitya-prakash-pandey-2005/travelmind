import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from tests.helpers import exec_as_tenant, make_client, run_as_owner, signup
from tests.offers.offer_factory import make_offer
from travelmind.config import Settings, get_settings
from travelmind.db import get_sessionmaker
from travelmind.fareintel.models import FareSnapshot
from travelmind.offers import service as offers_service
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
        price_delay: float = 0,
    ):
        self.code = code
        self._offers = offers or []
        self._error = error
        self._delay = delay
        self._price = price
        self._price_delay = price_delay

    async def search(self, request):
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._error:
            raise self._error
        return self._offers

    async def price(self, supplier_ref):
        if self._price_delay:
            await asyncio.sleep(self._price_delay)
        if isinstance(self._price, SupplierError):
            raise self._price
        return self._price


def use_suppliers(monkeypatch, *extra):
    def factory(settings, lookup):
        return [SandboxFlightSupplier(lookup), *extra]

    monkeypatch.setattr(offers_service, "flight_suppliers", factory)


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
    assert first["per_traveller"] == first["total"]  # one adult, billed in INR
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
    monkeypatch.setattr(offers_service, "flight_suppliers", lambda settings, lookup: [])
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
        offers_service,
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


async def test_price_checks_are_rate_limited_per_agency(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "reprice_max_per_minute", 2)
    await signup(client)
    offer = (await client.post(SEARCH, json=trip())).json()["offers"][0]
    price = f"/api/v1/flights/offers/{offer['id']}/price"
    assert (await client.post(price)).status_code == 200
    assert (await client.post(price)).status_code == 200
    blocked = await client.post(price)
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == (
        "Too many price checks in a minute. Please wait a moment and try again."
    )


async def test_price_checks_and_searches_have_separate_budgets(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_max_per_minute", 2)
    monkeypatch.setattr(get_settings(), "reprice_max_per_minute", 1)
    await signup(client)
    offer = (await client.post(SEARCH, json=trip())).json()["offers"][0]
    price = f"/api/v1/flights/offers/{offer['id']}/price"
    assert (await client.post(price)).status_code == 200
    assert (await client.post(price)).status_code == 429
    # Price checks spent none of the search budget, and a spent price budget blocks no search.
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    assert (await client.post(SEARCH, json=trip())).status_code == 429


def test_price_checks_default_to_sixty_a_minute():
    assert Settings(_env_file=None).reprice_max_per_minute == 60


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
    monkeypatch.setattr(offers_service, "TimClient", RecordingTim)
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    assert RecordingTim.created == [{"timeout_s": 4.0}]
    assert {o["co2_kg_per_passenger"] for o in body["offers"]} == {77}
    assert "tim-key" not in str(body)


def live_offer(ref: str = "live", total_minor: int = 500000):
    return make_offer(
        [("DEL", "BOM", "AI", "101", "2026-11-20T06:00")],
        offer_ref=ref,
        total_minor=total_minor,
        provenance="LIVE",
    )


async def test_identical_market_fares_are_recorded_once(client, airports, monkeypatch):
    agency = (await signup(client)).json()["agency"]["id"]
    use_suppliers(monkeypatch, StubSupplier("stub", [live_offer("a"), live_offer("b", 610000)]))
    sandbox_per_search = 0
    for _ in range(2):
        r = await client.post(SEARCH, json=trip())
        assert r.status_code == 200
        sandbox_per_search = next(
            s["offer_count"] for s in r.json()["sources"] if s["supplier"] == "sandbox"
        )
    counts = dict(
        await exec_as_tenant(
            agency, "SELECT provenance, count(*) FROM fare_snapshots GROUP BY provenance"
        )
    )
    assert counts["LIVE"] == 2  # two distinct fares, each recorded once across both searches
    # Next to live fares, sandbox fares aren't comparable, so they aren't recorded at all.
    assert sandbox_per_search > 0 and "SANDBOX" not in counts


class BrokenPipeline:
    async def __aenter__(self):
        raise RedisConnectionError("Redis is down")

    async def __aexit__(self, *exc):
        return False


class BrokenRedis:
    def pipeline(self, transaction=True):
        return BrokenPipeline()


async def test_without_redis_market_fares_are_skipped_not_duplicated():
    today = datetime.now(UTC).date()

    def row(provenance):
        return FareSnapshot(
            origin="DEL",
            destination="BOM",
            departure_date=today + timedelta(days=30),
            days_to_departure=30,
            cabin="economy",
            carrier="AI",
            stops=0,
            total_minor=500000,
            currency="INR",
            provenance=provenance,
            source="stub",
        )

    kept = await offers_service.new_observations(BrokenRedis(), [row("LIVE"), row("SANDBOX")])
    assert [r.provenance for r in kept] == ["SANDBOX"]


async def test_an_unexpected_supplier_crash_is_contained(client, airports, monkeypatch):
    use_suppliers(monkeypatch, StubSupplier("crashy", error=RuntimeError("boom")))
    await signup(client)
    r = await client.post(SEARCH, json=trip())
    assert r.status_code == 200
    crashy = next(s for s in r.json()["sources"] if s["supplier"] == "crashy")
    assert crashy["status"] == "error"
    assert crashy["message"] == "This supplier failed unexpectedly."
    assert "boom" not in r.text


async def test_reprice_supplier_failure_is_a_502(client, airports, monkeypatch):
    offer = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="flaky")
    down = SupplierError("unavailable", "Stub Air is having a problem.")
    use_suppliers(monkeypatch, StubSupplier("stub", [offer], price=down))
    await signup(client)
    await client.post(SEARCH, json=trip())
    r = await client.post("/api/v1/flights/offers/stub~flaky/price")
    assert r.status_code == 502
    assert r.json()["detail"] == "Stub Air is having a problem."


async def test_reprice_gives_up_after_the_deadline(client, airports, monkeypatch):
    monkeypatch.setattr(offers_service, "REPRICE_TIMEOUT_SECONDS", 0.2)
    offer = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="slow")
    use_suppliers(monkeypatch, StubSupplier("stub", [offer], price=offer, price_delay=5))
    await signup(client)
    await client.post(SEARCH, json=trip())
    r = await client.post("/api/v1/flights/offers/stub~slow/price")
    assert r.status_code == 502
    assert r.json()["detail"] == "Couldn't confirm the price in time. Try again."


async def test_reprice_when_the_supplier_was_disconnected(client, airports, monkeypatch):
    offer = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="orphan")
    use_suppliers(monkeypatch, StubSupplier("stub", [offer], price=offer))
    await signup(client)
    await client.post(SEARCH, json=trip())
    use_suppliers(monkeypatch)  # the stub supplier is no longer connected
    r = await client.post("/api/v1/flights/offers/stub~orphan/price")
    assert r.status_code == 409
    assert r.json()["detail"] == "The supplier for this offer is no longer connected."


async def seed_market_history(totals: list[int]) -> None:
    """Per-traveller LIVE DEL→BOM economy fares for the booking window `trip()` searches."""
    day = datetime.now(UTC).date() + timedelta(days=30)
    async with get_sessionmaker()() as db:
        db.add_all(
            FareSnapshot(
                origin="DEL",
                destination="BOM",
                departure_date=day,
                days_to_departure=30,
                cabin="economy",
                carrier="AI",
                stops=0,
                total_minor=total,
                currency="INR",
                provenance="LIVE",
                source="history",
            )
            for total in totals
        )
        await db.commit()


class PerPartySupplier:
    """A LIVE supplier quoting the party's total: `per_person` for each passenger, plus `extra`."""

    code = "stub"

    def __init__(self, per_person: int, *, extra: int = 0, currency: str = "INR") -> None:
        self._per_person = per_person
        self._extra = extra
        self._currency = currency

    async def search(self, request):
        count = request.passenger_count
        return [
            make_offer(
                [("DEL", "BOM", "AI", "101", "2026-11-20T06:00")],
                offer_ref=f"party{count}",
                total_minor=self._per_person * count + self._extra,
                currency=self._currency,
                provenance="LIVE",
                passenger_count=count,
            )
        ]


def only_suppliers(monkeypatch, *suppliers):
    monkeypatch.setattr(offers_service, "flight_suppliers", lambda settings, lookup: [*suppliers])


async def stub_rows(agency) -> list[tuple]:
    return await exec_as_tenant(
        agency,
        "SELECT total_minor, currency, provenance FROM fare_snapshots WHERE source = 'stub'",
    )


HISTORY = list(range(400000, 600000, 20000))  # 10 per-traveller fares, median ₹4,900


async def test_two_adults_are_judged_per_traveller_like_one(client, airports, monkeypatch):
    await seed_market_history(HISTORY)
    agency = (await signup(client)).json()["agency"]["id"]
    # Two adults pay ₹6,000.01 in all: ₹3,000.005 each, which rounds half-up to ₹3,000.01.
    only_suppliers(monkeypatch, PerPartySupplier(300001, extra=-1))
    pair = (await client.post(SEARCH, json=trip(adults=2))).json()["offers"][0]
    assert pair["total"] == {"amount_minor": 600001, "currency": "INR"}
    assert pair["per_traveller"] == {"amount_minor": 300001, "currency": "INR"}
    assert await stub_rows(agency) == [(300001, "INR", "LIVE")]  # never the party's total

    # The same fare for one adult, against the same history, reads exactly the same.
    await run_as_owner("DELETE FROM fare_snapshots WHERE source = 'stub'")
    only_suppliers(monkeypatch, PerPartySupplier(300001))
    solo = (await client.post(SEARCH, json=trip())).json()["offers"][0]
    assert solo["per_traveller"] == {"amount_minor": 300001, "currency": "INR"}
    assert pair["insight"]["signal"] == "good"
    assert pair["insight"] == solo["insight"]
    assert "per-traveller fares" in pair["insight"]["message"]


async def test_parties_with_children_record_nothing_and_get_no_insight(
    client, airports, monkeypatch
):
    await seed_market_history(HISTORY)
    agency = (await signup(client)).json()["agency"]["id"]
    only_suppliers(monkeypatch, PerPartySupplier(300000))
    body = (await client.post(SEARCH, json=trip(adults=2, children_ages=[8]))).json()
    assert body["offers"]
    assert all(o["insight"] is None and o["per_traveller"] is None for o in body["offers"])
    assert await stub_rows(agency) == []


async def test_sandbox_searches_with_children_record_nothing(client, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    body = (await client.post(SEARCH, json=trip(children_ages=[4]))).json()
    assert body["offers"]
    assert all(o["insight"] is None and o["per_traveller"] is None for o in body["offers"])
    assert await exec_as_tenant(agency, "SELECT count(*) FROM fare_snapshots") == [(0,)]


async def test_converted_offers_get_no_insight_and_no_snapshot(
    client, airports, monkeypatch, respx_mock
):
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=ECB_XML))
    monkeypatch.setattr(get_settings(), "fx_enabled", True)
    await seed_market_history(HISTORY)
    agency = (await signup(client)).json()["agency"]["id"]
    usd = make_offer(
        [("DEL", "BOM", "UA", "1", "2026-11-20T06:00")],
        offer_ref="usd",
        total_minor=3000,
        currency="USD",
        provenance="LIVE",
    )
    only_suppliers(monkeypatch, StubSupplier("stub", [usd, live_offer("inr", 300000)]))
    body = (await client.post(SEARCH, json=trip())).json()
    offers = {o["id"]: o for o in body["offers"]}
    converted, native = offers["stub~usd"], offers["stub~inr"]
    assert converted["display_total"]["currency"] == "INR"  # shown as ≈ ₹, but billed in USD
    assert converted["insight"] is None and converted["per_traveller"] is None
    assert native["insight"] is not None
    assert native["per_traveller"] == {"amount_minor": 300000, "currency": "INR"}
    assert await stub_rows(agency) == [(300000, "INR", "LIVE")]


class WaitsForRates:
    """A supplier that only answers once the exchange-rate fetch has started."""

    code = "stub"

    def __init__(self, started: asyncio.Event) -> None:
        self._started = started

    async def search(self, request):
        await self._started.wait()
        return [live_offer()]


async def test_exchange_rates_are_fetched_while_suppliers_search(client, airports, monkeypatch):
    started = asyncio.Event()

    async def rates(redis, *, enabled=True):
        started.set()
        return None

    monkeypatch.setattr(offers_service, "get_fx_rates", rates)
    monkeypatch.setattr(get_settings(), "search_timeout_seconds", 1.0)
    only_suppliers(monkeypatch, WaitsForRates(started))
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    # Fetched one after the other, the supplier would wait out its whole budget instead.
    assert body["sources"][0]["status"] == "ok"
    assert [o["id"] for o in body["offers"]] == ["stub~live"]
