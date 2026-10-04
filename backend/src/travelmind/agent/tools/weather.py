"""weather_forecast: Open-Meteo, no key needed.

- Within the forecast window (today and the next 15 days, FORECAST_DAYS in all) the whole range
  is the daily forecast: `GET https://api.open-meteo.com/v1/forecast` with `start_date`,
  `end_date`, `timezone=auto` and the daily weather code, high, low, precipitation and its
  probability. Labelled `forecast`.
- Any range reaching past it is `typical` weather: the average of the same calendar days over
  the last TYPICAL_YEARS years, from Open-Meteo's historical weather API (ERA5 reanalysis,
  `GET https://archive-api.open-meteo.com/v1/archive`, about five days behind), fetched in one
  request covering those years. Not a forecast, and the result says so.

Open-Meteo's free API is for non-commercial use, under 10,000 calls a day (5,000 an hour, 600 a
minute), with attribution (CC BY 4.0), which every result carries. A commercial deployment needs
an Open-Meteo subscription (the `customer-` hosts with an API key). Answers are cached in Redis:
forecasts for FORECAST_TTL_S (they change through the day), typical weather for 24 h.
"""

import math
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import Field, model_validator

from travelmind.agent.context import RunContext
from travelmind.agent.tools.base import Args, ToolError, display_date
from travelmind.agent.tools.external import DAY_S, cache_key, cached, fetch_json
from travelmind.agent.tools.places import Location, resolve

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
SUPPLIER = "open_meteo"
FORECAST_DAYS = 16  # today and the next 15 days
TYPICAL_YEARS = 5
ARCHIVE_DELAY_DAYS = 6  # ERA5 runs about five days behind
MAX_SPAN_DAYS = 31
MAX_DAYS_AHEAD = 360
FORECAST_TTL_S = 3 * 3600
RAIN_DAY_MM = 1.0
ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"
UNAVAILABLE = "Weather is unavailable right now. Try again shortly."
FORECAST_DAILY = (
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "precipitation_probability_max",
)
ARCHIVE_DAILY = ("temperature_2m_max", "temperature_2m_min", "precipitation_sum")
FORECAST_NOTE = "Daily forecast."
TYPICAL_NOTE = (
    f"Typical conditions: the average of these calendar days over the last {TYPICAL_YEARS}"
    " years, not a forecast."
)
# WMO weather interpretation codes, as Open-Meteo documents them.
CONDITIONS = {
    0: "Clear",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    **dict.fromkeys((51, 53, 55, 56, 57), "Drizzle"),
    **dict.fromkeys((61, 63, 65, 66, 67), "Rain"),
    **dict.fromkeys((71, 73, 75, 77), "Snow"),
    **dict.fromkeys((80, 81, 82), "Rain showers"),
    **dict.fromkeys((85, 86), "Snow showers"),
    **dict.fromkeys((95, 96, 99), "Thunderstorm"),
}


class WeatherArgs(Args):
    place_or_airport: str = Field(
        min_length=2, max_length=100, description="City, area or 3-letter airport code."
    )
    start: date = Field(description="First day, YYYY-MM-DD.")
    end: date = Field(description="Last day, YYYY-MM-DD.")

    @model_validator(mode="after")
    def _range(self) -> "WeatherArgs":
        if self.end < self.start:
            raise ValueError("The end date can't be before the start date.")
        if (self.end - self.start).days + 1 > MAX_SPAN_DAYS:
            raise ValueError(f"A weather range can cover at most {MAX_SPAN_DAYS} days.")
        return self


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=n) for n in range((end - start).days + 1)]


def _number(values: object, index: int) -> float | None:
    if not isinstance(values, list) or index >= len(values):
        return None
    value = values[index]
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _round(value: float | None) -> float | None:
    return round(value, 1) if value is not None else None


def _series(body: object) -> tuple[dict[str, Any], dict[date, int]]:
    """The daily arrays and each date's index in them."""
    daily = body.get("daily") if isinstance(body, dict) else None
    if not isinstance(daily, dict) or not isinstance(daily.get("time"), list):
        raise ToolError("unavailable", UNAVAILABLE)
    index: dict[date, int] = {}
    for i, raw in enumerate(daily["time"]):
        try:
            index[date.fromisoformat(str(raw))] = i
        except ValueError:
            continue
    return daily, index


def _day(when: date, **values: Any) -> dict[str, Any]:
    return {"date": when.isoformat(), "date_display": display_date(when)} | values


def parse_forecast(body: object, start: date, end: date) -> list[dict[str, Any]]:
    daily, index = _series(body)
    days = []
    for when in _days(start, end):
        i = index.get(when)
        if i is None:
            continue
        code = _number(daily.get("weather_code"), i)
        chance = _number(daily.get("precipitation_probability_max"), i)
        days.append(
            _day(
                when,
                temp_max_c=_round(_number(daily.get("temperature_2m_max"), i)),
                temp_min_c=_round(_number(daily.get("temperature_2m_min"), i)),
                precipitation_mm=_round(_number(daily.get("precipitation_sum"), i)),
                precipitation_chance_pct=round(chance) if chance is not None else None,
                conditions=CONDITIONS.get(int(code)) if code is not None else None,
            )
        )
    return days


def _years_back(when: date, years: int) -> date:
    try:
        return when.replace(year=when.year - years)
    except ValueError:  # 29 February
        return when.replace(year=when.year - years, day=28)


def typical_dates(start: date, end: date, today: date) -> dict[date, list[date]]:
    """For each day of the trip, the same calendar day in the last TYPICAL_YEARS years for
    which the archive has data."""
    latest = today - timedelta(days=ARCHIVE_DELAY_DAYS)
    found: dict[date, list[date]] = {}
    for when in _days(start, end):
        past = [_years_back(when, n) for n in range(1, TYPICAL_YEARS + 2)]
        found[when] = [d for d in past if d <= latest][:TYPICAL_YEARS]
    return found


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def parse_typical(body: object, wanted: dict[date, list[date]]) -> list[dict[str, Any]]:
    daily, index = _series(body)

    def values(name: str, dates: list[date]) -> list[float]:
        found = (_number(daily.get(name), index[d]) for d in dates if d in index)
        return [v for v in found if v is not None]

    days = []
    for when, past in wanted.items():
        rain = values("precipitation_sum", past)
        chance = round(100 * sum(1 for v in rain if v >= RAIN_DAY_MM) / len(rain)) if rain else None
        days.append(
            _day(
                when,
                temp_max_c=_mean(values("temperature_2m_max", past)),
                temp_min_c=_mean(values("temperature_2m_min", past)),
                precipitation_mm=_mean(rain),
                precipitation_chance_pct=chance,
                conditions=None,
            )
        )
    return days


def _where(place: Location) -> dict[str, str]:
    return {"latitude": repr(place.latitude), "longitude": repr(place.longitude)}


async def _forecast(place: Location, start: date, end: date) -> list[dict[str, Any]]:
    body = await fetch_json(
        SUPPLIER,
        "GET",
        FORECAST_URL,
        params=_where(place)
        | {
            "daily": ",".join(FORECAST_DAILY),
            "timezone": "auto",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        },
        unavailable=UNAVAILABLE,
        deadline_s=6.0,
    )
    return parse_forecast(body, start, end)


async def _typical(place: Location, start: date, end: date, today: date) -> list[dict[str, Any]]:
    wanted = typical_dates(start, end, today)
    past = [d for dates in wanted.values() for d in dates]
    if not past:
        raise ToolError("unavailable", UNAVAILABLE)
    body = await fetch_json(
        SUPPLIER,
        "GET",
        ARCHIVE_URL,
        params=_where(place)
        | {
            "daily": ",".join(ARCHIVE_DAILY),
            "timezone": "auto",
            "start_date": min(past).isoformat(),
            "end_date": max(past).isoformat(),
        },
        unavailable=UNAVAILABLE,
        deadline_s=10.0,
    )
    return parse_typical(body, wanted)


async def weather_forecast(ctx: RunContext, args: WeatherArgs) -> dict[str, Any]:
    today = ctx.today()
    if args.start < today:
        raise ToolError("invalid_arguments", "The start date is in the past.")
    if args.end > today + timedelta(days=MAX_DAYS_AHEAD):
        raise ToolError(
            "invalid_arguments", f"Weather can be given at most {MAX_DAYS_AHEAD} days ahead."
        )
    place = await resolve(ctx, args.place_or_airport, city_centre=False)
    label: Literal["forecast", "typical"] = (
        "forecast" if args.end < today + timedelta(days=FORECAST_DAYS) else "typical"
    )
    key = cache_key("wx", label, repr(place.latitude), repr(place.longitude), args.start, args.end)
    if label == "forecast":
        days = await cached(
            ctx.redis, key, FORECAST_TTL_S, lambda: _forecast(place, args.start, args.end)
        )
    else:
        days = await cached(
            ctx.redis, key, DAY_S, lambda: _typical(place, args.start, args.end, today)
        )
    return {
        "place": {
            "name": place.name,
            "code": place.code,
            "latitude": place.latitude,
            "longitude": place.longitude,
        },
        "label": label,
        "note": FORECAST_NOTE if label == "forecast" else TYPICAL_NOTE,
        "units": {"temperature": "°C", "precipitation": "mm"},
        "days": days,
        "attribution": ATTRIBUTION,
    }
