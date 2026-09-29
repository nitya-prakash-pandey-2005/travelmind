from fastapi import APIRouter, HTTPException, status

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.hotels import service
from travelmind.hotels.models import HotelSearchRequest
from travelmind.hotels.schemas import HotelSearchResponse
from travelmind.identity.deps import AuthedUser

hotels_router = APIRouter(prefix="/api/v1/hotels", tags=["hotels"])


@hotels_router.post("/search")
async def search_hotels_route(
    body: HotelSearchRequest, _current: AuthedUser, db: DbSession, redis: RedisClient
) -> HotelSearchResponse:
    try:
        return await service.search_hotels(db, redis, get_settings(), body)
    except service.UnknownAirport as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.message) from None
