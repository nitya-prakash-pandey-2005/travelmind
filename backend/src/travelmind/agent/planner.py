"""The demo planner: a rule-based stand-in for the model, so the agent works without a key.

Extraction is pure: `extract_trip` reads origin, destination, dates, travellers, cabin and scope
(flights, hotels) from plain text with regular expressions. Places stay as written ("Mumbai",
"New York", "DXB"); the planner resolves names through the `lookup_airport` tool, exactly as the
model would, and uses 3-letter codes typed in capitals as they are, except one that reads as a
city ("GOA" is Goa: looked up, which gives GOI).

`plan_turn` derives everything from the conversation, so it holds no state between turns:
1. Merge what every user message said (a reply to a question fills the fields it asked for).
   Only the first MAX_MESSAGE_CHARS characters of each message are read.
2. Anything required still missing: call `ask_user` with the missing fields. Dates that can't be
   right (an explicit date already past, a return before the departure) are asked about too,
   never passed on or moved to another year.
3. Places not yet resolved: call `lookup_airport` for each (an unknown place: ask about it).
4. Searches not yet run: call `search_flights`, `search_hotels` (when a stay is wanted and the
   dates bound it) and `weather_forecast`.
5. Otherwise answer with a short summary written only from the tool results.

The tools themselves (and their result shapes: `matches[].code`, `offers[]`, `hotels[]`,
`days[]`) belong to the tool registry; this module only names the calls.

Every pattern here runs in time linear in its input: no two adjacent quantifiers can match the
same characters (a run of spaces has one way to match), and no unanchored pattern starts with a
repeat (`tests/agent/test_planner.py` times each one on 20 kB adversarial input).
"""

import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, fields, replace
from datetime import date, timedelta
from functools import partial
from typing import Any, Literal

from travelmind.agent.provider import Generation, Message, ToolCall
from travelmind.agent.tools.travel import ambiguous_code
from travelmind.offers.models import Cabin

# The planner reads at most this many characters of each message: a trip request fits in far
# fewer, and the bound keeps the work per turn small whatever a user pastes.
MAX_MESSAGE_CHARS = 2000
# A return date written without a year that falls before the departure in the same year is read
# as next year's ("28 Dec – 3 Jan") only when that makes a stay of at most this many days; for a
# longer one the dates were most likely written the wrong way round ("16 Dec to 12 Dec").
MAX_ROLLOVER_STAY_DAYS = 183

DateIssue = Literal["past", "reversed"]

# --- vocabulary --------------------------------------------------------------------------

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4,
    "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}  # fmt: skip
WEEKDAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thurs": 3, "friday": 4, "fri": 4, "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}  # fmt: skip
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}  # fmt: skip
# Words that end (or never start) a place name: "Plan a trip | Mumbai | to | Dubai | for ...".
STOP_WORDS = (
    frozenset(
        """
    to from in on at for with and or the a an of by via into than as is are be
    plan planning trip trips travel travelling traveling fly flying flight flights go going
    visit visiting book booking need needs want wants would like i we me us my our you your
    please find search show get quote return returning round one way cheap cheapest
    holiday holidays vacation family honeymoon business economy premium first class cabin
    hotel hotels stay staying room rooms mid-range midrange luxury budget resort
    adult adults kid kids child children infant infants people pax person persons
    passengers travellers travelers guests couple solo
    next this coming tomorrow today tonight weekend week weeks night nights day days
    between until till departing leaving depart back then also only just around about
    early late mid out
    """.split()
    )
    | MONTHS.keys()
    | WEEKDAYS.keys()
)

_MONTH = (
    r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_WEEKDAY = r"(" + "|".join(sorted(WEEKDAYS, key=len, reverse=True)) + r")"
_ORD = r"(?:st|nd|rd|th)?"
_DASH = r"\s*(?:-|–|—|to|till|until|through)\s*"
_YEAR = r"(?:,?\s+(\d{4}))?"
_NUM = r"(\d{1,2}|" + "|".join(NUMBER_WORDS) + r")"
_I = re.IGNORECASE

_RANGE_DAY_FIRST = re.compile(
    rf"\b(\d{{1,2}}){_ORD}{_DASH}(\d{{1,2}}){_ORD}\s+(?:of\s+)?{_MONTH}\b{_YEAR}", _I
)
_RANGE_MONTH_FIRST = re.compile(
    rf"\b{_MONTH}\s+(\d{{1,2}}){_ORD}{_DASH}(\d{{1,2}}){_ORD}\b{_YEAR}", _I
)
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DAY_MONTH = re.compile(rf"\b(\d{{1,2}}){_ORD}\s+(?:of\s+)?{_MONTH}\b{_YEAR}", _I)
_MONTH_DAY = re.compile(rf"\b{_MONTH}\s+(\d{{1,2}}){_ORD}\b{_YEAR}", _I)
# "12/10", "12/10/2026", "12.10.2026": dots only with a year, so "4.5 star" and "1.5 lakh" are
# not dates.
_NUMERIC = re.compile(r"\b(\d{1,2})(?:/(\d{1,2})(?:/(\d{4}|\d{2}))?|\.(\d{1,2})\.(\d{4}|\d{2}))\b")
_RELATIVE = re.compile(r"\b(day after tomorrow|tomorrow|today)\b", _I)
_WEEKDAY_REF = re.compile(rf"\b(?:next|this|coming|on)\s+{_WEEKDAY}\b", _I)
_NIGHTS = re.compile(rf"\b{_NUM}\s+nights?\b", _I)
_WEEKS = re.compile(rf"\b(a|{_NUM[1:-1]})\s+weeks?\b", _I)

_ADULTS = re.compile(rf"\b{_NUM}\s+(?:adults?|grown[- ]?ups?)\b", _I)
_CHILDREN = re.compile(rf"\b{_NUM}\s+(?:children|child|kids?|infants?|babies|baby)\b", _I)
_A_CHILD = re.compile(r"\ban?\s+(?:child|kid|baby|infant)\b", _I)
_AGES = re.compile(r"\bag(?:e|es|ed)\s+(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)", _I)
# "4 year old", "4-year-old", "4 - years - old": spaces, or one dash, between the words.
_GAP = r"(?:\s+|\s*-\s*)?"
_YEAR_OLD = re.compile(rf"\b(\d{{1,2}}){_GAP}(?:years?|yrs?){_GAP}old\b", _I)
_GROUP = re.compile(rf"\b{_NUM}\s+(?:people|persons|pax|passengers|travell?ers|guests)\b", _I)
_FAMILY = re.compile(rf"\bfamily\s+of\s+{_NUM}\b", _I)
_COUPLE = re.compile(r"\bcouple\b", _I)
_SOLO = re.compile(r"\b(?:solo|alone|by myself|just me)\b", _I)

_FLIGHTS_ONLY = re.compile(
    r"\bflights?\s+only\b|\bonly\s+(?:the\s+)?flights?\b|\bjust\s+(?:the\s+)?flights?\b"
    r"|\bno\s+hotels?\b|\bwithout\s+(?:a\s+)?hotels?\b",
    _I,
)
_HOTEL_ONLY = re.compile(
    r"\bhotels?\s+only\b|\bonly\s+(?:an?\s+)?hotels?\b|\bjust\s+(?:an?\s+)?hotels?\b"
    r"|\bno\s+flights?\b|\bwithout\s+flights?\b",
    _I,
)
_HOTEL_WORDS = re.compile(r"\b(?:hotels?|stay|accommodation|rooms?|resort)\b", _I)
_CABINS: tuple[tuple[re.Pattern[str], Cabin], ...] = (
    (re.compile(r"\bpremium(?:[ -]economy)?\b", _I), "premium_economy"),
    (re.compile(r"\bbusiness(?:[ -]class)?\b", _I), "business"),
    (re.compile(r"\bfirst[ -]class\b", _I), "first"),
    (re.compile(r"\beconomy\b", _I), "economy"),
)

_CODE_PAIR = re.compile(r"\b([A-Z]{3})\s*[-–/]\s*([A-Z]{3})\b")
_ARROWS = re.compile(r"→|⟶|->|–>|=>")  # the arrow alone: tokens skip the spaces around it
_TOKEN = re.compile(r"[^\W\d_](?:[\w'-]*[^\W_])?|\d+|[^\w\s]")
_CODE = re.compile(r"[A-Z]{3}")
MAX_PLACE_WORDS = 3


def _number(token: str) -> int:
    return int(token) if token.isdigit() else NUMBER_WORDS[token.lower()]


# --- extraction --------------------------------------------------------------------------


def _is_place_word(token: str) -> bool:
    return token[0].isalpha() and token.lower() not in STOP_WORDS


# Both look at no more than MAX_PLACE_WORDS tokens (never a copy of the rest of the text: a
# message of many "to"s would otherwise cost time quadratic in its length).
def _forward(tokens: list[str], start: int) -> str | None:
    words: list[str] = []
    for token in tokens[start : start + MAX_PLACE_WORDS]:
        if not _is_place_word(token):
            break
        words.append(token)
    return " ".join(words) or None


def _backward(tokens: list[str], end: int) -> str | None:
    words: list[str] = []
    for token in reversed(tokens[max(0, end + 1 - MAX_PLACE_WORDS) : end + 1]):
        if not _is_place_word(token):
            break
        words.insert(0, token)
    return " ".join(words) or None


def extract_route(text: str) -> tuple[str | None, str | None]:
    """(origin, destination) as written: "from X", "X to Y", "X → Y", "DEL-DXB"; a stay "in X"
    when no destination is named with "to"."""
    pair = _CODE_PAIR.search(text)
    if pair:
        return pair.group(1), pair.group(2)
    tokens = _TOKEN.findall(_ARROWS.sub(" to ", text))
    lowered = [t.lower() for t in tokens]
    origin = destination = None
    for i, word in enumerate(lowered):
        if word == "to" and (place := _forward(tokens, i + 1)):
            destination = place
            origin = _backward(tokens, i - 1)
            break
    for i, word in enumerate(lowered):
        if word == "from" and (place := _forward(tokens, i + 1)):
            origin = place
            break
    if destination is None:
        for i, word in enumerate(lowered):
            if word == "in" and (place := _forward(tokens, i + 1)):
                destination = place
                break
    return origin, destination


def _resolve(day: int, month: int, year: int | None, anchor: date) -> date | None:
    """The date, or with no year its next occurrence on or after `anchor`."""
    years = [year] if year is not None else [anchor.year, anchor.year + 1]
    for candidate_year in years:
        try:
            found = date(candidate_year, month, day)
        except ValueError:
            continue
        if year is not None or found >= anchor:
            return found
    return None


def _year(value: str | None) -> int | None:
    if not value:
        return None
    number = int(value)
    return number + 2000 if number < 100 else number


def _month(value: str) -> int:
    return MONTHS[value.lower()]


Resolver = Callable[[date], date | None]


def _ranges(text: str, today: date) -> tuple[date, Resolver] | None:
    """A one-month range ("12-16 Dec", "Dec 12-16"): its departure, and its return's resolver."""
    for pattern, day_first in ((_RANGE_DAY_FIRST, True), (_RANGE_MONTH_FIRST, False)):
        match = pattern.search(text)
        if match is None:
            continue
        if day_first:
            first, second, month, year = match.groups()
        else:
            month, first, second, year = match.groups()
        depart = _resolve(int(first), _month(month), _year(year), today)
        if depart is None:
            continue
        return depart, partial(_resolve, int(second), _month(month), _year(year))
    return None


def _fixed(value: date, anchor: date) -> date:
    return value


def _mentions(text: str, today: date) -> list[tuple[int, int, Resolver]]:
    """Single date mentions as (start, end, resolver), where resolver(anchor) gives the date."""
    found: list[tuple[int, int, Resolver]] = []

    def add(match: re.Match[str], resolver: Resolver) -> None:
        found.append((match.start(), match.end(), resolver))

    for m in _ISO.finditer(text):
        add(m, partial(_resolve, int(m.group(3)), int(m.group(2)), int(m.group(1))))
    for m in _DAY_MONTH.finditer(text):
        add(m, partial(_resolve, int(m.group(1)), _month(m.group(2)), _year(m.group(3))))
    for m in _MONTH_DAY.finditer(text):
        add(m, partial(_resolve, int(m.group(2)), _month(m.group(1)), _year(m.group(3))))
    for m in _NUMERIC.finditer(text):
        month, year = (m.group(2), m.group(3)) if m.group(2) else (m.group(4), m.group(5))
        if 1 <= int(month) <= 12:  # day first, as written in India and the UK
            add(m, partial(_resolve, int(m.group(1)), int(month), _year(year)))
    for m in _RELATIVE.finditer(text):
        offset = {"today": 0, "tomorrow": 1, "day after tomorrow": 2}[m.group(1).lower()]
        add(m, partial(_fixed, today + timedelta(days=offset)))
    for m in _WEEKDAY_REF.finditer(text):
        ahead = (WEEKDAYS[m.group(1).lower()] - today.weekday()) % 7 or 7
        add(m, partial(_fixed, today + timedelta(days=ahead)))
    found.sort(key=lambda item: (item[0], -item[1]))
    kept: list[tuple[int, int, Resolver]] = []
    for item in found:
        if not kept or item[0] >= kept[-1][1]:
            kept.append(item)
    return kept


def _stay_nights(text: str) -> int | None:
    if match := _NIGHTS.search(text):
        return _number(match.group(1))
    if match := _WEEKS.search(text):
        word = match.group(1)
        return 7 * (1 if word.lower() == "a" else _number(word))
    return None


def _depart_and_return(text: str, today: date) -> tuple[date | None, Resolver | None]:
    """The departure, and the resolver of the return date (None when the text gives none)."""
    if found := _ranges(text, today):
        return found
    depart: date | None = None
    for _, _, resolver in _mentions(text, today):
        if depart is None:
            depart = resolver(today)
        elif resolver(depart) is not None:
            return depart, resolver
    return depart, None


def read_dates(text: str, today: date) -> tuple[date | None, date | None, DateIssue | None]:
    """(depart, return, issue). Ranges ("12–16 Dec", "Dec 12-16"), single dates (ISO, "12 Dec",
    "Dec 12", "12/12", "tomorrow", "next Friday") in order, and "for N nights" / "a week".

    Dates without a year are the next occurrence; a return date without a year is the next one
    on or after the departure, crossing a year end only for a stay of at most
    MAX_ROLLOVER_STAY_DAYS. Dates that can't be meant as written come back as an issue, with no
    dates: "past" (an explicit date before today) or "reversed" (a return before the departure,
    as in "16 Dec to 12 Dec", which is not read as next year's 12 Dec)."""
    depart, resolver = _depart_and_return(text, today)
    back = resolver(depart) if depart is not None and resolver is not None else None
    if depart is not None and back is None and (nights := _stay_nights(text)):
        back = depart + timedelta(days=nights)
    if depart is not None and depart < today:
        return None, None, "past"
    if depart is not None and back is not None and resolver is not None:
        as_written = resolver(date(depart.year, 1, 1))  # in the departure's year, if no year
        rolled = as_written is not None and as_written < depart
        if back < depart or (rolled and (back - depart).days > MAX_ROLLOVER_STAY_DAYS):
            return None, None, "reversed"
    return depart, back, None


def extract_dates(text: str, today: date) -> tuple[date | None, date | None]:
    """(depart, return) as `read_dates` reads them; neither when they have an issue."""
    depart, back, _ = read_dates(text, today)
    return depart, back


def extract_travellers(text: str) -> tuple[int | None, int, tuple[int, ...]]:
    """(adults, children, children's ages). Adults is None when the text doesn't say."""
    adults = _number(m.group(1)) if (m := _ADULTS.search(text)) else None
    children = _number(m.group(1)) if (m := _CHILDREN.search(text)) else 0
    if not children and _A_CHILD.search(text):
        children = 1
    ages: list[int] = []
    for m in _AGES.finditer(text):
        ages += [int(n) for n in re.findall(r"\d{1,2}", m.group(1))]
    if not ages:
        ages = [int(m.group(1)) for m in _YEAR_OLD.finditer(text)]
    ages = [age for age in ages if 0 <= age <= 17]
    children = max(children, len(ages))
    if adults is None and (m := _GROUP.search(text)):
        total = _number(m.group(1))
        adults = total - children if total > children else None
    if adults is None and children and (m := _FAMILY.search(text)):
        total = _number(m.group(1))
        adults = total - children if total > children else None
    if adults is None and _COUPLE.search(text):
        adults = 2
    if adults is None and _SOLO.search(text):
        adults = 1
    return adults, children, tuple(ages)


def extract_cabin(text: str) -> Cabin | None:
    for pattern, cabin in _CABINS:
        if pattern.search(text):
            return cabin
    return None


def extract_scope(text: str) -> tuple[bool, bool]:
    """(flights wanted, hotels wanted): both unless the text limits it to one."""
    hotel_only = bool(_HOTEL_ONLY.search(text))
    flights_only = bool(_FLIGHTS_ONLY.search(text))
    if hotel_only and not flights_only:
        return False, True
    if flights_only and not hotel_only:
        return True, False
    return True, True


@dataclass(frozen=True)
class TripRequest:
    origin: str | None = None  # a place or code, as written
    destination: str | None = None
    depart_date: date | None = None
    return_date: date | None = None
    adults: int | None = None
    children: int = 0
    children_ages: tuple[int, ...] = ()
    cabin: Cabin | None = None
    flights: bool = True
    hotels: bool = True
    hotel_mentioned: bool = False
    date_issue: DateIssue | None = None  # dates were given but can't be right: ask again

    def merged(self, later: "TripRequest") -> "TripRequest":
        """This request updated by what a later message said (unsaid fields keep their value).
        Dates with an issue replace the earlier dates (they are asked for again); good new dates
        clear an earlier issue."""
        values: dict[str, Any] = {}
        for item in fields(self):
            mine, theirs = getattr(self, item.name), getattr(later, item.name)
            if item.name in ("flights", "hotels"):
                values[item.name] = mine and theirs
            elif item.name == "hotel_mentioned":
                values[item.name] = mine or theirs
            else:
                values[item.name] = theirs if theirs not in (None, 0, ()) else mine
        values["children"] = max(values["children"], len(values["children_ages"]))
        if later.date_issue is not None:
            values.update(depart_date=None, return_date=None)
        elif later.depart_date is not None or later.return_date is not None:
            values["date_issue"] = None
        return TripRequest(**values)


def extract_trip(text: str, today: date) -> TripRequest:
    origin, destination = extract_route(text)
    depart, back, issue = read_dates(text, today)
    adults, children, ages = extract_travellers(text)
    flights, hotels = extract_scope(text)
    return TripRequest(
        origin=origin,
        destination=destination,
        depart_date=depart,
        return_date=back,
        adults=adults,
        children=children,
        children_ages=ages,
        cabin=extract_cabin(text),
        flights=flights,
        hotels=hotels,
        hotel_mentioned=bool(_HOTEL_WORDS.search(text)),
        date_issue=issue,
    )


def _wants_stay(trip: TripRequest) -> bool:
    return trip.hotels and (trip.hotel_mentioned or not trip.flights)


def missing_fields(trip: TripRequest) -> list[str]:
    """What the planner must ask for before it can search, in asking order."""
    missing = []
    if trip.flights and not trip.origin:
        missing.append("origin")
    if not trip.destination:
        missing.append("destination")
    if trip.depart_date is None:
        missing.append("depart_date")
    elif trip.return_date is None and _wants_stay(trip):
        missing.append("return_date")
    if trip.adults is None:
        missing.append("adults")
    if trip.children > len(trip.children_ages):
        missing.append("children_ages")
    return missing


# --- the conversation --------------------------------------------------------------------

_ASK_PHRASES = {
    "origin": "where you're travelling from",
    "destination": "where you're going",
    "depart_date": "your travel dates",
    "return_date": "your return or check-out date",
    "adults": "how many adults are travelling",
    "children_ages": "the children's ages",
}


_ISSUE_PHRASES: dict[DateIssue, str] = {
    "past": "Those dates have already passed.",
    "reversed": "The return date is before the departure.",
}


def _ask_question(missing: Sequence[str], issue: DateIssue | None = None) -> str:
    phrases = [_ASK_PHRASES[name] for name in missing]
    listed = phrases[0] if len(phrases) == 1 else ", ".join(phrases[:-1]) + " and " + phrases[-1]
    question = f"To plan this, tell me {listed}."
    return f"{_ISSUE_PHRASES[issue]} {question}" if issue else question


def _bare_place(text: str) -> str | None:
    tokens = _TOKEN.findall(text)
    words = [t for t in tokens if t[0].isalpha() and t.lower() not in STOP_WORDS]
    if not words or len(words) > MAX_PLACE_WORDS or any(t.isdigit() for t in tokens):
        return None
    return " ".join(words)


def _reply(trip: TripRequest, text: str, asked: Sequence[str], today: date) -> TripRequest:
    """Merge a reply to an ask_user question: a bare answer fills the field asked for."""
    later = extract_trip(text, today)
    places = [name for name in asked if name in ("origin", "destination")]
    if len(places) == 1 and later.origin is None and later.destination is None:
        if place := _bare_place(text):
            if places[0] == "origin":
                later = replace(later, origin=place)
            else:
                later = replace(later, destination=place)
    if "return_date" in asked and "depart_date" not in asked:
        if later.depart_date is not None and later.return_date is None:
            later = replace(later, depart_date=None, return_date=later.depart_date)
    numbers = [int(n) for n in re.findall(r"\b\d{1,2}\b", text)]
    if asked == ["adults"] and later.adults is None and len(numbers) == 1:
        later = replace(later, adults=numbers[0])
    if "children_ages" in asked and not later.children_ages and "adults" not in asked:
        later = replace(later, children_ages=tuple(n for n in numbers if n <= 17))
    return trip.merged(later)


def _conversation_trip(messages: Sequence[Message], today: date) -> TripRequest:
    trip: TripRequest | None = None
    asked: list[str] = []
    for message in messages:
        if message.role == "model":
            for call in message.calls:
                if call.name == "ask_user":
                    asked = list(call.args.get("fields") or [])
        elif message.role == "user" and message.text:
            text = message.text[:MAX_MESSAGE_CHARS]
            if trip is None:
                trip = extract_trip(text, today)
            else:
                trip = _reply(trip, text, asked, today)
            asked = []
    trip = trip or TripRequest()
    if trip.depart_date and trip.return_date and trip.return_date < trip.depart_date:
        # e.g. a return date given in a reply, before the departure given earlier
        trip = replace(trip, depart_date=None, return_date=None, date_issue="reversed")
    return trip


def _results(messages: Sequence[Message]) -> list[tuple[ToolCall, dict[str, Any] | None]]:
    """Every call the conversation made, with its result data (None until it has one)."""
    data = {r.call_id: r.data for m in messages for r in m.results}
    return [(c, data.get(c.id)) for m in messages if m.role == "model" for c in m.calls]


def _codes_found(data: dict[str, Any]) -> list[str]:
    matches = data.get("matches") or data.get("airports") or []
    return [str(code) for m in matches if (code := m.get("code") or m.get("iata_code"))]


def _search_calls(trip: TripRequest, codes: dict[str, str]) -> list[tuple[str, dict[str, Any]]]:
    assert trip.depart_date is not None and trip.adults is not None
    start = trip.depart_date.isoformat()
    end = (trip.return_date or trip.depart_date).isoformat()
    destination = codes["destination"]
    calls: list[tuple[str, dict[str, Any]]] = []
    if trip.flights:
        flights: dict[str, Any] = {
            "origin": codes["origin"],
            "destination": destination,
            "depart_date": start,
        }
        if trip.return_date is not None:
            flights["return_date"] = end
        flights["adults"] = trip.adults
        if trip.children_ages:
            flights["children_ages"] = list(trip.children_ages)
        flights["cabin"] = trip.cabin or "economy"
        calls.append(("search_flights", flights))
    if _wants_stay(trip) and trip.return_date is not None:
        calls.append(
            (
                "search_hotels",
                {
                    "destination": destination,
                    "check_in": start,
                    "check_out": end,
                    "adults": trip.adults,
                    "rooms": max(1, math.ceil(trip.adults / 2)),
                },
            )
        )
    calls.append(
        ("weather_forecast", {"place_or_airport": destination, "start": start, "end": end})
    )
    return calls


def _travellers(trip: TripRequest) -> str:
    adults = f"{trip.adults} adult{'s' if trip.adults != 1 else ''}"
    if not trip.children:
        return adults
    return f"{adults} and {trip.children} {'child' if trip.children == 1 else 'children'}"


def _summary(
    trip: TripRequest, codes: dict[str, str], results: dict[str, dict[str, Any] | None]
) -> str:
    """A short answer written only from the tool results (and the trip the user gave)."""
    assert trip.depart_date is not None
    dates = trip.depart_date.isoformat()
    if trip.return_date is not None:
        dates += f" to {trip.return_date.isoformat()}"
    where = (
        f"{codes['origin']} → {codes['destination']}"
        if trip.flights
        else f"a stay in {codes['destination']}"
    )
    lines = [f"Plan for {where}, {dates}, for {_travellers(trip)}."]
    if "search_flights" in results:
        offers = (results["search_flights"] or {}).get("offers") or []
        if offers:
            first = offers[0]
            numbers = ", ".join(first.get("flight_numbers") or [])
            price = first.get("total_formatted")
            line = f"Flights: {len(offers)} options"
            if numbers and price:
                line += f"; the first is {numbers} at {price} in total"
            lines.append(line + ".")
        else:
            lines.append("Flights: no options came back for these dates.")
    if "search_hotels" in results:
        hotels = (results["search_hotels"] or {}).get("hotels") or []
        if hotels:
            first = hotels[0]
            line = f"Hotels: {len(hotels)} options"
            if first.get("name") and first.get("total_formatted"):
                line += f"; {first['name']} is {first['total_formatted']} for the stay"
            lines.append(line + ".")
        else:
            lines.append("Hotels: no rooms came back for these dates.")
    weather = results.get("weather_forecast") or {}
    if days := weather.get("days") or []:
        label = weather.get("label") or "forecast"
        lines.append(f"Weather: {len(days)} days of {label} conditions are on the board.")
    lines.append("Pick a flight and a hotel to turn this into a quote.")
    return " ".join(lines)


def plan_turn(messages: Sequence[Message], today: date) -> Generation:
    """The demo planner's next turn for this conversation (see the module docstring)."""
    turn = 1 + sum(1 for m in messages if m.role == "model")

    def calls(*wanted: tuple[str, dict[str, Any]]) -> Generation:
        made = tuple(
            ToolCall(id=f"plan-{turn}-{i}", name=name, args=args)
            for i, (name, args) in enumerate(wanted, start=1)
        )
        return Generation(text=None, calls=made, input_tokens=0, output_tokens=0)

    def ask(question: str, missing: list[str]) -> Generation:
        return calls(("ask_user", {"question": question, "fields": missing}))

    trip = _conversation_trip(messages, today)
    if missing := missing_fields(trip):
        issue = trip.date_issue if "depart_date" in missing else None
        return ask(_ask_question(missing, issue), missing)

    history = _results(messages)
    codes: dict[str, str] = {}
    lookups: list[str] = []
    for name in ("origin", "destination") if trip.flights else ("destination",):
        place = getattr(trip, name)
        if _CODE.fullmatch(place) and ambiguous_code(place) is None:  # "GOA" is looked up
            codes[name] = place
            continue
        found = [
            data
            for call, data in history
            if call.name == "lookup_airport"
            and str(call.args.get("query", "")).casefold() == place.casefold()
            and data is not None
        ]
        if not found:
            if place not in lookups:
                lookups.append(place)
        elif matches := _codes_found(found[-1]):
            codes[name] = matches[0]
        else:
            question = f'I couldn\'t find an airport for "{place}". Which city or airport code?'
            return ask(question, [name])
    if lookups:
        return calls(*(("lookup_airport", {"query": place}) for place in lookups))

    wanted = _search_calls(trip, codes)
    done: dict[str, dict[str, Any] | None] = {}
    pending = []
    for name, args in wanted:
        made = [data for call, data in history if call.name == name and call.args == args]
        if made:
            done[name] = made[-1]
        else:
            pending.append((name, args))
    if pending:
        return calls(*pending)
    return Generation(text=_summary(trip, codes, done), calls=(), input_tokens=0, output_tokens=0)
