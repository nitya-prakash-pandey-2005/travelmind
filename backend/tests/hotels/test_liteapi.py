import copy
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from travelmind.hotels.liteapi import LITEAPI_BASE_URL, LiteApiHotelSupplier
from travelmind.hotels.models import HotelSearchRequest, RoomRequest
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError

RATES = f"{LITEAPI_BASE_URL}/hotels/rates"
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "liteapi_rates.json").read_text(encoding="utf-8")
)
TODAY = datetime.now(UTC).date()


def request() -> HotelSearchRequest:
    return HotelSearchRequest(
        destination="BOM",
        checkin=TODAY + timedelta(days=30),
        checkout=TODAY + timedelta(days=32),
        rooms=[RoomRequest(adults=2, children_ages=[6])],
    )


async def search(key: str = "sand_abc", **kwargs):
    return await LiteApiHotelSupplier(key).search(
        request(), latitude=19.0887, longitude=72.8679, currency="INR", **kwargs
    )


async def test_sends_the_documented_request(respx_mock):
    route = respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    await search()
    sent = route.calls.last.request
    assert sent.headers["X-API-Key"] == "sand_abc"
    body = json.loads(sent.content)
    assert body["occupancies"] == [{"adults": 2, "children": [6]}]
    assert "rooms" not in body
    assert (body["latitude"], body["longitude"], body["radius"]) == (19.0887, 72.8679, 15000)
    assert (body["currency"], body["guestNationality"], body["includeHotelData"]) == (
        "INR",
        "IN",
        True,
    )
    assert body["checkin"] == request().checkin.isoformat()


@pytest.mark.parametrize(
    ("budget", "sent"),
    [({}, 8), ({"timeout_s": 25}, 10), ({"timeout_s": 9.5}, 7), ({"timeout_s": 3}, 4)],
)
async def test_liteapi_timeout_fits_inside_the_search_budget(respx_mock, budget, sent):
    route = respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    await search(**budget)
    assert json.loads(route.calls.last.request.content)["timeout"] == sent


async def test_maps_the_cheapest_room_per_hotel(respx_mock):
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    offers = await search()
    assert [o.hotel_id for o in offers] == ["lp2044", "lp1897"]  # cheapest first
    lodge, harbour = offers
    assert harbour.name == "Harbour View Mumbai" and harbour.stars == 5 and harbour.rating == 8.9
    assert harbour.room_name == "Deluxe King Room" and harbour.board == "Bed & Breakfast"
    assert harbour.total == Money(amount_minor=942050, currency="INR")
    assert harbour.refundable is True
    assert harbour.free_cancellation_until == "2026-11-18 12:00:00 GMT"
    assert harbour.photo_url == "https://static.example/lp1897.jpg"
    assert harbour.provenance == "SANDBOX" and harbour.nights == 2
    assert harbour.id == "liteapi~offer-king" and harbour.supplier == "liteapi"
    assert lodge.refundable is False and lodge.free_cancellation_until is None
    assert lodge.photo_url is None


async def test_production_keys_are_live(respx_mock):
    payload = FIXTURE | {"sandbox": False}
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=payload))
    assert {o.provenance for o in await search("prod_key")} == {"LIVE"}


async def test_no_availability_is_an_empty_result(respx_mock):
    respx_mock.post(RATES).mock(
        return_value=httpx.Response(
            200, json={"error": {"code": 2001, "message": "no availability found"}}
        )
    )
    assert await search() == []


async def test_an_empty_data_list_is_an_empty_result(respx_mock):
    respx_mock.post(RATES).mock(
        return_value=httpx.Response(200, json={"data": [], "sandbox": True})
    )
    assert await search() == []


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(401, json={"error": {"code": 401, "message": "Unauthorized"}}), "auth"),
        (httpx.Response(403, json={"error": {"code": 403, "message": "Forbidden"}}), "auth"),
        (
            httpx.Response(429, json={"error": {"code": 429, "message": "Too many requests"}}),
            "rate_limited",
        ),
        (httpx.Response(200, json={"error": {"code": 5000, "message": "internal"}}), "unavailable"),
        (httpx.Response(200, json={"error": "boom"}), "unavailable"),
        (httpx.Response(502, text="bad gateway"), "unavailable"),
        (httpx.Response(200, text="<html>not json</html>"), "unavailable"),
        (httpx.Response(200, json=["not", "an", "object"]), "unavailable"),
        (httpx.Response(200, json={"sandbox": True}), "unavailable"),  # no data, no error
    ],
)
async def test_errors(respx_mock, response, code):
    respx_mock.post(RATES).mock(return_value=response)
    with pytest.raises(SupplierError) as err:
        await search()
    assert err.value.code == code


async def test_timeouts(respx_mock):
    respx_mock.post(RATES).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(SupplierError) as err:
        await search()
    assert err.value.code == "timeout"


async def test_connection_failures_are_unavailable(respx_mock):
    respx_mock.post(RATES).mock(side_effect=httpx.ConnectError("refused"))
    with pytest.raises(SupplierError) as err:
        await search()
    assert err.value.code == "unavailable"
    assert "sand_abc" not in err.value.message


async def test_one_malformed_hotel_does_not_sink_the_search(respx_mock):
    payload = copy.deepcopy(FIXTURE)
    payload["data"] += [
        "not-a-hotel",
        {"hotelId": "lp-bad-rooms", "roomTypes": "nope"},
        {"roomTypes": payload["data"][1]["roomTypes"]},  # no hotelId
        {
            "hotelId": "lp-bad-price",
            "roomTypes": [{"offerId": "x", "offerRetailRate": {"amount": "lots", "currency": 7}}],
        },
    ]
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=payload))
    assert [o.hotel_id for o in await search()] == ["lp2044", "lp1897"]


async def test_untrusted_hotel_fields_are_cleaned(respx_mock):
    payload = copy.deepcopy(FIXTURE)
    payload["hotels"] = [
        {"id": "lp1897", "stars": "five", "rating": True, "main_photo": "javascript:alert(1)"},
        {"id": "lp2044", "name": "  ", "stars": 3.5, "main_photo": "http://img.example/x.jpg"},
    ]
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=payload))
    lodge, harbour = await search()
    assert harbour.name == "Unnamed hotel" and harbour.stars is None and harbour.rating is None
    assert harbour.photo_url is None
    assert lodge.name == "Unnamed hotel" and lodge.stars == 3.5
    assert lodge.photo_url == "http://img.example/x.jpg"


async def test_free_cancellation_runs_until_the_earliest_penalty(respx_mock):
    payload = copy.deepcopy(FIXTURE)
    rate = payload["data"][0]["roomTypes"][0]["rates"][0]
    rate["cancellationPolicies"]["cancelPolicyInfos"] = [
        {"cancelTime": "2026-11-19 12:00:00", "amount": 9420.5, "timezone": "GMT"},
        {"cancelTime": "2026-11-17 18:00:00", "amount": 4710.25, "timezone": "GMT"},
        {"amount": 1},
    ]
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=payload))
    harbour = (await search())[1]
    assert harbour.free_cancellation_until == "2026-11-17 18:00:00 GMT"


async def test_unknown_refund_terms_stay_unknown(respx_mock):
    payload = copy.deepcopy(FIXTURE)
    del payload["data"][1]["roomTypes"][0]["rates"][0]["cancellationPolicies"]
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=payload))
    lodge = (await search())[0]
    assert lodge.refundable is None and lodge.free_cancellation_until is None


async def test_unreadable_hotels_only_is_unavailable(respx_mock):
    respx_mock.post(RATES).mock(
        return_value=httpx.Response(200, json={"data": [{"hotelId": "x", "roomTypes": 5}]})
    )
    with pytest.raises(SupplierError) as err:
        await search()
    assert err.value.code == "unavailable"


@pytest.mark.parametrize(
    ("checkin", "checkout", "message"),
    [
        (-1, 2, "in the past"),
        (10, 10, "after check-in"),
        (10, 45, "at most 30 nights"),
        (361, 362, "360 days ahead"),
    ],
)
def test_request_validation(checkin, checkout, message):
    with pytest.raises(ValueError, match=message):
        HotelSearchRequest(
            destination="BOM",
            checkin=TODAY + timedelta(days=checkin),
            checkout=TODAY + timedelta(days=checkout),
        )


def test_request_defaults():
    stay = HotelSearchRequest(
        destination="bom", checkin=TODAY + timedelta(days=5), checkout=TODAY + timedelta(days=8)
    )
    assert stay.destination == "BOM" and stay.nights == 3 and stay.radius_km == 15
    assert stay.rooms == [RoomRequest(adults=2, children_ages=[])]
