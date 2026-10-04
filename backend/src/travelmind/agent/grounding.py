"""The grounding guard: the values in an answer must be values this run's tools returned.

`find_violations(prose, facts, user_facts)` reads four kinds of value from the prose and checks
each against the run's facts (`travelmind.agent.facts`) and the values the user typed:
- money: "₹12,345", "INR 12345", "$1,234.50", "Rs. 500", "12,345 INR", "₹12k", "₹1.5 lakh",
  "13k" (no currency: any currency's amount may match). Amounts compare at whole-unit precision
  in the same currency: the written whole units must equal the result's, truncated or rounded
  half up ("$1,234" and "$1,235" both match $1,234.50). A converted price ("≈ ₹8,331") may be
  written with or without its "≈". "k", "lakh" and "crore" multiply: "₹12k" is ₹12,000 and
  matches only ₹12,000.
- flight numbers: a two-character designator with a letter, then 1-4 digits ("AI 101", "6E2134"),
  compared without the space. The run's own ids (F12, H3, P10) and CO2 are not flight numbers.
- dates: ISO ("2026-12-12"), "12 Dec", "Dec 12", "12 Dec 2026", "12/12" (day first), and ranges
  ("12–16 Dec", "Dec 12-16"). With a year, the calendar day must match; without one, the month
  and day. Lower-case "may" is never a month.
- airport codes: three capitals that `is_airport` knows (the airport index), except currency
  codes. Other capital words ("NOTE", "PDF") are not checked.

Each extractor skips text an earlier one claimed (money first), so "AED 500" is money, not a code.
`stated_facts(texts)` collects the same values from the user's own messages (and relative dates
the demo planner understands, such as "next Friday"): an answer may repeat what the user asked
for ("your ₹2 lakh budget", "12-16 Dec").

The loop re-prompts once with `reprompt_text(violations)`; if the next answer still has
violations, it is replaced by a summary built from the tool data (`agent.plan.fallback_summary`).
"""

import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Literal

from travelmind.agent import planner
from travelmind.agent.facts import EMPTY, GroundFacts, flight_key
from travelmind.offers.money import exponent

ViolationKind = Literal["money", "flight", "date", "code"]

# Common ISO 4217 codes: never read as airport codes, and read as money before a number.
CURRENCIES = frozenset(
    """INR USD EUR GBP AED SAR QAR OMR KWD BHD SGD THB MYR IDR JPY KRW CNY HKD TWD VND PHP AUD NZD
    CAD CHF SEK NOK DKK ZAR TRY EGP LKR NPR BDT MVR MUR KES RUB BRL MXN ILS JOD""".split()
)
SYMBOLS = {"₹": "INR", "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY"}
UNITS = {
    "k": Decimal(1_000),
    "lakh": Decimal(100_000),
    "lakhs": Decimal(100_000),
    "lac": Decimal(100_000),
    "lacs": Decimal(100_000),
    "cr": Decimal(10_000_000),
    "crore": Decimal(10_000_000),
    "crores": Decimal(10_000_000),
    "mn": Decimal(1_000_000),
    "million": Decimal(1_000_000),
}
_UNIT = r"(?:\s?(?P<unit>[kK]|lakhs?|lacs?|cr|crores?|mn|million))?"
_NUM = r"(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
_MONEY_BEFORE = re.compile(
    rf"(?:≈\s*)?(?:(?P<sym>[₹$€£¥])|(?P<rs>\bRs\.?)|\b(?P<code>[A-Z]{{3}}))\s?{_NUM}{_UNIT}"
    r"(?!\w|,\d)"
)
_MONEY_AFTER = re.compile(rf"(?<![\w.,]){_NUM}\s?(?P<code>[A-Z]{{3}})\b")
_MONEY_BARE = re.compile(
    r"(?<![\w.,₹$€£¥])(?P<num>\d+(?:\.\d+)?)\s?(?P<unit>[kK]|lakhs?|lacs?|crores?)\b"
)

_FLIGHT = re.compile(r"(?<![\w-])(?P<carrier>[A-Z][A-Z0-9]|[0-9][A-Z])\s?(?P<num>\d{1,4})(?![\w])")
_RUN_ID = re.compile(r"[FHP]\d+")
NOT_FLIGHTS = frozenset({"CO2"})

_MONTH = (
    r"(?P<{name}>(?i:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)|May)"
)
_ORD = r"(?:st|nd|rd|th)?"
_RANGE_DASH = r"\s*[-–—]\s*"
_YEAR = r"(?:,?\s+(?P<year>\d{4}))?"
_DATE_PATTERNS = (
    re.compile(r"\b(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})\b"),
    re.compile(
        rf"\b(?P<day>\d{{1,2}}){_ORD}{_RANGE_DASH}(?P<day2>\d{{1,2}}){_ORD}\s+(?:of\s+)?"
        rf"{_MONTH.format(name='mname')}\b{_YEAR}"
    ),
    re.compile(
        rf"\b{_MONTH.format(name='mname')}\s+(?P<day>\d{{1,2}}){_ORD}{_RANGE_DASH}"
        rf"(?P<day2>\d{{1,2}}){_ORD}\b{_YEAR}"
    ),
    re.compile(rf"\b(?P<day>\d{{1,2}}){_ORD}\s+(?:of\s+)?{_MONTH.format(name='mname')}\b{_YEAR}"),
    re.compile(rf"\b{_MONTH.format(name='mname')}\s+(?P<day>\d{{1,2}}){_ORD}\b{_YEAR}"),
    re.compile(
        r"(?<![\d/])(?P<day>\d{1,2})/(?P<month>\d{1,2})(?:/(?P<year>\d{4}|\d{2}))?(?![\d/])"
    ),
)
_CODE = re.compile(r"\b[A-Z]{3}\b")


@dataclass(frozen=True)
class Violation:
    kind: ViolationKind
    text: str  # as written in the prose

    def to_json(self) -> dict[str, str]:
        return {"kind": self.kind, "text": self.text}


@dataclass(frozen=True)
class _Amount:
    currency: str | None
    value: Decimal


@dataclass(frozen=True)
class _Day:
    year: int | None
    month: int
    day: int


@dataclass(frozen=True)
class _Mention:
    start: int
    end: int
    kind: ViolationKind
    text: str
    amount: _Amount | None = None
    flight: str | None = None
    days: tuple[_Day, ...] = ()
    code: str | None = None


def _decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None


def _month_number(text: str) -> int:
    return planner.MONTHS[text.lower()]


def _year(text: str | None) -> int | None:
    if not text:
        return None
    number = int(text)
    return number + 2000 if number < 100 else number


def _flight_norm(key: str) -> str:
    """'AI0101' and 'AI101' alike: the designator, then the number without leading zeros."""
    carrier, number = key[:2], key[2:]
    return f"{carrier}{int(number)}" if number.isdigit() else key


class _Scanner:
    """Finds mentions left to right per kind, never inside text an earlier kind claimed."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.taken: list[tuple[int, int]] = []
        self.found: list[_Mention] = []

    def free(self, start: int, end: int) -> bool:
        return all(end <= a or start >= b for a, b in self.taken)

    def add(self, mention: _Mention) -> None:
        self.taken.append((mention.start, mention.end))
        self.found.append(mention)

    def money(self, currencies: frozenset[str]) -> None:
        for match in _MONEY_BEFORE.finditer(self.text):
            code = match.group("code")
            if code is not None and code not in currencies:
                continue
            currency = (
                SYMBOLS[match.group("sym")]
                if match.group("sym")
                else "INR"
                if match.group("rs")
                else code
            )
            self._amount(match, currency)
        for match in _MONEY_AFTER.finditer(self.text):
            if match.group("code") in currencies:
                self._amount(match, match.group("code"))
        for match in _MONEY_BARE.finditer(self.text):
            self._amount(match, None)

    def _amount(self, match: re.Match[str], currency: str | None) -> None:
        if not self.free(match.start(), match.end()):
            return
        value = _decimal(match.group("num"))
        if value is None:
            return
        unit = match.groupdict().get("unit")
        if unit:
            value *= UNITS[unit.lower()]
        text = match.group(0).strip()
        self.add(_Mention(match.start(), match.end(), "money", text, _Amount(currency, value)))

    def flights(self) -> None:
        for match in _FLIGHT.finditer(self.text):
            key = match.group("carrier") + match.group("num")
            if _RUN_ID.fullmatch(key) or key in NOT_FLIGHTS:
                continue
            if self.free(match.start(), match.end()):
                text = match.group(0)
                self.add(_Mention(match.start(), match.end(), "flight", text, flight=key))

    def dates(self) -> None:
        for pattern in _DATE_PATTERNS:
            for match in pattern.finditer(self.text):
                if not self.free(match.start(), match.end()):
                    continue
                groups = match.groupdict()
                month = (
                    _month_number(groups["mname"]) if groups.get("mname") else int(groups["month"])
                )
                year = _year(groups.get("year"))
                days = [int(groups["day"])]
                if groups.get("day2"):
                    days.append(int(groups["day2"]))
                if not 1 <= month <= 12:
                    continue
                mention_days = tuple(_Day(year, month, d) for d in days)
                self.add(
                    _Mention(match.start(), match.end(), "date", match.group(0), days=mention_days)
                )

    def codes(self, is_airport: Callable[[str], bool], currencies: frozenset[str]) -> None:
        for match in _CODE.finditer(self.text):
            code = match.group(0)
            if code in currencies or not self.free(match.start(), match.end()):
                continue
            if is_airport(code):
                self.add(_Mention(match.start(), match.end(), "code", code, code=code))


def _scan(
    text: str,
    *,
    currencies: frozenset[str],
    is_airport: Callable[[str], bool] | None,
) -> list[_Mention]:
    scanner = _Scanner(text)
    scanner.money(currencies)
    scanner.flights()
    scanner.dates()
    if is_airport is not None:
        scanner.codes(is_airport, currencies)
    return sorted(scanner.found, key=lambda m: m.start)


def _whole_units(minor: int, currency: str) -> set[int]:
    value = Decimal(minor) / (Decimal(10) ** exponent(currency))
    return {
        int(value.to_integral_value(rounding=ROUND_FLOOR)),
        int(value.to_integral_value(rounding=ROUND_HALF_UP)),
    }


def _real_day(day: _Day) -> date | None:
    try:
        return date(day.year, day.month, day.day) if day.year is not None else None
    except ValueError:
        return None


class _Known:
    """The facts in the forms mentions are compared in."""

    def __init__(self, facts: GroundFacts) -> None:
        self.units: set[tuple[str, int]] = set()
        for currency, minor in facts.amounts:
            for units in _whole_units(minor, currency):
                self.units.add((currency, units))
        self.any_units = {units for _, units in self.units}
        self.flights = {_flight_norm(flight_key(f)) for f in facts.flight_numbers}
        self.dates = set(facts.dates)
        self.month_days = {(d.month, d.day) for d in facts.dates}
        self.codes = set(facts.iata_codes)

    def has(self, mention: _Mention) -> bool:
        if mention.amount is not None:
            units = int(mention.amount.value)  # whole units, truncated
            if mention.amount.currency is None:
                return units in self.any_units
            return (mention.amount.currency, units) in self.units
        if mention.flight is not None:
            return _flight_norm(mention.flight) in self.flights
        if mention.days:
            return all(self._has_day(day) for day in mention.days)
        if mention.code is not None:
            return mention.code in self.codes
        return True

    def _has_day(self, day: _Day) -> bool:
        if day.year is None:
            return (day.month, day.day) in self.month_days
        real = _real_day(day)
        return real is not None and real in self.dates


def find_violations(
    prose: str,
    facts: GroundFacts,
    user_facts: GroundFacts = EMPTY,
    *,
    is_airport: Callable[[str], bool] | None = None,
) -> list[Violation]:
    """The amounts, flight numbers, dates and airport codes in `prose` that are in neither the
    run's facts nor the user's own words, in the order they appear (see the module docstring).
    Without `is_airport`, codes are not checked."""
    known = _Known(facts | user_facts)
    currencies = CURRENCIES | {c for c, _ in facts.amounts} | {c for c, _ in user_facts.amounts}
    return [
        Violation(m.kind, m.text)
        for m in _scan(prose, currencies=currencies, is_airport=is_airport)
        if not known.has(m)
    ]


def stated_facts(
    texts: Iterable[str], *, today: date | None = None, currency: str | None = None
) -> GroundFacts:
    """The values the user typed: amounts (a bare one, "50k", in `currency`), flight numbers,
    dates (without a year: this year's and next year's; relative ones such as "next Friday" from
    `today`) and capital three-letter codes."""
    amounts: set[tuple[str, int]] = set()
    flights: set[str] = set()
    dates: set[date] = set()
    codes: set[str] = set()
    for raw in texts:
        text = raw[: planner.MAX_MESSAGE_CHARS]
        for mention in _scan(text, currencies=CURRENCIES, is_airport=lambda code: True):
            if mention.amount is not None:
                code = mention.amount.currency or currency
                if code is not None:
                    minor = mention.amount.value * (Decimal(10) ** exponent(code))
                    amounts.add((code, int(minor)))
            elif mention.flight is not None:
                flights.add(mention.flight)
            elif mention.code is not None:
                codes.add(mention.code)
            for day in mention.days:
                years = [day.year] if day.year else ([today.year, today.year + 1] if today else [])
                for year in years:
                    real = _real_day(_Day(year, day.month, day.day))
                    if real is not None:
                        dates.add(real)
        if today is not None:
            depart, back = planner.extract_dates(text, today)
            dates.update(d for d in (depart, back) if d is not None)
    return GroundFacts(
        amounts=frozenset(amounts),
        flight_numbers=frozenset(flights),
        dates=frozenset(dates),
        iata_codes=frozenset(codes),
    )


def reprompt_text(violations: Sequence[Violation]) -> str:
    """The one re-prompt after an answer with ungrounded values."""
    listed = ", ".join(dict.fromkeys(v.text for v in violations))
    return (
        f"These values are not in the tool results: {listed}. Use only values from the results "
        "(or the user's own messages), copied exactly, and answer again in the same format."
    )
