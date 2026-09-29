import csv
import io
from collections.abc import Iterator, Sequence
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from travelmind.reference.models import Airport, Country

# Airports without these types (closed, heliport, seaplane_base, balloonport) are ignored.
AIRPORT_TYPE_RANK = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}
_BATCH_SIZE = 1000


@dataclass(frozen=True)
class CountryRow:
    code: str
    name: str
    continent: str | None


@dataclass(frozen=True)
class AirportRow:
    iata_code: str
    ident: str
    name: str
    city: str | None
    country_code: str
    airport_type: str
    scheduled_service: bool
    latitude: float
    longitude: float
    keywords: str | None


@dataclass(frozen=True)
class ImportResult:
    countries: int
    airports: int


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def parse_countries(csv_text: str) -> list[CountryRow]:
    # csv (not pandas) on purpose: pandas would read Namibia's code "NA" as a missing value.
    rows = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        code = (row.get("code") or "").strip().upper()
        name = _clean(row.get("name"))
        if len(code) == 2 and name:
            rows.append(CountryRow(code=code, name=name, continent=_clean(row.get("continent"))))
    return rows


def _rank(airport: AirportRow) -> tuple[bool, int]:
    return airport.scheduled_service, AIRPORT_TYPE_RANK[airport.airport_type]


def parse_airports(csv_text: str) -> list[AirportRow]:
    best: dict[str, AirportRow] = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        iata = (row.get("iata_code") or "").strip().upper()
        airport_type = (row.get("type") or "").strip()
        if len(iata) != 3 or not iata.isalpha() or airport_type not in AIRPORT_TYPE_RANK:
            continue
        try:
            latitude = float(row["latitude_deg"])
            longitude = float(row["longitude_deg"])
        except (KeyError, TypeError, ValueError):
            continue
        candidate = AirportRow(
            iata_code=iata,
            ident=(row.get("ident") or "").strip(),
            name=_clean(row.get("name")) or iata,
            city=_clean(row.get("municipality")),
            country_code=(row.get("iso_country") or "").strip().upper(),
            airport_type=airport_type,
            scheduled_service=(row.get("scheduled_service") or "").strip().lower() == "yes",
            latitude=latitude,
            longitude=longitude,
            keywords=_clean(row.get("keywords")),
        )
        current = best.get(iata)
        if current is None or _rank(candidate) > _rank(current):
            best[iata] = candidate
    return sorted(best.values(), key=lambda a: a.iata_code)


def _batches(items: list[dict[str, Any]]) -> Iterator[list[dict[str, Any]]]:
    for start in range(0, len(items), _BATCH_SIZE):
        yield items[start : start + _BATCH_SIZE]


async def load_reference_data(
    engine: AsyncEngine, countries: Sequence[CountryRow], airports: Sequence[AirportRow]
) -> ImportResult:
    """Upsert countries and airports; remove airports that disappeared from the source."""
    country_codes = {c.code for c in countries}
    kept = [a for a in airports if a.country_code in country_codes]
    if not kept:
        raise ValueError("No airports parsed; refusing to wipe existing reference data.")

    async with engine.begin() as conn:
        for batch in _batches([asdict(c) for c in countries]):
            stmt = pg_insert(Country).values(batch)
            await conn.execute(
                stmt.on_conflict_do_update(
                    index_elements=[Country.code],
                    set_={"name": stmt.excluded.name, "continent": stmt.excluded.continent},
                )
            )
        airport_rows = [asdict(a) for a in kept]
        update_columns = [c for c in airport_rows[0] if c != "iata_code"]
        for batch in _batches(airport_rows):
            stmt = pg_insert(Airport).values(batch)
            await conn.execute(
                stmt.on_conflict_do_update(
                    index_elements=[Airport.iata_code],
                    set_={
                        **{c: stmt.excluded[c] for c in update_columns},
                        "updated_at": func.now(),
                    },
                )
            )
        await conn.execute(
            text("DELETE FROM airports WHERE NOT (iata_code = ANY(:codes))"),
            {"codes": [a.iata_code for a in kept]},
        )
    return ImportResult(countries=len(countries), airports=len(kept))
