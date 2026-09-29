from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel

from travelmind.db import DbSession
from travelmind.identity.deps import AuthedUser
from travelmind.reference.search import AirportRecord
from travelmind.reference.service import get_airport_index

reference_router = APIRouter(prefix="/api/v1/reference", tags=["reference"])


class AirportOut(BaseModel):
    iata_code: str
    name: str
    city: str | None
    country_code: str
    country_name: str
    latitude: float
    longitude: float

    @classmethod
    def from_record(cls, record: AirportRecord) -> "AirportOut":
        return cls(
            iata_code=record.iata_code,
            name=record.name,
            city=record.city,
            country_code=record.country_code,
            country_name=record.country_name,
            latitude=record.latitude,
            longitude=record.longitude,
        )


@reference_router.get("/airports")
async def search_airports_route(
    q: Annotated[str, Query(min_length=2, max_length=100)],
    _current: AuthedUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=25)] = 8,
) -> list[AirportOut]:
    index = await get_airport_index(db)
    return [AirportOut.from_record(hit.airport) for hit in index.search(q, limit)]
