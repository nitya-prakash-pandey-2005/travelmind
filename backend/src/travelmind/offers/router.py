from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel

from travelmind.cache import RedisClient
from travelmind.config import Settings, get_settings
from travelmind.db import DbSession
from travelmind.fareintel.models import FareSnapshot
from travelmind.fareintel.service import (
    PROVENANCES,
    Baseline,
    Family,
    Insight,
    assess,
    compute_baseline,
)
from travelmind.fareintel.travelpayouts import seed_route
from travelmind.identity.deps import AuthedUser
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.offers.cache import recall_offer, remember_offers
from travelmind.offers.carbon import TimClient
from travelmind.offers.db_models import FlightSearchLog
from travelmind.offers.fx import FxRates, display_currency_for, get_fx_rates
from travelmind.offers.models import FlightOffer, FlightSearchRequest
from travelmind.offers.money import Money
from travelmind.offers.registry import flight_suppliers
from travelmind.offers.search import fan_out, rank
from travelmind.offers.suppliers.base import SupplierError
from travelmind.reference.service import get_airport_index

log = structlog.get_logger()
flights_router = APIRouter(prefix="/api/v1/flights", tags=["flights"])
suppliers_router = APIRouter(prefix="/api/v1/suppliers", tags=["suppliers"])

# Emissions are optional: a slow TIM adds at most this much on top of the supplier fan-out.
TIM_TIMEOUT_SECONDS = 4.0


class InsightOut(BaseModel):
    signal: Literal["good", "typical", "high"]
    delta_pct: float
    message: str


class BaselineOut(BaseModel):
    family: Family
    currency: str
    sample_size: int
    p25_minor: int
    median_minor: int
    p75_minor: int
    window_days: int


class OfferView(FlightOffer):
    display_total: Money | None = None
    insight: InsightOut | None = None


class SourceStatusOut(BaseModel):
    supplier: str
    status: str
    offer_count: int
    latency_ms: int
    message: str | None


class FlightSearchResponse(BaseModel):
    search_id: UUID
    display_currency: str
    fx_as_of: date | None
    baseline: BaselineOut | None
    sources: list[SourceStatusOut]
    offers: list[OfferView]


class RepriceResponse(BaseModel):
    offer: OfferView
    price_changed: bool
    previous_total: Money


class SupplierStatusOut(BaseModel):
    code: str
    name: str
    kind: Literal["flights", "hotels", "emissions", "price_history", "exchange_rates"]
    connected: bool
    mode: Literal["live", "test", "sandbox"] | None
    detail: str


def _display(offer: FlightOffer, currency: str, fx: FxRates | None) -> Money | None:
    if offer.total.currency == currency:
        return offer.total
    return fx.convert(offer.total, currency) if fx else None


def _view(offer: FlightOffer, shown: Money | None, insight: Insight | None) -> OfferView:
    return OfferView.model_validate(
        offer.model_dump()
        | {
            "display_total": shown,
            "insight": InsightOut(
                signal=insight.signal, delta_pct=insight.delta_pct, message=insight.message
            )
            if insight
            else None,
        }
    )


@flights_router.post("/search")
async def search_flights_route(
    body: FlightSearchRequest, current: AuthedUser, db: DbSession, redis: RedisClient
) -> FlightSearchResponse:
    settings = get_settings()
    limiter = LoginRateLimiter(redis, settings.search_max_per_minute, 60)
    if not await limiter.hit(f"rl:search:{current.agency_id}"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many searches in a minute. Please wait a moment and try again.",
        )
    index = await get_airport_index(db)
    for code in (body.origin, body.destination):
        if index.get(code) is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown airport code {code}."
            )
    origin = index.get(body.origin)
    if origin is None:  # unreachable; narrows the type
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown airport code {body.origin}."
        )
    suppliers = flight_suppliers(settings, index.get)
    if not suppliers:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No flight suppliers are connected yet. Add a supplier key or enable the sandbox.",
        )

    offers, sources = await fan_out(suppliers, body, settings.search_timeout_seconds)
    if settings.google_tim_api_key and offers:
        tim = TimClient(settings.google_tim_api_key, redis, timeout_s=TIM_TIMEOUT_SECONDS)
        offers = await tim.enrich(offers, body.cabin)

    currency = display_currency_for(origin.country_code)
    fx = await get_fx_rates(redis, enabled=settings.fx_enabled)
    one_way = body.return_date is None
    days_out = (body.departure_date - datetime.now(UTC).date()).days
    # Sandbox fares are never compared with (or mixed into) the market's history.
    family: Family = "market" if any(o.provenance == "LIVE" for o in offers) else "sandbox"

    if one_way and family == "market" and settings.travelpayouts_token and body.cabin == "economy":
        # Never raises: failures are logged and the search goes on without seeding.
        await seed_route(
            db,
            redis,
            token=settings.travelpayouts_token,
            origin=body.origin,
            destination=body.destination,
            departure_date=body.departure_date,
            currency=currency,
            market=origin.country_code.lower(),
        )

    baseline: Baseline | None = None
    if one_way:
        baseline = await compute_baseline(
            db,
            origin=body.origin,
            destination=body.destination,
            cabin=body.cabin,
            currency=currency,
            days_to_departure=days_out,
            family=family,
        )

    ranked = rank(offers, lambda o: _display(o, currency, fx))
    views: list[OfferView] = []
    for offer in ranked:
        shown = _display(offer, currency, fx)
        comparable = (
            baseline is not None and shown is not None and offer.provenance in PROVENANCES[family]
        )
        insight = (
            assess(shown.amount_minor, baseline, days_out)
            if comparable and shown and baseline
            else None
        )
        views.append(_view(offer, shown, insight))

    if one_way:
        db.add_all(
            FareSnapshot(
                origin=body.origin,
                destination=body.destination,
                departure_date=body.departure_date,
                days_to_departure=days_out,
                cabin=body.cabin,
                carrier=v.owner_carrier[:3],
                stops=v.stops,
                total_minor=v.display_total.amount_minor,
                currency=currency,
                provenance=v.provenance,
                source=v.supplier[:30],
            )
            for v in views
            if v.display_total is not None
        )
    cheapest = next((v.display_total.amount_minor for v in views if v.display_total), None)
    log_row = FlightSearchLog(
        agency_id=current.agency_id,
        user_id=current.id,
        origin=body.origin,
        destination=body.destination,
        departure_date=body.departure_date,
        return_date=body.return_date,
        adults=body.adults,
        children=len(body.children_ages),
        cabin=body.cabin,
        offer_count=len(views),
        display_currency=currency,
        cheapest_minor=cheapest,
    )
    db.add(log_row)
    await db.commit()
    await remember_offers(redis, current.agency_id, offers)

    return FlightSearchResponse(
        search_id=log_row.id,
        display_currency=currency,
        fx_as_of=fx.as_of if fx else None,
        baseline=BaselineOut(**baseline.__dict__) if baseline else None,
        sources=[SourceStatusOut(**s.__dict__) for s in sources],
        offers=views,
    )


@flights_router.post("/offers/{offer_id}/price")
async def reprice_offer_route(
    offer_id: Annotated[str, Path(max_length=1000)],
    current: AuthedUser,
    db: DbSession,
    redis: RedisClient,
) -> RepriceResponse:
    cached = await recall_offer(redis, current.agency_id, offer_id)
    if cached is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This offer is no longer available. Run the search again."
        )
    settings = get_settings()
    index = await get_airport_index(db)
    supplier = next(
        (s for s in flight_suppliers(settings, index.get) if s.code == cached.supplier), None
    )
    if supplier is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The supplier for this offer is no longer connected."
        )
    try:
        fresh = await supplier.price(cached.supplier_ref)
    except SupplierError as exc:
        gone = exc.code in ("offer_expired", "offer_unavailable")
        raise HTTPException(
            status.HTTP_410_GONE if gone else status.HTTP_502_BAD_GATEWAY, exc.message
        ) from None
    if fresh.co2_kg_per_passenger is None and cached.co2_kg_per_passenger is not None:
        fresh = fresh.model_copy(
            update={
                "co2_kg_per_passenger": cached.co2_kg_per_passenger,
                "co2_source": cached.co2_source,
            }
        )
    origin = index.get(fresh.slices[0].origin) if fresh.slices else None
    currency = display_currency_for(origin.country_code) if origin else fresh.total.currency
    fx = await get_fx_rates(redis, enabled=settings.fx_enabled)
    await remember_offers(redis, current.agency_id, [fresh])
    return RepriceResponse(
        offer=_view(fresh, _display(fresh, currency, fx), None),
        price_changed=fresh.total != cached.total,
        previous_total=cached.total,
    )


def _mode(secret: str, test_prefix: str) -> Literal["live", "test"] | None:
    if not secret:
        return None
    return "test" if secret.startswith(test_prefix) else "live"


def supplier_statuses(settings: Settings) -> list[SupplierStatusOut]:
    """What is connected and in which mode. Never includes a key or any part of one."""
    return [
        SupplierStatusOut(
            code="duffel",
            name="Duffel",
            kind="flights",
            connected=bool(settings.duffel_token),
            mode=_mode(settings.duffel_token, "duffel_test_"),
            detail="Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN.",
        ),
        SupplierStatusOut(
            code="sandbox",
            name="Sandbox inventory",
            kind="flights",
            connected=settings.sandbox_supplier_enabled,
            mode="sandbox" if settings.sandbox_supplier_enabled else None,
            detail="Deterministic test flights for demos and development. Never bookable.",
        ),
        SupplierStatusOut(
            code="liteapi",
            name="LiteAPI",
            kind="hotels",
            connected=bool(settings.liteapi_key),
            mode=_mode(settings.liteapi_key, "sand_"),
            detail="Hotel rates worldwide. Set TM_LITEAPI_KEY.",
        ),
        SupplierStatusOut(
            code="google_tim",
            name="Google Travel Impact Model",
            kind="emissions",
            connected=bool(settings.google_tim_api_key),
            mode="live" if settings.google_tim_api_key else None,
            detail="Per-flight CO₂ estimates. Set TM_GOOGLE_TIM_API_KEY.",
        ),
        SupplierStatusOut(
            code="travelpayouts",
            name="Travelpayouts",
            kind="price_history",
            connected=bool(settings.travelpayouts_token),
            mode="live" if settings.travelpayouts_token else None,
            detail=(
                "Cached market prices that seed fare history (indications only). "
                "Set TM_TRAVELPAYOUTS_TOKEN."
            ),
        ),
        SupplierStatusOut(
            code="ecb",
            name="ECB reference rates",
            kind="exchange_rates",
            connected=settings.fx_enabled,
            mode="live" if settings.fx_enabled else None,
            detail="Daily euro reference rates for approximate converted prices.",
        ),
    ]


@suppliers_router.get("")
async def list_suppliers_route(_current: AuthedUser) -> list[SupplierStatusOut]:
    return supplier_statuses(get_settings())
