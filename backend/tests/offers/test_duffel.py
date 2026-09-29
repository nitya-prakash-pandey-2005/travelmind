import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from travelmind.offers.models import FlightSearchRequest
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError
from travelmind.offers.suppliers.duffel import (
    DUFFEL_BASE_URL,
    DuffelFlightSupplier,
    parse_iso_duration,
)

FIXTURES = Path(__file__).parent / "fixtures"
BASE = DUFFEL_BASE_URL  # tests use respx's `respx_mock` pytest fixture with full URLs


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def request() -> FlightSearchRequest:
    return FlightSearchRequest(
        origin="LHR",
        destination="SYD",
        departure_date=datetime.now(UTC).date() + timedelta(days=50),
        adults=1,
        children_ages=[8],
    )


def supplier() -> DuffelFlightSupplier:
    return DuffelFlightSupplier("duffel_test_abc", supplier_timeout_ms=9000)


def test_parse_iso_duration():
    assert parse_iso_duration("PT02H26M") == 146
    assert parse_iso_duration("P1DT1H5M") == 1505
    assert parse_iso_duration("PT45M") == 45
    assert parse_iso_duration(None) is None
    assert parse_iso_duration("garbage") is None


async def test_search_sends_the_documented_request(respx_mock):
    route = respx_mock.post(f"{BASE}/air/offer_requests").mock(
        return_value=httpx.Response(201, json=fixture("duffel_offer_request.json"))
    )
    await supplier().search(request())
    sent = route.calls.last.request
    assert sent.headers["Authorization"] == "Bearer duffel_test_abc"
    assert sent.headers["Duffel-Version"] == "v2"
    assert sent.url.params["return_offers"] == "true"
    assert sent.url.params["supplier_timeout"] == "9000"
    body = json.loads(sent.content)["data"]
    assert body["slices"] == [
        {
            "origin": "LHR",
            "destination": "SYD",
            "departure_date": request().departure_date.isoformat(),
        }
    ]
    assert body["passengers"] == [{"type": "adult"}, {"age": 8}]
    assert body["cabin_class"] == "economy"
    assert body["max_connections"] == 1


async def test_offers_are_mapped_exactly(respx_mock):
    respx_mock.post(f"{BASE}/air/offer_requests").mock(
        return_value=httpx.Response(201, json=fixture("duffel_offer_request.json"))
    )
    offers = await supplier().search(request())
    assert [o.supplier_ref for o in offers] == [
        "off_0000CONNECT",
        "off_0000NONSTOP",
    ]  # cheapest first

    connect, nonstop = offers
    assert connect.id == "duffel~off_0000CONNECT"
    assert connect.total == Money(amount_minor=61240, currency="GBP")
    assert connect.tax == Money(amount_minor=13240, currency="GBP")
    assert connect.owner_carrier == "EK"
    assert connect.stops == 1
    assert connect.slices[0].duration_minutes == 1505
    assert connect.slices[0].segments[1].flight_number == "414"
    assert connect.slices[0].segments[0].departing_at == datetime(2026, 11, 20, 8, 30)
    assert (connect.baggage.checked, connect.baggage.carry_on) == (2, 1)
    assert connect.conditions.refundable is None
    assert connect.conditions.changeable is True
    assert connect.conditions.change_penalty == Money(amount_minor=7500, currency="GBP")
    assert connect.co2_kg_per_passenger is None
    assert connect.expires_at == datetime(2026, 11, 1, 10, 42, 14, 545000, tzinfo=UTC)
    assert connect.passenger_count == 2

    assert nonstop.tax is None
    assert nonstop.conditions.refundable is True
    assert nonstop.conditions.refund_penalty == Money(amount_minor=15000, currency="GBP")
    assert nonstop.conditions.change_penalty is None
    assert nonstop.slices[0].segments[0].operating_carrier == "QF"
    assert (nonstop.co2_kg_per_passenger, nonstop.co2_source) == (920, "supplier")


async def test_test_mode_offers_are_labelled_sandbox(respx_mock):
    respx_mock.post(f"{BASE}/air/offer_requests").mock(
        return_value=httpx.Response(201, json=fixture("duffel_offer_request.json"))
    )
    assert {o.provenance for o in await supplier().search(request())} == {"SANDBOX"}


async def test_live_mode_offers_are_labelled_live(respx_mock):
    payload = fixture("duffel_offer_request.json")
    payload["data"]["live_mode"] = True
    for offer in payload["data"]["offers"]:
        offer["live_mode"] = True
    respx_mock.post(f"{BASE}/air/offer_requests").mock(
        return_value=httpx.Response(201, json=payload)
    )
    assert {o.provenance for o in await supplier().search(request())} == {"LIVE"}


async def test_price_fetches_the_current_offer(respx_mock):
    route = respx_mock.get(f"{BASE}/air/offers/off_0000CONNECT").mock(
        return_value=httpx.Response(200, json=fixture("duffel_offer.json"))
    )
    offer = await supplier().price("off_0000CONNECT")
    assert route.calls.last.request.url.params["return_available_services"] == "false"
    assert offer.total == Money(amount_minor=64010, currency="GBP")


def _error(status: int, type_: str, code: str) -> httpx.Response:
    return httpx.Response(
        status,
        json={
            "errors": [{"type": type_, "code": code, "title": "x", "message": "Upstream detail"}],
            "meta": {"status": status},
        },
    )


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (_error(401, "authentication_error", "expired_access_token"), "auth"),
        (_error(429, "rate_limit_error", "rate_limit_exceeded"), "rate_limited"),
        (_error(422, "invalid_state_error", "offer_expired"), "offer_expired"),
        (_error(422, "airline_error", "offer_no_longer_available"), "offer_unavailable"),
        (_error(404, "invalid_request_error", "not_found"), "offer_unavailable"),
        (_error(422, "validation_error", "validation_required"), "invalid_request"),
        (_error(502, "airline_error", "airline_unknown"), "unavailable"),
        (httpx.Response(500, text="<html>oops</html>"), "unavailable"),
        (httpx.Response(500, json={"errors": ["boom"]}), "unavailable"),
    ],
)
async def test_errors_become_supplier_errors(respx_mock, response, code):
    respx_mock.get(f"{BASE}/air/offers/off_x").mock(return_value=response)
    with pytest.raises(SupplierError) as err:
        await supplier().price("off_x")
    assert err.value.code == code
    assert "Upstream detail" not in err.value.message or code == "invalid_request"


async def test_timeouts_and_network_failures(respx_mock):
    respx_mock.post(f"{BASE}/air/offer_requests").mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(SupplierError) as err:
        await supplier().search(request())
    assert err.value.code == "timeout"

    respx_mock.post(f"{BASE}/air/offer_requests").mock(side_effect=httpx.ConnectError("down"))
    with pytest.raises(SupplierError) as err:
        await supplier().search(request())
    assert err.value.code == "unavailable"


async def test_unknown_cabin_values_become_none(respx_mock):
    payload = fixture("duffel_offer_request.json")
    for offer in payload["data"]["offers"]:
        offer["slices"][0]["segments"][0]["passengers"][0]["cabin_class"] = "sleeper_suite"
    respx_mock.post(f"{BASE}/air/offer_requests").mock(
        return_value=httpx.Response(201, json=payload)
    )
    offers = await supplier().search(request())
    assert {o.cabin for o in offers} == {None}


async def test_known_cabin_is_kept(respx_mock):
    respx_mock.post(f"{BASE}/air/offer_requests").mock(
        return_value=httpx.Response(201, json=fixture("duffel_offer_request.json"))
    )
    assert {o.cabin for o in await supplier().search(request())} == {"economy"}


@pytest.mark.parametrize(
    "ref", ["../orders/ord_1", "off_1?x=1", "off_1/actions/price", "", "ord_123", "off_1\n"]
)
async def test_price_rejects_refs_that_are_not_offer_ids(respx_mock, ref):
    with pytest.raises(SupplierError) as err:
        await supplier().price(ref)
    assert err.value.code == "offer_unavailable"
    assert not respx_mock.calls


@pytest.mark.parametrize("emissions", ["Infinity", "NaN", "lots"])
async def test_unusable_emissions_are_dropped(respx_mock, emissions):
    payload = fixture("duffel_offer_request.json")
    payload["data"]["offers"][1]["total_emissions_kg"] = emissions
    respx_mock.post(f"{BASE}/air/offer_requests").mock(
        return_value=httpx.Response(201, json=payload)
    )
    nonstop = (await supplier().search(request()))[1]
    assert (nonstop.co2_kg_per_passenger, nonstop.co2_source) == (None, None)
