"""The final answer: the model's prose and plan block, and the plan the board shows.

The model ends with prose and a fenced JSON block (`ModelPlan`): a summary, the ids it picked
(F1, H1, P1) and next steps. `split_answer` separates the two. The board's plan
(`PlanResult`, stored as the run's result) never takes a price, flight number or date from the
model: `build_result` resolves the ids through the run memory into the cards the tools returned
(an id the run never returned is dropped), and takes the trip, itinerary, budget and weather
from the latest results of the tools that produce them. Without a plan block, the latest
searches' first options fill the board.

The itinerary's day titles, notes and dates are the model's own words (build_itinerary echoes
them), so the guard checks them too (`itinerary_text`), like the prose. On a fallback the board
keeps each day's date and items and drops its title and notes.

`fallback_summary` writes a short summary from that plan alone: what the guard shows instead of
an answer that still had ungrounded values after its one re-prompt.
"""

import json
import re
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from travelmind.agent.context import ItemKind, RunMemory
from travelmind.agent.provider import ToolResult

DEFAULT_OPTIONS = 3  # options per kind shown when the model listed none
MAX_LISTED = 6
MAX_NEXT_STEPS = 5
_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)
_MAX_OBJECT_STARTS = 50


class ModelPlan(BaseModel):
    """What the model writes in its final JSON block: ids only, never prices."""

    model_config = ConfigDict(extra="ignore")

    summary: str | None = Field(None, max_length=4000)
    flights: list[str] = Field(default_factory=list, max_length=20)
    hotels: list[str] = Field(default_factory=list, max_length=20)
    places: list[str] = Field(default_factory=list, max_length=20)
    next_steps: list[str] = Field(default_factory=list, max_length=20)


class PlanResult(BaseModel):
    """The run's result: the summary and the cards, all from tool results."""

    summary: str
    trip: dict[str, Any] | None = None
    flights: list[dict[str, Any]] = Field(default_factory=list)
    hotels: list[dict[str, Any]] = Field(default_factory=list)
    places: list[dict[str, Any]] = Field(default_factory=list)
    itinerary: list[dict[str, Any]] = Field(default_factory=list)
    budget: dict[str, Any] | None = None
    weather: dict[str, Any] | None = None
    next_steps: list[str] = Field(default_factory=list)
    fallback: bool = False


def _plan(raw: str) -> ModelPlan | None:
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    try:
        return ModelPlan.model_validate(data)
    except ValidationError:
        return None


def split_answer(text: str) -> tuple[str, ModelPlan | None]:
    """(prose, plan): the last fenced JSON block, or a JSON object ending the text, taken out
    of the prose. A missing or broken block gives no plan (and the prose as written)."""
    fences = list(_FENCE.finditer(text))
    if fences:
        last = fences[-1]
        plan = _plan(last.group(1))
        if plan is not None:
            prose = (text[: last.start()] + text[last.end() :]).strip()
            return prose, plan
        if "```" in text:
            return _FENCE.sub("", text).strip(), None
    stripped = text.rstrip()
    if stripped.endswith("}"):
        starts = [i for i, char in enumerate(stripped) if char == "{"][-_MAX_OBJECT_STARTS:]
        for start in starts:
            plan = _plan(stripped[start:])
            if plan is not None:
                return stripped[:start].strip(), plan
    return text.strip(), None


def _latest(results: Sequence[ToolResult]) -> dict[str, dict[str, Any]]:
    """Each tool's latest successful result."""
    latest: dict[str, dict[str, Any]] = {}
    for result in results:
        if isinstance(result.data, dict) and "error" not in result.data:
            latest[result.name] = result.data
    return latest


def _cards(memory: RunMemory, kind: ItemKind, refs: Sequence[str]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ref in refs:
        item = memory.get(ref) if isinstance(ref, str) else None
        if item is None or item.kind != kind or item.ref in seen:
            continue
        seen.add(item.ref)
        cards.append(item.card)
    return cards[:MAX_LISTED]


def _ids(data: dict[str, Any] | None, key: str, id_field: str, limit: int) -> list[str]:
    rows = (data or {}).get(key) or []
    return [str(row[id_field]) for row in rows if isinstance(row, dict) and row.get(id_field)][
        :limit
    ]


def itinerary_text(days: Sequence[dict[str, Any]]) -> str:
    """The model-written text of the itinerary's days (title, notes, displayed date), one line
    each, for the guard."""
    lines = []
    for day in days:
        for key in ("date_display", "title", "notes"):
            value = day.get(key) if isinstance(day, dict) else None
            if isinstance(value, str) and value.strip():
                lines.append(value)
    return "\n".join(lines)


def _without_model_text(day: dict[str, Any]) -> dict[str, Any]:
    return day | {"title": None, "notes": None} if isinstance(day, dict) else day


def build_result(
    memory: RunMemory,
    results: Sequence[ToolResult],
    plan: ModelPlan | None,
    *,
    summary: str,
    fallback: bool,
) -> PlanResult:
    """The board's plan from the run's own results (see the module docstring)."""
    latest = _latest(results)
    flights = latest.get("search_flights")
    hotels = latest.get("search_hotels")
    places = latest.get("find_places")
    if plan is not None:
        flight_refs, hotel_refs, place_refs = plan.flights, plan.hotels, plan.places
    else:
        flight_refs = _ids(flights, "offers", "offer_id", DEFAULT_OPTIONS)
        hotel_refs = _ids(hotels, "hotels", "hotel_id", DEFAULT_OPTIONS)
        place_refs = _ids(places, "places", "place_id", MAX_LISTED)
    trip = (flights or {}).get("trip") or (hotels or {}).get("trip")
    weather = latest.get("weather_forecast")
    itinerary = latest.get("build_itinerary")
    next_steps = [] if fallback or plan is None else plan.next_steps[:MAX_NEXT_STEPS]
    days = list((itinerary or {}).get("days") or [])
    if fallback:  # the guard didn't pass: the days keep their dates and items only
        days = [_without_model_text(day) for day in days]
    return PlanResult(
        summary=summary,
        trip=trip if isinstance(trip, dict) else None,
        flights=_cards(memory, "flight", flight_refs),
        hotels=_cards(memory, "hotel", hotel_refs),
        places=_cards(memory, "place", place_refs),
        itinerary=days,
        budget=latest.get("estimate_budget"),
        weather=(
            {k: weather.get(k) for k in ("place", "label", "note", "units", "days", "attribution")}
            if weather
            else None
        ),
        next_steps=[step.strip() for step in next_steps if step.strip()],
        fallback=fallback,
    )


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _trip_line(trip: dict[str, Any]) -> str | None:
    if trip.get("origin") and trip.get("destination"):
        line = f"{trip['origin']} → {trip['destination']}"
        if trip.get("depart_date_display"):
            line += f", {trip['depart_date_display']}"
        if trip.get("return_date_display"):
            line += f" to {trip['return_date_display']}"
        adults = trip.get("adults")
        if isinstance(adults, int):
            line += f", {_count(adults, 'adult', 'adults')}"
        children = trip.get("children_ages") or []
        if children:
            line += f" and {_count(len(children), 'child', 'children')}"
        return line + "."
    if trip.get("destination") and trip.get("check_in_display"):
        line = f"A stay near {trip['destination']}, {trip['check_in_display']}"
        if trip.get("check_out_display"):
            line += f" to {trip['check_out_display']}"
        return line + "."
    return None


def fallback_summary(result: PlanResult) -> str:
    """A short summary written only from the plan's tool data: grounded by construction."""
    lines: list[str] = []
    if result.trip and (line := _trip_line(result.trip)):
        lines.append(line)
    if result.flights:
        first = result.flights[0]
        line = f"Flights: {_count(len(result.flights), 'option', 'options')}"
        numbers = ", ".join(first.get("flight_numbers") or [])
        if numbers and first.get("total_formatted"):
            line += f"; {first.get('offer_id')} is {numbers} at {first['total_formatted']} in total"
        lines.append(line + ".")
    if result.hotels:
        first = result.hotels[0]
        line = f"Hotels: {_count(len(result.hotels), 'option', 'options')}"
        if first.get("total_formatted"):
            line += f"; {first.get('hotel_id')} is {first['total_formatted']} for the stay"
        lines.append(line + ".")
    if result.budget and result.budget.get("total_formatted"):
        lines.append(f"Estimated total: {result.budget['total_formatted']}.")
    if result.weather and result.weather.get("days"):
        label = result.weather.get("label") or "forecast"
        days = len(result.weather["days"])
        lines.append(f"Weather: {_count(days, 'day', 'days')} of {label} conditions.")
    if not lines:
        return "The searches have nothing to show yet."
    return " ".join(lines)
