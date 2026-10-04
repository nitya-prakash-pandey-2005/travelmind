import hashlib
from typing import Annotated

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, TypeAdapter
from starlette.concurrency import run_in_threadpool

from travelmind.cache import RedisClient
from travelmind.db import DbSession, release_connection
from travelmind.identity.deps import AuthedUser
from travelmind.readcache import CACHE_PREFIX, as_bytes, cached_json, json_response, schema_tag
from travelmind.reference.search import AirportRecord, fold
from travelmind.reference.service import get_airport_index

reference_router = APIRouter(prefix="/api/v1/reference", tags=["reference"])

# Reference data changes only with an import; results up to an hour old are fine.
AIRPORTS_TTL_SECONDS = 3600


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


_AIRPORTS = TypeAdapter(list[AirportOut])
# Cached as the response body and served as is (readcache: "Serving stored bytes").
AIRPORTS_TAG = schema_tag(list[AirportOut])


@reference_router.get("/airports", response_model=list[AirportOut])
async def search_airports_route(
    q: Annotated[str, Query(min_length=2, max_length=100)],
    _current: AuthedUser,
    db: DbSession,
    redis: RedisClient,
    limit: Annotated[int, Query(ge=1, le=25)] = 8,
) -> Response:
    async def load() -> bytes:
        index = await get_airport_index(db)
        await release_connection(db)  # the (hourly) index load is the only database read
        hits = await run_in_threadpool(index.search, q, limit)  # fuzzy scan is CPU-heavy
        airports = [AirportOut.from_record(hit.airport) for hit in hits]
        return _AIRPORTS.dump_json(airports, by_alias=True)

    # The search folds its query first, so equal folds give equal results; hashed for a short key.
    digest = hashlib.sha256(fold(q).encode()).hexdigest()[:32]
    body = await cached_json(
        redis,
        f"{CACHE_PREFIX}airports:{AIRPORTS_TAG}:{limit}:{digest}",
        AIRPORTS_TTL_SECONDS,
        load,
        encode=as_bytes,
        decode=as_bytes,
        cache="airports",
    )
    return json_response(body)
