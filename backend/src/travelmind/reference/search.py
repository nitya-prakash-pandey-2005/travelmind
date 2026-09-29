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
SCHEDULED_BOOST = 10
MIN_FUZZY_SCORE = 70.0
ALIAS_SCORE = 1100.0
IATA_SCORE = 1000.0


def fold(value: str) -> str:
    """Lowercase, strip accents, and collapse whitespace: '  São PAULO ' -> 'sao paulo'."""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(stripped.lower().split())


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
        self._entries = [
            _Folded(
                a,
                fold(a.city or ""),
                fold(a.name),
                fold(a.keywords or ""),
                aliases.get(a.iata_code, ()),
            )
            for a in airports
        ]
        self._by_code = {e.airport.iata_code: e.airport for e in self._entries}

    def get(self, iata_code: str) -> AirportRecord | None:
        return self._by_code.get(iata_code.strip().upper())

    def search(self, query: str, limit: int = 8) -> list[AirportHit]:
        q = fold(query)
        if len(q) < 2:
            return []
        aliases = CITY_ALIASES.get(q, ())
        hits = []
        for entry in self._entries:
            score = self._score(q, entry, aliases)
            if score is not None:
                hits.append(AirportHit(entry.airport, score))
        hits.sort(key=lambda h: (-h.score, h.airport.iata_code))
        return hits[:limit]

    @staticmethod
    def _score(q: str, entry: _Folded, aliases: tuple[str, ...]) -> float | None:
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
        return fuzzy + boost
