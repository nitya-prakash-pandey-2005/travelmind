import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.reference.models import Airport, Country
from travelmind.reference.search import AirportIndex, AirportRecord

INDEX_TTL_SECONDS = 3600
_index: AirportIndex | None = None
_loaded_at = 0.0


async def get_airport_index(db: AsyncSession) -> AirportIndex:
    """Process-wide index, rebuilt hourly so a nightly re-import shows up without a restart."""
    global _index, _loaded_at
    if _index is None or time.monotonic() - _loaded_at > INDEX_TTL_SECONDS:
        rows = await db.execute(
            select(Airport, Country.name).join(Country, Country.code == Airport.country_code)
        )
        _index = AirportIndex(
            AirportRecord(
                iata_code=airport.iata_code,
                name=airport.name,
                city=airport.city,
                country_code=airport.country_code,
                country_name=country_name,
                airport_type=airport.airport_type,
                scheduled_service=airport.scheduled_service,
                latitude=airport.latitude,
                longitude=airport.longitude,
                keywords=airport.keywords,
            )
            for airport, country_name in rows.all()
        )
        _loaded_at = time.monotonic()
    return _index


def reset_airport_index() -> None:
    global _index, _loaded_at
    _index = None
    _loaded_at = 0.0
