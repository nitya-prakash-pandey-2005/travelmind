"""weather_forecast: Open-Meteo's daily forecast within 16 days, typical conditions beyond it."""

import json
from datetime import date

import httpx
import pytest
from prometheus_client import REGISTRY

from tests.agent.conftest import (
    agent_settings,
    fixture_json,
    open_meteo_archive,
    run_context,
)
from travelmind.agent.provider import ToolCall
from travelmind.agent.tools import execute
from travelmind.agent.tools.weather import ARCHIVE_URL, FORECAST_URL
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


async def test_within_16_days_it_is_the_forecast(agency, airports, respx_mock):
    route = respx_mock.get(url__startswith=FORECAST_URL).mock(
        return_value=httpx.Response(200, json=fixture_json("open_meteo_forecast.json"))
    )
    before = _calls("open_meteo", "ok")
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-10-06", end="2026-10-08")
    params = route.calls.last.request.url.params
    assert params["latitude"] == "19.0887" and params["longitude"] == "72.8679"
    assert params["start_date"] == "2026-10-06" and params["end_date"] == "2026-10-08"
    assert params["timezone"] == "auto"
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
    assert "open_meteo" in GUARDED_SUPPLIERS
    assert _calls("open_meteo", "ok") == before + 1


async def test_beyond_16_days_it_is_typical_weather(agency, airports, respx_mock):
    route = respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    forecast = respx_mock.get(url__startswith=FORECAST_URL)
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="BOM", start="2026-12-12", end="2026-12-14")
    assert not forecast.called and route.call_count == 1
    params = route.calls.last.request.url.params
    # One request: the same calendar days over the last five years.
    assert params["start_date"] == "2021-12-12" and params["end_date"] == "2025-12-14"
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


async def test_weather_is_cached(agency, airports, respx_mock):
    route = respx_mock.get(url__startswith=ARCHIVE_URL).mock(side_effect=open_meteo_archive)
    async with run_context(*agency, today=TODAY) as ctx:
        first = await weather(ctx, place_or_airport="BOM", start="2026-12-12", end="2026-12-14")
        again = await weather(ctx, place_or_airport="bom", start="2026-12-12", end="2026-12-14")
    assert route.call_count == 1 and first == again


async def test_a_place_name_is_geocoded_first(agency, airports, respx_mock):
    nominatim = respx_mock.get(url__startswith="https://nominatim.openstreetmap.org/search").mock(
        return_value=httpx.Response(200, json=fixture_json("nominatim_search.json"))
    )
    forecast = respx_mock.get(url__startswith=FORECAST_URL).mock(
        return_value=httpx.Response(200, json=fixture_json("open_meteo_forecast.json"))
    )
    async with run_context(*agency, today=TODAY) as ctx:
        data = await weather(ctx, place_or_airport="Mumbai", start="2026-10-06", end="2026-10-08")
    assert nominatim.call_count == 1
    assert forecast.calls.last.request.url.params["latitude"] == "19.055"
    assert data["place"]["name"] == "Mumbai" and data["place"]["code"] is None


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
