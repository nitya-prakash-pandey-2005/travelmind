from datetime import UTC, datetime, timedelta

import httpx

from tests.helpers import exec_as_tenant, signup
from tests.hotels.test_hotels_api import FIXTURE, RATES, stay
from tests.offers.offer_factory import make_offer
from tests.offers.test_search_api import StubSupplier, trip, use_suppliers
from travelmind.config import get_settings
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError

DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


async def test_flight_search_logs_sources_and_activity(client, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    body = (
        await client.post(
            "/api/v1/flights/search",
            json={"origin": "DEL", "destination": "BOM", "departure_date": DAY, "adults": 2},
        )
    ).json()
    rows = await exec_as_tenant(
        agency, "SELECT search_kind, supplier, status, offer_count FROM search_source_results"
    )
    assert rows == [("flights", "sandbox", "ok", len(body["offers"]))]
    events = await exec_as_tenant(
        agency, "SELECT kind, summary FROM activity_events WHERE kind = 'search.flights'"
    )
    assert events == [
        ("search.flights", f"Searched DEL → BOM for 2 travellers · {len(body['offers'])} offers")
    ]


async def test_backdated_demo_search(client, airports):
    import os

    from redis.asyncio import Redis

    from travelmind.config import get_settings
    from travelmind.db import bind_tenant, get_sessionmaker
    from travelmind.offers.models import FlightSearchRequest
    from travelmind.offers.service import search_flights
    from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier
    from travelmind.reference.service import get_airport_index

    me = (await signup(client)).json()
    agency = me["agency"]["id"]
    when = datetime.now(UTC) - timedelta(days=12)
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency)
            index = await get_airport_index(db)
            for _ in range(40):  # far above the per-minute budget: enforce_budget=False
                await search_flights(
                    db,
                    redis,
                    get_settings(),
                    FlightSearchRequest(origin="DEL", destination="BOM", departure_date=DAY),
                    agency_id=agency,
                    user_id=None,
                    suppliers=[SandboxFlightSupplier(index.get)],
                    enforce_budget=False,
                    occurred_at=when,
                )
    finally:
        await redis.aclose()
    rows = await exec_as_tenant(agency, "SELECT count(*), min(created_at) FROM flight_searches")
    assert rows[0][0] == 40 and abs((rows[0][1] - when).total_seconds()) < 1


async def test_backdating_stamps_sources_and_activity_but_not_fare_history(client, airports):
    import os

    from redis.asyncio import Redis

    from travelmind.db import bind_tenant, get_sessionmaker
    from travelmind.offers.models import FlightSearchRequest
    from travelmind.offers.service import search_flights
    from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier
    from travelmind.reference.service import get_airport_index

    agency = (await signup(client)).json()["agency"]["id"]
    when = datetime.now(UTC) - timedelta(days=12)
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency)
            index = await get_airport_index(db)
            response = await search_flights(
                db,
                redis,
                get_settings(),
                FlightSearchRequest(origin="DEL", destination="BOM", departure_date=DAY),
                agency_id=agency,
                user_id=None,
                suppliers=[SandboxFlightSupplier(index.get)],
                enforce_budget=False,
                occurred_at=when,
            )
    finally:
        await redis.aclose()
    sources = await exec_as_tenant(
        agency, "SELECT search_id, occurred_at FROM search_source_results"
    )
    assert sources == [(response.search_id, when)]
    events = await exec_as_tenant(
        agency,
        "SELECT occurred_at, actor_user_id FROM activity_events WHERE kind = 'search.flights'",
    )
    assert events == [(when, None)]
    fresh = await exec_as_tenant(agency, "SELECT min(observed_at) FROM fare_snapshots")
    assert abs((fresh[0][0] - datetime.now(UTC)).total_seconds()) < 60


async def test_every_source_is_recorded_against_the_search(client, airports, monkeypatch):
    down = SupplierError("unavailable", "Stub Air is having a problem.")
    use_suppliers(monkeypatch, StubSupplier("stub", error=down))
    me = (await signup(client)).json()
    agency = me["agency"]["id"]
    body = (await client.post("/api/v1/flights/search", json=trip())).json()
    rows = await exec_as_tenant(
        agency,
        "SELECT search_kind, search_id, supplier, status, offer_count, latency_ms >= 0"
        " FROM search_source_results ORDER BY supplier",
    )
    search_id = body["search_id"]
    assert [(k, str(s), sup, st, n, ok) for k, s, sup, st, n, ok in rows] == [
        ("flights", search_id, "sandbox", "ok", len(body["offers"]), True),
        ("flights", search_id, "stub", "error", 0, True),
    ]
    events = await exec_as_tenant(
        agency,
        "SELECT summary, data, actor_user_id FROM activity_events WHERE kind = 'search.flights'",
    )
    count = len(body["offers"])
    assert events == [
        (
            f"Searched DEL → BOM for 1 traveller · {count} offers",
            {"origin": "DEL", "destination": "BOM", "offers": count},
            events[0][2],
        )
    ]
    assert str(events[0][2]) == me["user"]["id"]


async def test_a_failed_search_records_nothing(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_max_per_minute", 1)
    agency = (await signup(client)).json()["agency"]["id"]
    assert (await client.post("/api/v1/flights/search", json=trip())).status_code == 200
    assert (await client.post("/api/v1/flights/search", json=trip())).status_code == 429
    unknown = await client.post("/api/v1/flights/search", json=trip(origin="ZZZ"))
    assert unknown.status_code in (422, 429)
    assert await exec_as_tenant(agency, "SELECT count(*) FROM search_source_results") == [(1,)]
    assert await exec_as_tenant(
        agency, "SELECT count(*) FROM activity_events WHERE kind = 'search.flights'"
    ) == [(1,)]


async def test_hotel_search_records_sources_and_activity(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    me = (await signup(client)).json()
    agency = me["agency"]["id"]
    body = (await client.post("/api/v1/hotels/search", json=stay())).json()
    count = len(body["offers"])
    rows = await exec_as_tenant(
        agency,
        "SELECT search_kind, search_id, supplier, status, offer_count FROM search_source_results",
    )
    assert rows == [("hotels", None, "liteapi", "ok", count)]
    events = await exec_as_tenant(
        agency,
        "SELECT summary, data, actor_user_id FROM activity_events WHERE kind = 'search.hotels'",
    )
    assert [(s, d) for s, d, _ in events] == [
        (f"Searched hotels near BOM · {count} offers", {"destination": "BOM", "offers": count})
    ]
    assert str(events[0][2]) == me["user"]["id"]
    assert "sand_abc" not in str(events)


async def test_hotel_supplier_failures_are_recorded(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    respx_mock.post(RATES).mock(return_value=httpx.Response(500, json={"error": "down"}))
    agency = (await signup(client)).json()["agency"]["id"]
    await client.post("/api/v1/hotels/search", json=stay())
    rows = await exec_as_tenant(
        agency, "SELECT search_kind, supplier, status, offer_count FROM search_source_results"
    )
    assert rows == [("hotels", "liteapi", "error", 0)]


async def test_unconfigured_hotels_are_not_a_supplier_call(client, airports):
    """No key means no call: nothing for supplier health, but the search still shows in activity."""
    agency = (await signup(client)).json()["agency"]["id"]
    await client.post("/api/v1/hotels/search", json=stay())
    assert await exec_as_tenant(agency, "SELECT count(*) FROM search_source_results") == [(0,)]
    assert await exec_as_tenant(
        agency, "SELECT summary FROM activity_events WHERE kind = 'search.hotels'"
    ) == [("Searched hotels near BOM · 0 offers",)]


async def test_price_checks_are_recorded(client, airports, monkeypatch):
    same = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="same")
    original = make_offer(
        [("DEL", "BOM", "ZZ", "2", "2026-11-20T09:00")], offer_ref="moving", total_minor=500000
    )
    moved = original.model_copy(update={"total": Money(amount_minor=530000, currency="INR")})

    class TwoPrices(StubSupplier):
        async def price(self, supplier_ref):
            return same if supplier_ref == same.supplier_ref else moved

    use_suppliers(monkeypatch, TwoPrices("stub", [same, original]))
    me = (await signup(client)).json()
    agency = me["agency"]["id"]
    await client.post("/api/v1/flights/search", json=trip())
    assert (await client.post("/api/v1/flights/offers/stub~same/price")).status_code == 200
    assert (await client.post("/api/v1/flights/offers/stub~moving/price")).status_code == 200
    events = await exec_as_tenant(
        agency,
        "SELECT summary, data, actor_user_id FROM activity_events"
        " WHERE kind = 'supplier.price_checked' ORDER BY occurred_at",
    )
    assert [s for s, _, _ in events] == [
        "Checked price for ZZ DEL→BOM: confirmed",
        "Checked price for ZZ DEL→BOM: changed",
    ]
    assert events[1][1] == {
        "supplier": "stub",
        "carrier": "ZZ",
        "origin": "DEL",
        "destination": "BOM",
        "price_changed": True,
    }
    assert {str(actor) for _, _, actor in events} == {me["user"]["id"]}


async def test_a_failed_price_check_records_nothing(client, airports, monkeypatch):
    offer = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="old")
    expired = SupplierError("offer_expired", "This offer has expired.")
    use_suppliers(monkeypatch, StubSupplier("stub", [offer], price=expired))
    agency = (await signup(client)).json()["agency"]["id"]
    await client.post("/api/v1/flights/search", json=trip())
    assert (await client.post("/api/v1/flights/offers/stub~old/price")).status_code == 410
    assert await exec_as_tenant(
        agency, "SELECT count(*) FROM activity_events WHERE kind = 'supplier.price_checked'"
    ) == [(0,)]
