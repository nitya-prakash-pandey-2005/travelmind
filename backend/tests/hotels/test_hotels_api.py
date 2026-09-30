import asyncio
import copy
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from redis.asyncio import Redis

from tests.helpers import signup
from travelmind.config import get_settings
from travelmind.hotels import service as hotels_service
from travelmind.hotels.liteapi import LITEAPI_BASE_URL, LiteApiHotelSupplier
from travelmind.hotels.models import HotelSearchRequest
from travelmind.offers import service as offers_service
from travelmind.offers.fx import ECB_DAILY_URL
from travelmind.offers.models import FlightSearchRequest
from travelmind.offers.service import RateLimited

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "liteapi_rates.json").read_text(encoding="utf-8")
)
ECB_XML = (Path(__file__).parents[1] / "offers" / "fixtures" / "ecb_daily.xml").read_text(
    encoding="utf-8"
)
SEARCH = "/api/v1/hotels/search"
FLIGHTS = "/api/v1/flights/search"
RATES = f"{LITEAPI_BASE_URL}/hotels/rates"
TODAY = datetime.now(UTC).date()


def stay(**changes) -> dict:
    return {
        "destination": "BOM",
        "checkin": (TODAY + timedelta(days=30)).isoformat(),
        "checkout": (TODAY + timedelta(days=32)).isoformat(),
    } | changes


def priced(amounts: dict[str, tuple[float, str]]) -> dict:
    """The fixture with each hotel's offers re-priced to (amount, currency)."""
    payload = copy.deepcopy(FIXTURE)
    for item in payload["data"]:
        amount, currency = amounts[item["hotelId"]]
        for room_type in item["roomTypes"]:
            room_type["offerRetailRate"] = {"amount": amount, "currency": currency}
    return payload


async def test_without_a_key_hotels_are_not_configured(client, airports):
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    assert body["offers"] == []
    assert body["sources"][0]["supplier"] == "liteapi"
    assert body["sources"][0]["status"] == "not_configured"
    assert "TM_LITEAPI_KEY" in body["sources"][0]["message"]


async def test_hotel_search_returns_offers_in_display_currency(
    client, airports, monkeypatch, respx_mock
):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    route = respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    assert body["display_currency"] == "INR" and body["nights"] == 2
    assert body["sources"][0]["status"] == "ok"
    assert body["sources"][0]["offer_count"] == 2
    assert [o["hotel_id"] for o in body["offers"]] == ["lp2044", "lp1897"]
    assert body["offers"][0]["display_total"] == body["offers"][0]["total"]
    assert body["offers"][0]["provenance"] == "SANDBOX"
    sent = json.loads(route.calls.last.request.content)
    assert (sent["currency"], sent["radius"]) == ("INR", 15000)
    assert "sand_abc" not in json.dumps(body)


async def test_foreign_currency_rates_are_converted_and_ranked(
    client, airports, monkeypatch, respx_mock
):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    monkeypatch.setattr(get_settings(), "fx_enabled", True)
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=ECB_XML))
    payload = priced({"lp1897": (100, "USD"), "lp2044": (1, "ZZZ")})
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=payload))
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    harbour, unknown = body["offers"]
    # 100 USD × 90.4000 / 1.0850 = 8331.797… INR, rounded half-up to the paisa.
    assert harbour["display_total"] == {"amount_minor": 833180, "currency": "INR"}
    assert harbour["total"] == {"amount_minor": 10000, "currency": "USD"}
    assert unknown["hotel_id"] == "lp2044" and unknown["display_total"] is None
    assert body["fx_as_of"] == "2026-09-28"


async def test_same_currency_results_skip_the_fx_feed(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    monkeypatch.setattr(get_settings(), "fx_enabled", True)
    ecb = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=ECB_XML))
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    assert len(body["offers"]) == 2 and body["fx_as_of"] is None
    assert not ecb.called


async def test_hotel_supplier_failures_are_reported(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    respx_mock.post(RATES).mock(return_value=httpx.Response(401, json={"error": {"code": 401}}))
    await signup(client)
    response = await client.post(SEARCH, json=stay())
    assert response.status_code == 200
    body = response.json()
    assert body["offers"] == []
    assert body["sources"][0]["status"] == "error"
    assert "TM_LITEAPI_KEY" in body["sources"][0]["message"]
    assert "sand_abc" not in json.dumps(body)


async def test_a_slow_supplier_is_reported_as_a_timeout(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    monkeypatch.setattr(get_settings(), "search_timeout_seconds", 0.05)

    async def slow(self, request, **kwargs):
        await asyncio.sleep(1)
        return []

    monkeypatch.setattr(LiteApiHotelSupplier, "search", slow)
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    assert body["sources"][0]["status"] == "timeout"
    assert body["sources"][0]["message"] == "No answer within 0.05s."
    assert body["offers"] == []


async def test_an_unexpected_supplier_failure_is_reported(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")

    async def broken(self, request, **kwargs):
        raise RuntimeError("bug with sand_abc inside")

    monkeypatch.setattr(LiteApiHotelSupplier, "search", broken)
    await signup(client)
    response = await client.post(SEARCH, json=stay())
    assert response.status_code == 200
    source = response.json()["sources"][0]
    assert source["status"] == "error" and "sand_abc" not in source["message"]


async def test_hotel_search_validates_input(client, airports):
    await signup(client)
    unknown = await client.post(SEARCH, json=stay(destination="XXX"))
    assert unknown.status_code == 422
    assert "XXX" in unknown.text
    assert (await client.post(SEARCH, json=stay(checkout=stay()["checkin"]))).status_code == 422
    assert (await client.post(SEARCH, json={})).status_code == 422


async def test_hotel_search_needs_a_session(client, airports):
    assert (await client.post(SEARCH, json=stay())).status_code == 401


async def test_hotel_searches_are_rate_limited_per_agency(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_max_per_minute", 2)
    await signup(client)
    assert (await client.post(SEARCH, json=stay())).status_code == 200
    assert (await client.post(SEARCH, json=stay())).status_code == 200
    blocked = await client.post(SEARCH, json=stay())
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == (
        "Too many searches in a minute. Please wait a moment and try again."
    )


async def test_hotel_and_flight_search_budgets_are_separate(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_max_per_minute", 1)
    monkeypatch.setattr(get_settings(), "sandbox_supplier", True)
    await signup(client)
    assert (await client.post(SEARCH, json=stay())).status_code == 200
    assert (await client.post(SEARCH, json=stay())).status_code == 429
    trip = {"origin": "DEL", "destination": "BOM", "departure_date": stay()["checkin"]}
    assert (await client.post(FLIGHTS, json=trip)).status_code == 200
    assert (await client.post(FLIGHTS, json=trip)).status_code == 429
    assert (await client.post(SEARCH, json=stay())).status_code == 429


async def test_direct_service_callers_are_rate_limited_too(monkeypatch):
    """The copilot calls the services directly, so the limit lives there, before any DB use."""
    settings = get_settings()
    monkeypatch.setattr(settings, "search_max_per_minute", 0)
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    agency = uuid4()
    hotel_stay = HotelSearchRequest.model_validate(stay())
    flight_trip = FlightSearchRequest(
        origin="DEL", destination="BOM", departure_date=hotel_stay.checkin
    )
    try:
        with pytest.raises(RateLimited):
            await hotels_service.search_hotels(
                None,  # type: ignore[arg-type]
                redis,
                settings,
                hotel_stay,
                agency_id=agency,
                guest_nationality="IN",
            )
        with pytest.raises(RateLimited):
            await offers_service.search_flights(
                None,  # type: ignore[arg-type]
                redis,
                settings,
                flight_trip,
                agency_id=agency,
                user_id=None,
            )
    finally:
        await redis.aclose()


async def test_guest_nationality_follows_agency_country(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    route = respx_mock.post(f"{LITEAPI_BASE_URL}/hotels/rates").mock(
        return_value=httpx.Response(200, json=FIXTURE)
    )
    await signup(client)
    await client.patch("/api/v1/agency", json={"country_code": "AE"})
    await client.post(SEARCH, json=stay())
    assert json.loads(route.calls.last.request.content)["guestNationality"] == "AE"
