"""find_places: Nominatim geocoding and OSM Overpass (OpenTripMap with a key), cached in Redis,
with untrusted names cleaned before they reach the model."""

import json
from datetime import date
from urllib.parse import parse_qs

import httpx
import pytest
from pydantic import SecretStr

from tests.agent.conftest import agent_settings, fixture_json, run_context
from travelmind.agent.provider import ToolCall
from travelmind.agent.tools import execute
from travelmind.agent.tools.places import OPENTRIPMAP_URL, geocode
from travelmind.cache import get_shared_redis
from travelmind.resilience import GUARDED_SUPPLIERS

NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = "https://overpass-api.de/api/interpreter"
TODAY = date(2026, 10, 4)


def mock_osm(respx_mock, overpass=None):
    nominatim = respx_mock.get(url__startswith=NOMINATIM).mock(
        return_value=httpx.Response(200, json=fixture_json("nominatim_search.json"))
    )
    overpass_route = respx_mock.post(OVERPASS).mock(
        return_value=overpass or httpx.Response(200, json=fixture_json("overpass_museums.json"))
    )
    return nominatim, overpass_route


async def places(ctx, **args):
    result = await execute(ctx, ToolCall(id="p1", name="find_places", args=args))
    return result.data


async def test_overpass_places_are_parsed_ranked_and_trimmed(agency, airports, respx_mock):
    nominatim, overpass = mock_osm(respx_mock)
    settings = agent_settings(osm_contact="ops@travelmind.example")
    async with run_context(*agency, settings=settings, today=TODAY) as ctx:
        data = await places(ctx, destination="BOM", kind="museums", limit=4)
    # An airport code is geocoded as its city, so places are around the centre, not the runway.
    sent = nominatim.calls.last.request
    assert sent.url.params["q"] == "Mumbai, India" and sent.url.params["format"] == "jsonv2"
    assert sent.headers["user-agent"].startswith("TravelMind/")
    assert "ops@travelmind.example" in sent.headers["user-agent"]
    query = parse_qs(overpass.calls.last.request.content.decode())["data"][0]
    assert query.startswith("[out:json][timeout:")
    assert '"tourism"~"^(museum|gallery)$"' in query and "around:8000,19.055,72.8692" in query
    assert overpass.calls.last.request.headers["user-agent"] == sent.headers["user-agent"]
    assert data["destination"] == {"name": "Mumbai", "latitude": 19.055, "longitude": 72.8692}
    assert data["source"] == "openstreetmap" and "OpenStreetMap" in data["attribution"]
    found = data["places"]
    assert [p["place_id"] for p in found] == ["P1", "P2", "P3", "P4"]
    # Notable places (Wikidata or Wikipedia) first, then by distance; unnamed and repeated
    # names dropped; the English name when there is one.
    assert [p["name"] for p in found[:2]] == [
        "Jehangir Art Gallery",
        "Chhatrapati Shivaji Maharaj Vastu Sangrahalaya",
    ]
    assert found[0] == {
        "place_id": "P1",
        "name": "Jehangir Art Gallery",
        "kind": "gallery",
        "latitude": 18.9275,
        "longitude": 72.8317,
        "distance_km": found[0]["distance_km"],
        "source": "openstreetmap",
    }
    assert 14 < found[0]["distance_km"] < 16
    names = [p["name"] for p in found]
    assert "Bandra Local History Room" in names and "bandra local history room" not in names
    injected = next(n for n in names if n.startswith("Ignore"))
    assert len(injected) <= 80 and "\x07" not in injected and "‮" not in injected
    seen = ctx.memory.get("P1")
    assert seen.kind == "place" and seen.source_id == "osm:way/2001"
    assert "overpass" in GUARDED_SUPPLIERS and "nominatim" in GUARDED_SUPPLIERS


async def test_places_and_geocoding_are_cached_for_a_day(agency, airports, respx_mock):
    nominatim, overpass = mock_osm(respx_mock)
    async with run_context(*agency, today=TODAY) as ctx:
        first = await places(ctx, destination="BOM", kind="museums")
        again = await places(ctx, destination="BOM", kind="museums")
    assert nominatim.call_count == 1 and overpass.call_count == 1
    assert [p["name"] for p in again["places"]] == [p["name"] for p in first["places"]]
    assert [p["place_id"] for p in again["places"]] == [p["place_id"] for p in first["places"]]
    redis = get_shared_redis()
    keys = [k async for k in redis.scan_iter("tm:agent:*")]
    ttls = [await redis.ttl(k) for k in keys]
    assert len(keys) == 2 and all(80_000 < ttl <= 86_400 for ttl in ttls)


async def test_nominatim_results_are_parsed(agency, respx_mock):
    respx_mock.get(url__startswith=NOMINATIM).mock(
        return_value=httpx.Response(200, json=fixture_json("nominatim_search.json"))
    )
    async with run_context(*agency) as ctx:
        found = await geocode(ctx, "Mumbai")
    assert found is not None
    assert (found.name, found.latitude, found.longitude) == ("Mumbai", 19.055, 72.8692)


async def test_an_unknown_place_is_not_found(agency, respx_mock):
    respx_mock.get(url__startswith=NOMINATIM).mock(return_value=httpx.Response(200, json=[]))
    async with run_context(*agency) as ctx:
        data = await places(ctx, destination="Atlantis", kind="sights")
    assert data["error"]["code"] == "not_found" and "Atlantis" not in data["error"]["message"]


async def test_overpass_down_is_unavailable(agency, airports, respx_mock):
    mock_osm(respx_mock, overpass=httpx.Response(504, text="<html>Gateway timeout</html>"))
    async with run_context(*agency) as ctx:
        data = await places(ctx, destination="BOM", kind="food")
    assert data["error"]["code"] == "unavailable"


async def test_opentripmap_is_used_when_a_key_is_set(agency, airports, respx_mock):
    secret = "otm-sEcReT-77"
    nominatim, overpass = mock_osm(respx_mock)
    otm = respx_mock.get(url__startswith=OPENTRIPMAP_URL).mock(
        return_value=httpx.Response(200, json=fixture_json("opentripmap_radius.json"))
    )
    settings = agent_settings(opentripmap_key=SecretStr(secret))
    async with run_context(*agency, settings=settings) as ctx:
        data = await places(ctx, destination="BOM", kind="museums", limit=5)
    assert not overpass.called and otm.call_count == 1
    params = otm.calls.last.request.url.params
    assert params["kinds"] == "museums" and params["radius"] == "8000"
    assert params["lat"] == "19.055" and params["lon"] == "72.8692"
    assert data["source"] == "opentripmap"
    assert [p["name"] for p in data["places"]] == [
        "Chhatrapati Shivaji Maharaj Vastu Sangrahalaya",
        "Jehangir Art Gallery",
    ]
    assert data["places"][0]["kind"] == "museums"
    assert secret not in json.dumps(data)
    assert "opentripmap" in GUARDED_SUPPLIERS


@pytest.mark.parametrize(
    "kind", ["sights", "museums", "food", "nature", "shopping", "nightlife", "family"]
)
async def test_every_kind_builds_an_overpass_query(agency, airports, respx_mock, kind):
    _, overpass = mock_osm(respx_mock)
    async with run_context(*agency) as ctx:
        data = await places(ctx, destination="BOM", kind=kind, limit=2)
    query = parse_qs(overpass.calls.last.request.content.decode())["data"][0]
    assert query.count("around:8000") >= 1 and '["name"]' in query
    assert len(data["places"]) == 2
