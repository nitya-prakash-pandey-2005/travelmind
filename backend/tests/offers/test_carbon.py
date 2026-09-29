import asyncio
import json
import os
import time

import httpx
import pytest
from redis.asyncio import Redis
from structlog.testing import capture_logs

from tests.offers.offer_factory import make_offer
from travelmind.offers.carbon import TIM_BASE_URL, TimClient

# Tests use respx's `respx_mock` pytest fixture with full URLs; they never reach Google.
FLIGHTS = f"{TIM_BASE_URL}/flights:computeFlightEmissions"
TYPICAL = f"{TIM_BASE_URL}/flights:computeTypicalFlightEmissions"


def grams(economy: int) -> dict:
    return {
        "economy": economy,
        "premiumEconomy": economy * 2,
        "business": economy * 3,
        "first": economy * 4,
    }


def known_connection():
    return make_offer(
        [
            ("LHR", "DXB", "EK", "2", "2026-11-20T08:30"),
            ("DXB", "SYD", "EK", "414", "2026-11-20T21:45"),
        ],
        offer_ref="known",
    )


def synthetic_nonstop():
    return make_offer([("DEL", "BOM", "6E", "2045", "2026-11-20T06:10")], offer_ref="synthetic")


async def redis_client() -> Redis:
    return Redis.from_url(os.environ["TM_REDIS_URL"])


async def test_known_flights_use_per_flight_emissions(respx_mock):
    route = respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            200,
            json={
                "flightEmissions": [
                    {"emissionsGramsPerPax": grams(410_000)},
                    {"emissionsGramsPerPax": grams(820_000)},
                ]
            },
        )
    )
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([known_connection()], "economy")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (1230, "google_tim")
    sent = route.calls.last.request
    assert sent.url.params["key"] == "tim-key"
    body = json.loads(sent.content)["flights"]
    assert body[0] == {
        "origin": "LHR",
        "destination": "DXB",
        "operatingCarrierCode": "EK",
        "flightNumber": 2,
        "departureDate": {"year": 2026, "month": 11, "day": 20},
    }


async def test_unknown_flights_fall_back_to_route_typical(respx_mock):
    respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(200, json={"flightEmissions": [{"flight": {}}]})
    )
    respx_mock.post(TYPICAL).mock(
        return_value=httpx.Response(
            200,
            json={
                "typicalFlightEmissions": [
                    {
                        "market": {"origin": "DEL", "destination": "BOM"},
                        "emissionsGramsPerPax": grams(98_600),
                    }
                ]
            },
        )
    )
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([synthetic_nonstop()], "business")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (296, "google_tim_typical")


async def test_supplier_figures_are_kept_unless_flight_data_exists(respx_mock):
    respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(200, json={"flightEmissions": [{"flight": {}}]})
    )
    respx_mock.post(TYPICAL).mock(
        return_value=httpx.Response(
            200,
            json={
                "typicalFlightEmissions": [
                    {
                        "market": {"origin": "DEL", "destination": "BOM"},
                        "emissionsGramsPerPax": grams(98_600),
                    }
                ]
            },
        )
    )
    supplied = synthetic_nonstop().model_copy(
        update={"co2_kg_per_passenger": 105, "co2_source": "supplier"}
    )
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([supplied], "economy")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (105, "supplier")


async def test_results_are_cached(respx_mock):
    route = respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            200,
            json={
                "flightEmissions": [
                    {"emissionsGramsPerPax": grams(410_000)},
                    {"emissionsGramsPerPax": grams(820_000)},
                ]
            },
        )
    )
    redis = await redis_client()
    try:
        client = TimClient("tim-key", redis)
        await client.enrich([known_connection()], "economy")
        [offer] = await client.enrich([known_connection()], "economy")
    finally:
        await redis.aclose()
    assert route.call_count == 1
    assert offer.co2_source == "google_tim"


async def test_api_failures_leave_offers_untouched(respx_mock):
    respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            403, json={"error": {"code": 403, "message": "API key not valid"}}
        )
    )
    respx_mock.post(TYPICAL).mock(return_value=httpx.Response(503))
    redis = await redis_client()
    try:
        [offer] = await TimClient("bad-key", redis).enrich([synthetic_nonstop()], "economy")
    finally:
        await redis.aclose()
    assert offer.co2_kg_per_passenger is None and offer.co2_source is None


def unknown_everywhere(respx_mock):
    flights = respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(200, json={"flightEmissions": [{"flight": {}}]})
    )
    typical = respx_mock.post(TYPICAL).mock(
        return_value=httpx.Response(200, json={"typicalFlightEmissions": [{"market": {}}]})
    )
    return flights, typical


async def test_no_data_markers_are_cached(respx_mock):
    flights, typical = unknown_everywhere(respx_mock)
    redis = await redis_client()
    try:
        client = TimClient("tim-key", redis)
        await client.enrich([synthetic_nonstop()], "economy")
        [offer] = await client.enrich([synthetic_nonstop()], "economy")
        flight_key, market_key = "tim:f:6E2045:DELBOM:2026-11-20", "tim:m:DELBOM"
        assert await redis.get(flight_key) == b"none"
        assert await redis.get(market_key) == b"none"
        assert 23 * 3600 < await redis.ttl(flight_key) <= 24 * 3600
        assert 6 * 24 * 3600 < await redis.ttl(market_key) <= 7 * 24 * 3600
    finally:
        await redis.aclose()
    assert (flights.call_count, typical.call_count) == (1, 1)
    assert offer.co2_kg_per_passenger is None and offer.co2_source is None


async def test_http_failures_cache_nothing_and_never_log_the_key(respx_mock):
    respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            403, json={"error": {"code": 403, "message": "API key not valid"}}
        )
    )
    respx_mock.post(TYPICAL).mock(side_effect=httpx.ConnectError("down"))
    redis = await redis_client()
    try:
        with capture_logs() as logs:
            [offer] = await TimClient("secret-tim-key", redis).enrich(
                [synthetic_nonstop()], "economy"
            )
        assert await redis.keys("tim:*") == []
    finally:
        await redis.aclose()
    assert offer.co2_kg_per_passenger is None and offer.co2_source is None
    assert [e["event"] for e in logs] == ["tim_unavailable", "tim_unavailable"]
    assert "secret-tim-key" not in repr(logs)


BAD_FLIGHT_PAYLOADS = [
    [],
    {"flightEmissions": "junk"},
    {"flightEmissions": ["junk"]},
    {"flightEmissions": [{"emissionsGramsPerPax": "lots"}]},
    {"flightEmissions": [{"emissionsGramsPerPax": {"economy": "98600"}}]},
    {"flightEmissions": [{"emissionsGramsPerPax": {"economy": True}}]},
    {"flightEmissions": [{"emissionsGramsPerPax": {"economy": -5}}]},
]
BAD_TYPICAL_PAYLOADS = [
    {"typicalFlightEmissions": "junk"},
    {"typicalFlightEmissions": [42, {"market": "DELBOM"}]},
    {
        "typicalFlightEmissions": [
            {"market": {"origin": "DEL", "destination": "BOM"}, "emissionsGramsPerPax": [1]}
        ]
    },
    {
        "typicalFlightEmissions": [
            {
                "market": {"origin": "DEL", "destination": "BOM"},
                "emissionsGramsPerPax": {"economy": 1.5e300},
            }
        ]
    },
]


@pytest.mark.parametrize("flight_payload", BAD_FLIGHT_PAYLOADS)
@pytest.mark.parametrize("typical_payload", BAD_TYPICAL_PAYLOADS)
async def test_malformed_responses_never_raise(respx_mock, flight_payload, typical_payload):
    respx_mock.post(FLIGHTS).mock(return_value=httpx.Response(200, json=flight_payload))
    respx_mock.post(TYPICAL).mock(return_value=httpx.Response(200, json=typical_payload))
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([synthetic_nonstop()], "economy")
    finally:
        await redis.aclose()
    assert offer.co2_kg_per_passenger is None and offer.co2_source is None


async def test_non_json_response_leaves_offers_untouched(respx_mock):
    respx_mock.post(FLIGHTS).mock(return_value=httpx.Response(200, text="<html>oops</html>"))
    respx_mock.post(TYPICAL).mock(return_value=httpx.Response(200, text="not json"))
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([synthetic_nonstop()], "economy")
        assert await redis.keys("tim:*") == []
    finally:
        await redis.aclose()
    assert offer.co2_source is None


async def test_a_short_flight_response_is_not_attributed_to_the_wrong_flight(respx_mock):
    # Results come back in request order; with fewer results than flights, none can be trusted.
    respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            200, json={"flightEmissions": [{"emissionsGramsPerPax": grams(410_000)}]}
        )
    )
    respx_mock.post(TYPICAL).mock(
        return_value=httpx.Response(200, json={"typicalFlightEmissions": []})
    )
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([known_connection()], "economy")
        assert await redis.keys("tim:f:*") == []
    finally:
        await redis.aclose()
    assert offer.co2_source is None


async def test_corrupt_cache_entries_are_refetched(respx_mock):
    route = respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            200,
            json={
                "flightEmissions": [
                    {"emissionsGramsPerPax": grams(410_000)},
                    {"emissionsGramsPerPax": grams(820_000)},
                ]
            },
        )
    )
    redis = await redis_client()
    try:
        await redis.set("tim:f:EK2:LHRDXB:2026-11-20", "{broken")
        await redis.set("tim:f:EK414:DXBSYD:2026-11-20", json.dumps(["not", "grams"]))
        [offer] = await TimClient("tim-key", redis).enrich([known_connection()], "economy")
    finally:
        await redis.aclose()
    assert route.call_count == 1
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (1230, "google_tim")


async def test_redis_outage_still_enriches(respx_mock):
    respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            200,
            json={
                "flightEmissions": [
                    {"emissionsGramsPerPax": grams(410_000)},
                    {"emissionsGramsPerPax": grams(820_000)},
                ]
            },
        )
    )
    redis = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.2)
    try:
        with capture_logs() as logs:
            [offer] = await TimClient("tim-key", redis).enrich([known_connection()], "economy")
    finally:
        await redis.aclose()
    assert offer.co2_source == "google_tim"
    assert {e["event"] for e in logs} == {"tim_cache_unavailable"}


def with_segment(offer, **changes):
    [slice_] = offer.slices
    [segment] = slice_.segments
    moved = slice_.model_copy(update={"segments": [segment.model_copy(update=changes)]})
    return offer.model_copy(update={"slices": [moved]})


def typical_delbom(respx_mock):
    return respx_mock.post(TYPICAL).mock(
        return_value=httpx.Response(
            200,
            json={
                "typicalFlightEmissions": [
                    {
                        "market": {"origin": "DEL", "destination": "BOM"},
                        "emissionsGramsPerPax": grams(98_600),
                    }
                ]
            },
        )
    )


async def test_codeshares_are_looked_up_by_the_operating_flight(respx_mock):
    route = respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            200, json={"flightEmissions": [{"emissionsGramsPerPax": grams(90_000)}]}
        )
    )
    codeshare = with_segment(
        synthetic_nonstop(),
        marketing_carrier="AI",
        flight_number="123",
        operating_carrier="UK",
        operating_flight_number="0977",
    )
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([codeshare], "economy")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (90, "google_tim")
    [sent] = json.loads(route.calls.last.request.content)["flights"]
    assert (sent["operatingCarrierCode"], sent["flightNumber"]) == ("UK", 977)


@pytest.mark.parametrize(
    "changes",
    [
        # Operated by another airline whose flight number we don't know: the marketing number
        # would name a different flight, so only the route-typical figure is safe.
        {"marketing_carrier": "AI", "operating_carrier": "UK", "operating_flight_number": None},
        {"flight_number": "²"},  # a Unicode digit: str.isdigit() accepts it, int() doesn't
        {"flight_number": "12A"},
        {"flight_number": "0"},
        {"flight_number": "99999999999"},
    ],
)
async def test_unusable_flight_identities_use_route_typical(respx_mock, changes):
    typical_delbom(respx_mock)
    offer_in = with_segment(synthetic_nonstop(), **changes)
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([offer_in], "economy")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (99, "google_tim_typical")


async def test_a_slow_tim_never_holds_up_the_search(respx_mock):
    async def stall(request):
        await asyncio.sleep(5)
        return httpx.Response(200, json={"flightEmissions": []})

    respx_mock.post(FLIGHTS).mock(side_effect=stall)
    redis = await redis_client()
    try:
        started = time.monotonic()
        with capture_logs() as logs:
            [offer] = await TimClient("tim-key", redis, timeout_s=0.2).enrich(
                [synthetic_nonstop()], "economy"
            )
        elapsed = time.monotonic() - started
    finally:
        await redis.aclose()
    assert elapsed < 2
    assert offer.co2_source is None
    assert [e["event"] for e in logs] == ["tim_timeout"]


async def test_offers_keep_their_order_and_non_candidates_are_untouched(respx_mock):
    respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(
            200, json={"flightEmissions": [{"emissionsGramsPerPax": grams(90_000)}]}
        )
    )
    already = synthetic_nonstop().model_copy(
        update={
            "id": "stub~typical",
            "co2_kg_per_passenger": 80,
            "co2_source": "google_tim_typical",
        }
    )
    fresh = synthetic_nonstop()
    redis = await redis_client()
    try:
        first, second = await TimClient("tim-key", redis).enrich([already, fresh], "economy")
    finally:
        await redis.aclose()
    assert first is already
    assert (second.id, second.co2_kg_per_passenger, second.co2_source) == (
        "stub~synthetic",
        90,
        "google_tim",
    )
