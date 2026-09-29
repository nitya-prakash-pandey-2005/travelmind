import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

from rapidfuzz import fuzz

# Former/common names agents type that don't appear in OurAirports city names.
# Checked before IATA codes because e.g. "GOA" is Genoa's code but an Indian agent means Goa.
CITY_ALIASES: dict[str, tuple[str, ...]] = {
    "goa": ("GOI", "GOX"),
    "bombay": ("BOM",),
    "madras": ("MAA",),
    "calcutta": ("CCU",),
    "bangalore": ("BLR",),
    "bengaluru": ("BLR",),
    "cochin": ("COK",),
    "trivandrum": ("TRV",),
    "poona": ("PNQ",),
    "baroda": ("BDQ",),
    "benares": ("VNS",),
    "banaras": ("VNS",),
    "delhi": ("DEL",),
    "new delhi": ("DEL",),
    "gurgaon": ("DEL",),
    "gurugram": ("DEL",),
    "noida": ("DEL",),
}
TYPE_BOOST = {"large_airport": 15, "medium_airport": 8, "small_airport": 0}
# Tie-break order among equal scores; unlisted types (heliport, seaplane_base, ...) rank last.
TYPE_RANK = {"large_airport": 0, "medium_airport": 1, "small_airport": 2}
# WRatio scales down long names, so "london heathrow" scores LHR no higher than LGW/LTN/STN.
# Rewarding queries whose every word appears whole in the airport's name/city/keywords fixes that.
TOKEN_COVERAGE_BONUS = 20
SCHEDULED_BOOST = 10
MIN_FUZZY_SCORE = 70.0
ALIAS_SCORE = 1100.0
IATA_SCORE = 1000.0


def fold(value: str) -> str:
    """Lowercase, strip accents, and collapse whitespace: '  São PAULO ' -> 'sao paulo'."""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(stripped.lower().split())


def _tokens(folded: str) -> frozenset[str]:
    return frozenset(re.findall(r"[a-z0-9]+", folded))


@dataclass(frozen=True)
class AirportRecord:
    iata_code: str
    name: str
    city: str | None
    country_code: str
    country_name: str
    airport_type: str
    scheduled_service: bool
    latitude: float
    longitude: float
    keywords: str | None


@dataclass(frozen=True)
class AirportHit:
    airport: AirportRecord
    score: float


@dataclass(frozen=True)
class _Folded:
    airport: AirportRecord
    city: str
    name: str
    keywords: str
    aliases: tuple[str, ...]
    name_tokens: frozenset[str]
    all_tokens: frozenset[str]  # name + city + keywords


def _aliases_by_code() -> dict[str, tuple[str, ...]]:
    names: dict[str, list[str]] = {}
    for alias, alias_codes in CITY_ALIASES.items():
        for code in alias_codes:
            names.setdefault(code, []).append(alias)
    return {code: tuple(aliases) for code, aliases in names.items()}


class AirportIndex:
    """In-memory fuzzy index over ~9k airports; fast enough to search on every keystroke."""

    def __init__(self, airports: Iterable[AirportRecord]) -> None:
        aliases = _aliases_by_code()
        self._entries = [self._fold_entry(a, aliases.get(a.iata_code, ())) for a in airports]
        self._by_code = {e.airport.iata_code: e.airport for e in self._entries}

    @staticmethod
    def _fold_entry(airport: AirportRecord, aliases: tuple[str, ...]) -> _Folded:
        city = fold(airport.city or "")
        name = fold(airport.name)
        keywords = fold(airport.keywords or "")
        name_tokens = _tokens(name)
        return _Folded(
            airport,
            city,
            name,
            keywords,
            aliases,
            name_tokens,
            name_tokens | _tokens(city) | _tokens(keywords),
        )

    def get(self, iata_code: str) -> AirportRecord | None:
        return self._by_code.get(iata_code.strip().upper())

    def search(self, query: str, limit: int = 8) -> list[AirportHit]:
        q = fold(query)
        if len(q) < 2:
            return []
        q_tokens = _tokens(q)
        aliases = CITY_ALIASES.get(q, ())
        scored: list[tuple[float, _Folded]] = []
        for entry in self._entries:
            score = self._score(q, q_tokens, entry, aliases)
            if score is not None:
                scored.append((score, entry))
        scored.sort(key=lambda item: self._rank_key(item[0], item[1], q_tokens))
        return [AirportHit(entry.airport, score) for score, entry in scored[:limit]]

    @staticmethod
    def _rank_key(
        score: float, entry: _Folded, q_tokens: frozenset[str]
    ) -> tuple[float, bool, int, bool, str]:
        """Score desc, then scheduled service, type, query-in-name, and finally IATA code."""
        airport = entry.airport
        return (
            -score,
            not airport.scheduled_service,
            TYPE_RANK.get(airport.airport_type, len(TYPE_RANK)),
            # "sao paulo": GRU and CGH are both large; prefer the one named after the city.
            not q_tokens <= entry.name_tokens,
            airport.iata_code,
        )

    @staticmethod
    def _score(
        q: str, q_tokens: frozenset[str], entry: _Folded, aliases: tuple[str, ...]
    ) -> float | None:
        airport = entry.airport
        boost = TYPE_BOOST.get(airport.airport_type, 0) + (
            SCHEDULED_BOOST if airport.scheduled_service else 0
        )
        if airport.iata_code in aliases:
            return ALIAS_SCORE + boost
        if len(q) == 3 and q.upper() == airport.iata_code:
            return IATA_SCORE + boost
        fuzzy = max(
            fuzz.WRatio(q, entry.city) if entry.city else 0.0,
            fuzz.WRatio(q, entry.name),
            fuzz.WRatio(q, entry.keywords) if entry.keywords else 0.0,
            # Typos of alias names ("dehli") should find the aliased airport too.
            *(fuzz.WRatio(q, alias) for alias in entry.aliases),
        )
        if fuzzy < MIN_FUZZY_SCORE:
            return None
        if q_tokens and q_tokens <= entry.all_tokens:
            fuzzy += TOKEN_COVERAGE_BONUS
        return fuzzy + boost
