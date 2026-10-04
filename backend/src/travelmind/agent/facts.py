"""What a run's tool results vouch for: the values the grounding guard checks prose against.

`facts(result)` collects, from one tool result, only values a supplier or one of our services
provided: money (minor units with their currency, and the formatted text, with and without the
"≈ " of a converted price: both the shown and the supplier's own totals), flight numbers, dates
(ISO and displayed forms, as calendar days: trip dates, departures, rates' dates), airport codes,
and hotel, place, airport and city names. `facts_of(results)` is the union over a run.

It never collects text the model wrote and a tool merely echoed back: `MODEL_AUTHORED_PATHS`
lists those fields per tool (build_itinerary's day titles, notes and dates; ask_user's
question), and an error result (whose message may repeat the model's ids or names) carries no
facts at all. So a price the model writes into an itinerary note is not thereby "in the
results".

Paths are dotted keys with `[]` for a list's items: `days[].notes` is the `notes` of every item
of the result's `days` list.
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, fields
from datetime import date, datetime
from types import MappingProxyType
from typing import Any

from travelmind.agent.provider import ToolResult
from travelmind.agent.tools.base import APPROX

# Fields the model wrote itself, per tool: echoed back, but never facts.
MODEL_AUTHORED_PATHS: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        "build_itinerary": frozenset(
            {"days[].date", "days[].date_display", "days[].title", "days[].notes"}
        ),
        "ask_user": frozenset({"question", "fields"}),
    }
)

_CODE = re.compile(r"[A-Z]{3}")
_CODE_KEYS = frozenset({"origin", "destination", "code", "home_airport"})
_DATE_KEYS = frozenset({"date", "check_in", "check_out", "departs_at", "arrives_at", "fx_as_of"})
_NAME_KEYS = frozenset({"name", "city", "origin_city", "destination_city"})


@dataclass(frozen=True)
class GroundFacts:
    """Values the run's tools returned, in the forms the guard compares."""

    amounts: frozenset[tuple[str, int]] = frozenset()  # (currency, minor units)
    money_text: frozenset[str] = frozenset()  # as formatted: "₹2,16,804", "≈ ₹8,331", "$30"
    flight_numbers: frozenset[str] = frozenset()  # carrier + number, no space: "AI101"
    dates: frozenset[date] = frozenset()
    iata_codes: frozenset[str] = frozenset()
    names: frozenset[str] = frozenset()  # hotels, places, airports, cities

    def __or__(self, other: "GroundFacts") -> "GroundFacts":
        return GroundFacts(
            **{f.name: getattr(self, f.name) | getattr(other, f.name) for f in fields(self)}
        )


EMPTY = GroundFacts()


def flight_key(text: str) -> str:
    """A flight number as facts keep it: capitals, no spaces ("AI 101" → "AI101")."""
    return "".join(text.split()).upper()


def _iso_day(value: str) -> date | None:
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _shown_day(value: str) -> date | None:
    """ "3 Dec 2026" or "3 Dec 2026, 07:00" (base.display_date)."""
    try:
        return datetime.strptime(value.split(",")[0].strip(), "%d %b %Y").date()
    except ValueError:
        return None


class _Collector:
    def __init__(self, skipped: frozenset[str]) -> None:
        self.skipped = skipped
        self.amounts: set[tuple[str, int]] = set()
        self.money_text: set[str] = set()
        self.flight_numbers: set[str] = set()
        self.dates: set[date] = set()
        self.iata_codes: set[str] = set()
        self.names: set[str] = set()

    def walk(self, node: Any, path: str, currency: str | None) -> None:
        if isinstance(node, list):
            for item in node:
                self.walk(item, f"{path}[]", currency)
            return
        if not isinstance(node, dict):
            return
        own = node.get("currency")
        currency = own if isinstance(own, str) else currency
        for key, value in node.items():
            where = f"{path}.{key}" if path else str(key)
            if where in self.skipped:
                continue
            self.field(node, str(key), value, currency)
            if isinstance(value, dict | list):
                self.walk(value, where, currency)

    def field(self, node: dict[str, Any], key: str, value: Any, currency: str | None) -> None:
        if isinstance(value, bool):
            return
        if key.endswith("_minor") and isinstance(value, int):
            prefix = key.removesuffix("_minor")
            given = node.get(f"{prefix}_currency") or node.get("total_currency") or currency
            if isinstance(given, str):
                self.amounts.add((given, value))
        elif not isinstance(value, str):
            if key == "flight_numbers" and isinstance(value, list):
                self.flight_numbers.update(flight_key(n) for n in value if isinstance(n, str))
        elif key.endswith("_formatted"):
            self.money_text.update({value, value.removeprefix(APPROX)})
        elif key.endswith("_display"):
            if (day := _shown_day(value)) is not None:
                self.dates.add(day)
        elif key in _DATE_KEYS or key.endswith("_date"):
            if (day := _iso_day(value)) is not None:
                self.dates.add(day)
        elif key in _CODE_KEYS:
            if _CODE.fullmatch(value):
                self.iata_codes.add(value)
        elif key in _NAME_KEYS:
            self.names.add(value)

    def facts(self) -> GroundFacts:
        return GroundFacts(
            amounts=frozenset(self.amounts),
            money_text=frozenset(self.money_text),
            flight_numbers=frozenset(self.flight_numbers),
            dates=frozenset(self.dates),
            iata_codes=frozenset(self.iata_codes),
            names=frozenset(self.names),
        )


def facts(result: ToolResult) -> GroundFacts:
    """The values one tool result vouches for (see the module docstring)."""
    data = result.data
    if not isinstance(data, dict) or "error" in data:
        return EMPTY
    collector = _Collector(MODEL_AUTHORED_PATHS.get(result.name, frozenset()))
    collector.walk(data, "", None)
    return collector.facts()


def facts_of(results: Iterable[ToolResult]) -> GroundFacts:
    """The union of `facts` over a run's results."""
    found = EMPTY
    for result in results:
        found = found | facts(result)
    return found
