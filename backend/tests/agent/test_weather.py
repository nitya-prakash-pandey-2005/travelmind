"""weather_forecast: Open-Meteo's daily forecast up to today + 14, typical conditions beyond it."""

import json
from datetime import date

import httpx
import pytest
from prometheus_client import REGISTRY
from pydantic import SecretStr

from tests.agent.conftest import (
    agent_settings,
    fixture_json,
    open_meteo_archive,
    run_context,
)
from travelmind.agent.provider import ToolCall
from travelmind.agent.tools import execute
from travelmind.agent.tools.weather import (
    ARCHIVE_URL,
    CUSTOMER_ARCHIVE_URL,
    CUSTOMER_FORECAST_URL,
    FORECAST_URL,
)
from travelmind.cache import get_shared_redis
from travelmind.resilience import GUARDED_SUPPLIERS

TODAY = date(2026, 10, 4)


async def weather(ctx, **args):
    result = await execute(ctx, ToolCall(id="w1", name="weather_forecast", args=args))
    return result.data


def _calls(supplier: str, outcome: str) -> float:
    value = REGISTRY.get_sample_value(
        "supplier_request_duration_seconds_count", {"supplier": supplier, "outcome": outcome}
    )
    return value or 0.0


def forecast_answer() -> httpx.Response:
    return httpx.Response(200, json=fixture_json("open_meteo_forecast.json"))


async def test_within_the_window_it_is_the_forecast(agency, airports, respx_mock):
    route = respx_mock.get(url__startswith=FORECAST_URL).mock(return_value=forecast_answer())
    before = _calls("open_meteo_forecast", "ok")
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-06", end="2026-10-08")
    params = route.calls.last.request.url.params
    assert params["latitude"] == "19.0887" and params["longitude"] == "72.8679"
    assert params["start_date"] == "2026-10-06" and params["end_date"] == "2026-10-08"
    assert params["timezone"] == "auto" and "apikey" not in params
    assert set(params["daily"].split(",")) == {
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "precipitation_probability_max",
    }
    assert data["label"] == "forecast"
    assert data["place"] == {
        "name": "Mumbai",
        "code": "BOM",
        "latitude": 19.0887,
        "longitude": 72.8679,
    }
    assert data["days"] == [
        {
            "date": "2026-10-06",
            "date_display": "6 Oct 2026",
            "temp_max_c": 31.4,
            "temp_min_c": 25.1,
            "precipitation_mm": 0.0,
            "precipitation_chance_pct": 10,
            "conditions": "Partly cloudy",
        },
        {
            "date": "2026-10-07",
            "date_display": "7 Oct 2026",
            "temp_max_c": 30.2,
            "temp_min_c": 24.8,
            "precipitation_mm": 12.3,
            "precipitation_chance_pct": 70,
            "conditions": "Rain",
        },
        {
            "date": "2026-10-08",
            "date_display": "8 Oct 2026",
            "temp_max_c": 29.8,
            "temp_min_c": None,
            "precipitation_mm": 30.1,
            "precipitation_chance_pct": 90,
            "conditions": "Thunderstorm",
        },
    ]
    assert "Open-Meteo" in data["attribution"]
    assert "OpenStreetMap" not in data["attribution"]  # an airport: nothing was geocoded
    assert {"open_meteo_forecast", "open_meteo_archive"} <= GUARDED_SUPPLIERS
    assert _calls("open_meteo_forecast", "ok") == before + 1


async def test_further_out_it_is_typical_weather(agency, airports, respx_mock):
    route = respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    forecast = respx_mock.get(url__startswith=FORECAST_URL)
    before = _calls("open_meteo_archive", "ok")
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-12-12", end="2026-12-14")
    assert not forecast.called and route.call_count == 5
    # One request a year, each for the trip's own days only, over the last five years.
    windows = sorted(
        (c.request.url.params["start_date"], c.request.url.params["end_date"]) for c in route.calls
    )
    assert windows == [(f"{y}-12-12", f"{y}-12-14") for y in range(2021, 2026)]
    assert _calls("open_meteo_archive", "ok") == before + 5
    assert data["label"] == "typical"
    assert "not a forecast" in data["note"]
    assert [d["date"] for d in data["days"]] == ["2026-12-12", "2026-12-13", "2026-12-14"]
    first = data["days"][0]
    # Highs 30.2 … 31.0 over 2021–2025; 2 mm of rain in the three odd years.
    assert first["temp_max_c"] == 30.6 and first["temp_min_c"] == 20.6
    assert first["precipitation_mm"] == 1.2 and first["precipitation_chance_pct"] == 60
    assert first["conditions"] is None


async def test_a_range_running_past_the_forecast_window_is_typical(agency, airports, respx_mock):
    respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-15", end="2026-10-22")
    assert data["label"] == "typical" and len(data["days"]) == 8


@pytest.mark.parametrize(("end", "label"), [("2026-10-18", "forecast"), ("2026-10-19", "typical")])
async def test_the_forecast_reaches_today_plus_14(agency, airports, respx_mock, end, label):
    respx_mock.get(url__startswith=FORECAST_URL).mock(return_value=forecast_answer())
    respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-16", end=end)
    assert data["label"] == label


async def test_a_refused_forecast_range_falls_back_to_typical(agency, airports, respx_mock):
    forecast = respx_mock.get(url__startswith=FORECAST_URL).mock(
        return_value=httpx.Response(400, json={"error": True, "reason": "out of range"})
    )
    respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-16", end="2026-10-18")
    assert forecast.called and data["label"] == "typical" and len(data["days"]) == 3


async def test_a_forecast_day_with_gaps_is_kept_with_nulls(agency, airports, respx_mock):
    body = fixture_json("open_meteo_forecast.json")
    for values in body["daily"].values():  # 7 October is missing from the answer altogether
        del values[1]
    respx_mock.get(url__startswith=FORECAST_URL).mock(return_value=httpx.Response(200, json=body))
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-06", end="2026-10-08")
    assert [d["date"] for d in data["days"]] == ["2026-10-06", "2026-10-07", "2026-10-08"]
    assert data["days"][1] == {
        "date": "2026-10-07",
        "date_display": "7 Oct 2026",
        "temp_max_c": None,
        "temp_min_c": None,
        "precipitation_mm": None,
        "precipitation_chance_pct": None,
        "conditions": None,
    }


async def test_weather_is_cached(agency, airports, respx_mock):
    route = respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    async with run_context(*agency, today=TODAY) as ctx:
        first = await weather(ctx, place_or_airport="BOM", start="2026-12-12", end="2026-12-14")
        again = await weather(ctx, place_or_airport="BOM", start="2026-12-12", end="2026-12-14")
    assert route.call_count == 5 and first == again
    redis = get_shared_redis()
    keys = [k async for k in redis.scan_iter("tm:agent:wx*")]
    ttls = [await redis.ttl(k) for k in keys]
    # Each year's answer is kept for 7 days.
    assert len(keys) == 5 and all(6 * 86_400 < ttl <= 7 * 86_400 for ttl in ttls)


async def test_a_place_name_is_geocoded_first(agency, airports, respx_mock):
    nominatim = respx_mock.get(url__startswith="https://nominatim.openstreetmap.org/search").mock(
        return_value=httpx.Response(200, json=fixture_json("nominatim_search.json"))
    )
    forecast = respx_mock.get(url__startswith=FORECAST_URL).mock(return_value=forecast_answer())
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="Mumbai", start="2026-10-06", end="2026-10-08")
    assert nominatim.call_count == 1
    assert forecast.calls.last.request.url.params["latitude"] == "19.055"
    assert data["place"]["name"] == "Mumbai" and data["place"]["code"] is None
    # Geocoded through Nominatim: OpenStreetMap is credited as well as Open-Meteo.
    assert "Open-Meteo" in data["attribution"] and "OpenStreetMap" in data["attribution"]


async def test_a_city_alias_is_its_airport_not_a_code(agency, airports, respx_mock):
    respx_mock.get(url__startswith=FORECAST_URL).mock(return_value=forecast_answer())
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="Goa", start="2026-10-06", end="2026-10-08")
    assert data["place"]["code"] == "GOI" and data["place"]["name"] == "Goa"


@pytest.mark.parametrize("status", [500, 429])
async def test_an_unavailable_feed_is_a_clean_error(agency, airports, respx_mock, status):
    respx_mock.get(url__startswith=FORECAST_URL).mock(return_value=httpx.Response(status))
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-06", end="2026-10-08")
    assert data["error"]["code"] == "unavailable"
    assert "open-meteo.com" not in json.dumps(data)


@pytest.mark.parametrize(
    ("start", "end", "message"),
    [
        ("2026-10-03", "2026-10-05", "past"),
        ("2026-10-10", "2026-11-20", "31 days"),
        ("2027-10-10", "2027-10-12", "360 days"),
    ],
)
async def test_weather_dates_are_checked(agency, start, end, message):
    async with run_context(*agency, settings=agent_settings(), today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start=start, end=end)
    assert data["error"]["code"] == "invalid_arguments"
    assert message in data["error"]["message"]


# --- Open-Meteo's commercial terms ----------------------------------------------------------


async def test_with_a_key_the_customer_hosts_are_used(agency, airports, respx_mock):
    secret = "om-sEcReT-42"
    forecast = respx_mock.get(url__startswith=CUSTOMER_FORECAST_URL).mock(
        return_value=forecast_answer()
    )
    archive = respx_mock.get(url__startswith=CUSTOMER_ARCHIVE_URL).mock(
        side_effect=open_meteo_archive
    )
    settings = agent_settings(environment="production", open_meteo_api_key=SecretStr(secret))
    async with run_context(*agency, settings=settings, today=TODAY) as ctx:
        near = await weather(ctx, place_or_airport="BOM", start="2026-10-06", end="2026-10-08")
        far = await weather(ctx, place_or_airport="BOM", start="2026-12-12", end="2026-12-13")
    assert forecast.calls.last.request.url.params["apikey"] == secret
    assert archive.call_count == 5
    assert all(c.request.url.params["apikey"] == secret for c in archive.calls)
    assert CUSTOMER_FORECAST_URL.startswith("https://customer-api.open-meteo.com/")
    assert CUSTOMER_ARCHIVE_URL.startswith("https://customer-archive-api.open-meteo.com/")
    assert near["label"] == "forecast" and far["label"] == "typical"
    assert secret not in json.dumps([near, far])


async def test_production_without_a_key_has_no_weather(agency, airports, respx_mock):
    forecast = respx_mock.get(url__startswith=FORECAST_URL)
    settings = agent_settings(environment="production")
    async with run_context(*agency, settings=settings, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-06", end="2026-10-08")
    assert not forecast.called
    assert data["error"]["code"] == "unavailable"
    assert "isn't set up" in data["error"]["message"]


def test_production_startup_warns_once_about_missing_feed_settings():
    from structlog.testing import capture_logs

    from travelmind.agent.tools.external import warn_about_feed_settings

    with capture_logs() as logs:
        warn_about_feed_settings(agent_settings(environment="production"))
    events = sorted(e["event"] for e in logs if e["log_level"] == "warning")
    assert events == ["agent_open_meteo_key_missing", "agent_osm_contact_missing"]
    with capture_logs() as quiet:
        warn_about_feed_settings(agent_settings(environment="development"))
        warn_about_feed_settings(
            agent_settings(
                environment="production",
                osm_contact="ops@example.com",
                open_meteo_api_key=SecretStr("k"),
            )
        )
    assert quiet == []
