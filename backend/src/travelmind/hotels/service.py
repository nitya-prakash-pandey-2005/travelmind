"""Hotel search, callable from the HTTP API or directly (e.g. by the copilot).

Supplier problems never fail the search: they come back as the source's status. The only
exceptions are RateLimited (429) and UnknownAirport (a bad destination, 422).
"""

import asyncio
import time
from uuid import UUID

import structlog
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.config import Settings
from travelmind.hotels.liteapi import LiteApiHotelSupplier
from travelmind.hotels.models import HotelOffer, HotelSearchRequest
from travelmind.hotels.schemas import HotelOfferView, HotelSearchResponse
from travelmind.offers.display import display_money, rank_by_display
from travelmind.offers.fx import display_currency_for, get_fx_rates
from travelmind.offers.money import Money
from travelmind.offers.schemas import SourceStatusOut
from travelmind.offers.search import SourceState
from travelmind.offers.service import RateLimited, UnknownAirport, check_search_budget
from travelmind.offers.suppliers.base import SupplierError
from travelmind.reference.service import get_airport_index

log = structlog.get_logger()

SUPPLIER = LiteApiHotelSupplier.code
NOT_CONFIGURED_MESSAGE = "Connect LiteAPI (TM_LITEAPI_KEY) to see hotels."

__all__ = ["RateLimited", "UnknownAirport", "search_hotels"]


async def _search_supplier(
    settings: Settings,
    request: HotelSearchRequest,
    *,
    latitude: float,
    longitude: float,
    currency: str,
) -> tuple[list[HotelOffer], SourceStatusOut]:
    supplier = LiteApiHotelSupplier(settings.liteapi_key)
    timeout_s = settings.search_timeout_seconds
    started = time.monotonic()

    def status(state: SourceState, count: int = 0, message: str | None = None) -> SourceStatusOut:
        elapsed = round((time.monotonic() - started) * 1000)
        return SourceStatusOut(
            supplier=SUPPLIER, status=state, offer_count=count, latency_ms=elapsed, message=message
        )

    try:
        offers = await asyncio.wait_for(
            supplier.search(
                request,
                latitude=latitude,
                longitude=longitude,
                currency=currency,
                timeout_s=timeout_s,
            ),
            timeout=timeout_s,
        )
    except TimeoutError:
        return [], status("timeout", message=f"No answer within {timeout_s:g}s.")
    except SupplierError as exc:
        return [], status("error", message=exc.message)
    except Exception:
        log.exception("supplier_failed", supplier=SUPPLIER)
        return [], status("error", message="This supplier failed unexpectedly.")
    return offers, status("ok", len(offers))


async def search_hotels(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    request: HotelSearchRequest,
    *,
    agency_id: UUID,
) -> HotelSearchResponse:
    """Hotels near the destination airport, cheapest first in the display currency.

    Raises RateLimited when the agency's per-minute hotel budget (separate from flights) is
    spent, and UnknownAirport when the destination isn't a known airport.
    """
    await check_search_budget(redis, settings, f"rl:hotels:{agency_id}")
    airport = (await get_airport_index(db)).get(request.destination)
    if airport is None:
        raise UnknownAirport(request.destination)
    currency = display_currency_for(airport.country_code)
    if not settings.liteapi_key:
        return HotelSearchResponse(
            display_currency=currency,
            nights=request.nights,
            sources=[
                SourceStatusOut(
                    supplier=SUPPLIER,
                    status="not_configured",
                    offer_count=0,
                    latency_ms=0,
                    message=NOT_CONFIGURED_MESSAGE,
                )
            ],
            offers=[],
        )

    offers, source = await _search_supplier(
        settings,
        request,
        latitude=airport.latitude,
        longitude=airport.longitude,
        currency=currency,
    )
    needs_fx = any(o.total.currency != currency for o in offers)
    fx = await get_fx_rates(redis, enabled=settings.fx_enabled) if needs_fx else None

    def display(offer: HotelOffer) -> Money | None:
        return display_money(offer.total, currency, fx)

    views = [
        HotelOfferView.model_validate(o.model_dump() | {"display_total": display(o)})
        for o in rank_by_display(offers, display)
    ]
    return HotelSearchResponse(
        display_currency=currency,
        fx_as_of=fx.as_of if fx else None,
        nights=request.nights,
        sources=[source],
        offers=views,
    )
