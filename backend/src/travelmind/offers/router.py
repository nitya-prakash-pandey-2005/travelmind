from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.identity.deps import AuthedUser
from travelmind.offers import service
from travelmind.offers.models import FlightSearchRequest
from travelmind.offers.registry import supplier_statuses
from travelmind.offers.schemas import FlightSearchResponse, RepriceResponse, SupplierStatusOut

# Searching and repricing don't retire the agency's read cache: a search feeds only the Command
# Center's searches KPI and activity, which may lag by up to the dashboard TTL (readcache).
flights_router = APIRouter(prefix="/api/v1/flights", tags=["flights"])
suppliers_router = APIRouter(prefix="/api/v1/suppliers", tags=["suppliers"])

_STATUS: dict[type[service.OfferServiceError], int] = {
    service.RateLimited: status.HTTP_429_TOO_MANY_REQUESTS,
    service.UnknownAirport: status.HTTP_422_UNPROCESSABLE_CONTENT,
    service.NoSuppliers: status.HTTP_503_SERVICE_UNAVAILABLE,
    service.OfferNotFound: status.HTTP_404_NOT_FOUND,
    service.SupplierGone: status.HTTP_409_CONFLICT,
    service.OfferGone: status.HTTP_410_GONE,
    service.PriceCheckFailed: status.HTTP_502_BAD_GATEWAY,
}


def _http_error(exc: service.OfferServiceError) -> HTTPException:
    return HTTPException(_STATUS.get(type(exc), status.HTTP_502_BAD_GATEWAY), exc.message)


@flights_router.post("/search")
async def search_flights_route(
    body: FlightSearchRequest, current: AuthedUser, db: DbSession, redis: RedisClient
) -> FlightSearchResponse:
    try:
        return await service.search_flights(
            db, redis, get_settings(), body, agency_id=current.agency_id, user_id=current.id
        )
    except service.OfferServiceError as exc:
        raise _http_error(exc) from None


@flights_router.post("/offers/{offer_id}/price")
async def reprice_offer_route(
    offer_id: Annotated[str, Path(max_length=1000)],
    current: AuthedUser,
    db: DbSession,
    redis: RedisClient,
) -> RepriceResponse:
    try:
        return await service.reprice_offer(
            db, redis, get_settings(), offer_id, agency_id=current.agency_id, user_id=current.id
        )
    except service.OfferServiceError as exc:
        raise _http_error(exc) from None


@suppliers_router.get("")
async def list_suppliers_route(_current: AuthedUser) -> list[SupplierStatusOut]:
    return supplier_statuses(get_settings())
