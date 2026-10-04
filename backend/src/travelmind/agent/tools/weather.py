"""weather_forecast: Open-Meteo.

- Up to today + FORECAST_MAX_DAYS_AHEAD (the forecast's reliable reach; Open-Meteo serves 16
  days) the whole range is the daily forecast: `GET {host}/v1/forecast` with `start_date`,
  `end_date`, `timezone=auto` and the daily weather code, high, low, precipitation and its
  probability. Labelled `forecast`. A day the answer lacks is kept, its values null. If
  Open-Meteo refuses the range (400), the answer is typical weather instead.
- Any range reaching further is `typical` weather: the average of the same calendar days over
  the last TYPICAL_YEARS years, from Open-Meteo's historical weather API (ERA5 reanalysis,
  `GET {archive host}/v1/archive`, about five days behind). One request a year, each covering
  only the trip's days in that year, cached for a week (the past doesn't change). Not a
  forecast, and the result says so.

Terms: Open-Meteo's free API (api.open-meteo.com, archive-api.open-meteo.com) is for
non-commercial use, under 10,000 calls a day, with attribution (CC BY 4.0, in every result).
A commercial deployment needs a subscription: with TM_OPEN_METEO_API_KEY set, calls go to the
customer hosts (customer-api.open-meteo.com, customer-archive-api.open-meteo.com; historical
weather needs the Professional plan or higher) with the key as `apikey`. In production without a
key the tool answers `unavailable` (and startup logs a warning: `external.warn_about_feed_
settings`). The key travels in the query string: URLs are never logged.

A place found through Nominatim also credits OpenStreetMap. Each host has its own breaker and
metrics label: `open_meteo_forecast`, `open_meteo_archive`.
"""

import asyncio
import math
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import Field, model_validator

from travelmind.agent.context import RunContext
from travelmind.agent.tools.base import Args, ToolError, display_date
from travelmind.agent.tools.external import FeedRefused, cache_key, cached, fetch_json
from travelmind.agent.tools.places import OSM_ATTRIBUTION, Location, resolve
from travelmind.config import Settings

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
CUSTOMER_FORECAST_URL = "https://customer-api.open-meteo.com/v1/forecast"
CUSTOMER_ARCHIVE_URL = "https://customer-archive-api.open-meteo.com/v1/archive"
FORECAST_SUPPLIER = "open_meteo_forecast"
ARCHIVE_SUPPLIER = "open_meteo_archive"
FORECAST_MAX_DAYS_AHEAD = 14  # a range ending by today + 14 is the forecast
TYPICAL_YEARS = 5
ARCHIVE_DELAY_DAYS = 6  # ERA5 runs about five days behind
MAX_SPAN_DAYS = 31
MAX_DAYS_AHEAD = 360
FORECAST_TTL_S = 3 * 3600
ARCHIVE_TTL_S = 7 * 24 * 3600
RAIN_DAY_MM = 1.0
ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"
UNAVAILABLE = "Weather is unavailable right now. Try again shortly."
NOT_SET_UP = "Weather isn't set up for this deployment yet, so there is no forecast to give."
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
        min_length=2,
        max_length=100,
        description="City or area, or an airport code in capitals (BOM).",
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


class Feed:
    """Where the calls go: the free hosts, or the customer hosts with a paid plan's key."""

    def __init__(self, settings: Settings) -> None:
        key = settings.open_meteo_api_key
        self.forecast_url = CUSTOMER_FORECAST_URL if key else FORECAST_URL
        self.archive_url = CUSTOMER_ARCHIVE_URL if key else ARCHIVE_URL
        self.key = {"apikey": key.get_secret_value()} if key else {}
        # The free API is non-commercial: production weather needs the paid plan.
        self.available = key is not None or settings.environment != "production"


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=n) for n in range((end - start).days + 1)]


def _number(values: object, index: int | None) -> float | None:
    if index is None or not isinstance(values, list) or index >= len(values):
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
    """Every day from start to end; a day the answer lacks (or a value it lacks) is null."""
    daily, index = _series(body)
    days = []
    for when in _days(start, end):
        i = index.get(when)
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


def typical_years(start: date, end: date, today: date) -> list[int]:
    """How many years back to look (1, 2, ...): the last TYPICAL_YEARS years whose copy of the
    trip's days the archive already has in full."""
    latest = today - timedelta(days=ARCHIVE_DELAY_DAYS)
    usable = [n for n in range(1, TYPICAL_YEARS + 2) if _years_back(end, n) <= latest]
    return usable[:TYPICAL_YEARS]


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def parse_year(body: object) -> dict[str, list[float | None]]:
    """One archive answer as {ISO date: [max, min, precipitation]}."""
    daily, index = _series(body)
    return {
        when.isoformat(): [_number(daily.get(name), i) for name in ARCHIVE_DAILY]
        for when, i in index.items()
    }


def average_years(
    start: date, end: date, years: dict[int, dict[str, list[float | None]]]
) -> list[dict[str, Any]]:
    """Each trip day's average over the years given (by how many years back)."""
    days = []
    for when in _days(start, end):
        found = [y.get(_years_back(when, n).isoformat()) for n, y in years.items()]
        rows = [row for row in found if row is not None]

        def values(column: int, rows: list[list[float | None]] = rows) -> list[float]:
            return [v for row in rows if (v := row[column]) is not None]

        rain = values(2)
        chance = round(100 * sum(1 for v in rain if v >= RAIN_DAY_MM) / len(rain)) if rain else None
        days.append(
            _day(
                when,
                temp_max_c=_mean(values(0)),
                temp_min_c=_mean(values(1)),
                precipitation_mm=_mean(rain),
                precipitation_chance_pct=chance,
                conditions=None,
            )
        )
    return days


def _where(place: Location) -> dict[str, str]:
    return {"latitude": repr(place.latitude), "longitude": repr(place.longitude)}


async def _forecast(feed: Feed, place: Location, start: date, end: date) -> list[dict[str, Any]]:
    body = await fetch_json(
        FORECAST_SUPPLIER,
        "GET",
        feed.forecast_url,
        params=_where(place)
        | {
            "daily": ",".join(FORECAST_DAILY),
            "timezone": "auto",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        }
        | feed.key,
        unavailable=UNAVAILABLE,
        deadline_s=6.0,
    )
    return parse_forecast(body, start, end)


async def _year(
    ctx: RunContext, feed: Feed, place: Location, start: date, end: date
) -> dict[str, list[float | None]]:
    """One past year's copy of the trip's days, cached for ARCHIVE_TTL_S."""

    async def load() -> dict[str, list[float | None]]:
        body = await fetch_json(
            ARCHIVE_SUPPLIER,
            "GET",
            feed.archive_url,
            params=_where(place)
            | {
                "daily": ",".join(ARCHIVE_DAILY),
                "timezone": "auto",
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            }
            | feed.key,
            unavailable=UNAVAILABLE,
            deadline_s=10.0,
        )
        return parse_year(body)

    key = cache_key("wxy", repr(place.latitude), repr(place.longitude), start, end)
    return await cached(ctx.redis, key, ARCHIVE_TTL_S, load)


async def _typical(
    ctx: RunContext, feed: Feed, place: Location, start: date, end: date
) -> list[dict[str, Any]]:
    back = typical_years(start, end, ctx.today())
    if not back:
        raise ToolError("unavailable", UNAVAILABLE)
    answers = await asyncio.gather(
        *(_year(ctx, feed, place, _years_back(start, n), _years_back(end, n)) for n in back)
    )
    return average_years(start, end, dict(zip(back, answers, strict=True)))


async def weather_forecast(ctx: RunContext, args: WeatherArgs) -> dict[str, Any]:
    today = ctx.today()
    if args.start < today:
        raise ToolError("invalid_arguments", "The start date is in the past.")
    if args.end > today + timedelta(days=MAX_DAYS_AHEAD):
        raise ToolError(
            "invalid_arguments", f"Weather can be given at most {MAX_DAYS_AHEAD} days ahead."
        )
    feed = Feed(ctx.settings)
    if not feed.available:
        raise ToolError("unavailable", NOT_SET_UP)
    place = await resolve(ctx, args.place_or_airport, city_centre=False)
    label: Literal["forecast", "typical"] = "typical"
    days: list[dict[str, Any]] | None = None
    if args.end <= today + timedelta(days=FORECAST_MAX_DAYS_AHEAD):
        key = cache_key(
            "wx", "forecast", repr(place.latitude), repr(place.longitude), args.start, args.end
        )
        try:
            days = await cached(
                ctx.redis,
                key,
                FORECAST_TTL_S,
                lambda: _forecast(feed, place, args.start, args.end),
            )
            label = "forecast"
        except FeedRefused:  # Open-Meteo won't forecast that range: typical weather instead
            days = None
    if days is None:
        days = await _typical(ctx, feed, place, args.start, args.end)
    credits = [ATTRIBUTION] + ([f"Place search {OSM_ATTRIBUTION}"] if place.geocoded else [])
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
        "attribution": "; ".join(credits),
    }
