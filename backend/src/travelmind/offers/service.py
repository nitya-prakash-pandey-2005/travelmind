"""Flight search and re-pricing, callable from the HTTP API or directly (e.g. by the copilot).

Errors are plain domain exceptions carrying a message that is safe to show to users; the router
maps them to HTTP status codes.
"""

import asyncio
import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.config import Settings
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
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.offers.cache import recall_offer, remember_offers
from travelmind.offers.carbon import TimClient
from travelmind.offers.db_models import FlightSearchLog
from travelmind.offers.fx import FxRates, display_currency_for, get_fx_rates
from travelmind.offers.models import FlightOffer, FlightSearchRequest
from travelmind.offers.money import Money, per_traveller_minor
from travelmind.offers.registry import flight_suppliers
from travelmind.offers.schemas import (
    BaselineOut,
    FlightSearchResponse,
    InsightOut,
    OfferView,
    RepriceResponse,
    SourceStatusOut,
)
from travelmind.offers.search import fan_out, rank
from travelmind.offers.suppliers.base import SupplierError
from travelmind.reference.search import AirportRecord
from travelmind.reference.service import get_airport_index

log = structlog.get_logger()

# Emissions are optional: a slow TIM adds at most this much on top of the supplier fan-out.
TIM_TIMEOUT_SECONDS = 4.0
REPRICE_TIMEOUT_SECONDS = 20.0
# An identical market fare (same flight option, same price) is recorded at most once per window,
# so repeat searches don't flood the history and insights don't compare offers with themselves.
MARKET_SEEN_TTL_SECONDS = 6 * 3600
_MARKET_PROVENANCES = frozenset(PROVENANCES["market"])


class OfferServiceError(Exception):
    """A problem with a message that is safe to show to users."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class RateLimited(OfferServiceError):
    def __init__(self) -> None:
        super().__init__("Too many searches in a minute. Please wait a moment and try again.")


async def check_search_budget(redis: Redis, settings: Settings, key: str) -> None:
    """Count one search against a per-minute budget; raise RateLimited once it is spent."""
    limiter = LoginRateLimiter(redis, settings.search_max_per_minute, 60)
    if not await limiter.hit(key):
        raise RateLimited()


class UnknownAirport(OfferServiceError):
    def __init__(self, code: str) -> None:
        super().__init__(f"Unknown airport code {code}.")
        self.code = code


class NoSuppliers(OfferServiceError):
    def __init__(self) -> None:
        super().__init__(
            "No flight suppliers are connected yet. Add a supplier key or enable the sandbox."
        )


class OfferNotFound(OfferServiceError):
    def __init__(self) -> None:
        super().__init__("This offer is no longer available. Run the search again.")


class SupplierGone(OfferServiceError):
    def __init__(self) -> None:
        super().__init__("The supplier for this offer is no longer connected.")


class OfferGone(OfferServiceError):
    """The supplier says the offer expired or can no longer be sold."""


class PriceCheckFailed(OfferServiceError):
    """The supplier couldn't confirm the price (error or no answer in time)."""


def _display(offer: FlightOffer, currency: str, fx: FxRates | None) -> Money | None:
    if offer.total.currency == currency:
        return offer.total
    return fx.convert(offer.total, currency) if fx else None


def _per_traveller(
    offer: FlightOffer, request: FlightSearchRequest, currency: str, family: Family
) -> Money | None:
    """One traveller's fare when the offer is comparable with fare history, else None.

    Comparable means: an adults-only party (children pay less, so a share would understate the
    adult fare), billed in the display currency (converted amounts move with the rate, not the
    market) and from the baseline's family (sandbox and market fares are never mixed).
    """
    if (
        request.children_ages
        or offer.total.currency != currency
        or offer.provenance not in PROVENANCES[family]
    ):
        return None
    amount = per_traveller_minor(offer.total.amount_minor, offer.passenger_count)
    return Money(amount_minor=amount, currency=currency)


def _view(
    offer: FlightOffer,
    shown: Money | None,
    insight: Insight | None,
    per_traveller: Money | None = None,
) -> OfferView:
    return OfferView.model_validate(
        offer.model_dump()
        | {
            "display_total": shown,
            "per_traveller": per_traveller,
            "insight": InsightOut(
                signal=insight.signal, delta_pct=insight.delta_pct, message=insight.message
            )
            if insight
            else None,
        }
    )


def _seen_key(row: FareSnapshot) -> str:
    fields = (
        row.origin,
        row.destination,
        row.departure_date.isoformat(),
        row.cabin,
        row.currency,
        row.source,
        row.carrier or "",
        "" if row.stops is None else str(row.stops),
        str(row.total_minor),
    )
    return "fs:seen:" + hashlib.sha256("|".join(fields).encode()).hexdigest()


async def new_observations(redis: Redis, rows: Sequence[FareSnapshot]) -> list[FareSnapshot]:
    """The rows worth recording: every SANDBOX row, and market rows not seen in the last 6 h.

    Market rows are claimed with SET NX; if Redis is unavailable they are skipped (a missing
    observation is harmless, a duplicate skews the history).
    """
    market = [r for r in rows if r.provenance in _MARKET_PROVENANCES]
    keep = [r for r in rows if r.provenance not in _MARKET_PROVENANCES]
    if not market:
        return keep
    try:
        async with redis.pipeline(transaction=False) as pipe:
            for row in market:
                pipe.set(_seen_key(row), "1", nx=True, ex=MARKET_SEEN_TTL_SECONDS)
            claimed = await pipe.execute()
    except RedisError as exc:
        log.warning("fare_history_dedupe_unavailable", error_type=type(exc).__name__)
        return keep
    return keep + [row for row, fresh in zip(market, claimed, strict=True) if fresh]


async def search_flights(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    request: FlightSearchRequest,
    *,
    agency_id: UUID,
    user_id: UUID | None,
) -> FlightSearchResponse:
    """Search every connected supplier and return ranked offers with insights.

    `db` must already be bound to `agency_id` (bind_tenant). Commits once, at the end.
    Raises RateLimited, UnknownAirport or NoSuppliers.
    """
    await check_search_budget(redis, settings, f"rl:search:{agency_id}")
    index = await get_airport_index(db)
    airports: dict[str, AirportRecord] = {}
    for code in (request.origin, request.destination):
        record = index.get(code)
        if record is None:
            raise UnknownAirport(code)
        airports[code] = record
    origin = airports[request.origin]
    suppliers = flight_suppliers(settings, index.get)
    if not suppliers:
        raise NoSuppliers()

    offers, sources = await fan_out(suppliers, request, settings.search_timeout_seconds)
    if settings.google_tim_api_key and offers:
        tim = TimClient(settings.google_tim_api_key, redis, timeout_s=TIM_TIMEOUT_SECONDS)
        offers = await tim.enrich(offers, request.cabin)

    currency = display_currency_for(origin.country_code)
    fx = await get_fx_rates(redis, enabled=settings.fx_enabled)
    one_way = request.return_date is None
    days_out = (request.departure_date - datetime.now(UTC).date()).days
    # Sandbox fares are never compared with (or mixed into) the market's history.
    family: Family = "market" if any(o.provenance == "LIVE" for o in offers) else "sandbox"

    if (
        one_way
        and family == "market"
        and settings.travelpayouts_token
        and request.cabin == "economy"
    ):
        # Never raises: failures are logged and the search goes on without seeding.
        await seed_route(
            db,
            redis,
            token=settings.travelpayouts_token,
            origin=request.origin,
            destination=request.destination,
            departure_date=request.departure_date,
            currency=currency,
            market=origin.country_code.lower(),
        )

    baseline: Baseline | None = None
    if one_way:
        baseline = await compute_baseline(
            db,
            origin=request.origin,
            destination=request.destination,
            cabin=request.cabin,
            currency=currency,
            days_to_departure=days_out,
            family=family,
        )

    views: list[OfferView] = []
    for offer in rank(offers, lambda o: _display(o, currency, fx)):
        shown = _display(offer, currency, fx)
        share = _per_traveller(offer, request, currency, family)
        insight = (
            assess(share.amount_minor, baseline, days_out)
            if baseline is not None and share is not None
            else None
        )
        views.append(_view(offer, shown, insight, share))

    if one_way:
        # Only comparable offers, one traveller's fare each: the history stays like with like.
        observed = [
            FareSnapshot(
                origin=request.origin,
                destination=request.destination,
                departure_date=request.departure_date,
                days_to_departure=days_out,
                cabin=request.cabin,
                carrier=v.owner_carrier[:3],
                stops=v.stops,
                total_minor=v.per_traveller.amount_minor,
                currency=currency,
                provenance=v.provenance,
                source=v.supplier[:30],
            )
            for v in views
            if v.per_traveller is not None
        ]
        db.add_all(await new_observations(redis, observed))
    cheapest = next((v.display_total.amount_minor for v in views if v.display_total), None)
    log_row = FlightSearchLog(
        agency_id=agency_id,
        user_id=user_id,
        origin=request.origin,
        destination=request.destination,
        departure_date=request.departure_date,
        return_date=request.return_date,
        adults=request.adults,
        children=len(request.children_ages),
        cabin=request.cabin,
        offer_count=len(views),
        display_currency=currency,
        cheapest_minor=cheapest,
    )
    db.add(log_row)
    await db.commit()
    await remember_offers(redis, agency_id, offers)

    return FlightSearchResponse(
        search_id=log_row.id,
        display_currency=currency,
        fx_as_of=fx.as_of if fx else None,
        baseline=BaselineOut(**baseline.__dict__) if baseline else None,
        sources=[SourceStatusOut(**s.__dict__) for s in sources],
        offers=views,
    )


async def reprice_offer(
    db: AsyncSession, redis: Redis, settings: Settings, offer_id: str, *, agency_id: UUID
) -> RepriceResponse:
    """Confirm a recently returned offer's price with its supplier.

    Only offers this agency was shown can be re-priced. Raises OfferNotFound, SupplierGone,
    OfferGone or PriceCheckFailed.
    """
    cached = await recall_offer(redis, agency_id, offer_id)
    if cached is None:
        raise OfferNotFound()
    index = await get_airport_index(db)
    supplier = next(
        (s for s in flight_suppliers(settings, index.get) if s.code == cached.supplier), None
    )
    if supplier is None:
        raise SupplierGone()
    try:
        async with asyncio.timeout(REPRICE_TIMEOUT_SECONDS):
            fresh = await supplier.price(cached.supplier_ref)
    except TimeoutError:
        log.warning("reprice_timeout", supplier=supplier.code)
        raise PriceCheckFailed("Couldn't confirm the price in time. Try again.") from None
    except SupplierError as exc:
        if exc.code in ("offer_expired", "offer_unavailable"):
            raise OfferGone(exc.message) from None
        raise PriceCheckFailed(exc.message) from None
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
    await remember_offers(redis, agency_id, [fresh])
    return RepriceResponse(
        offer=_view(fresh, _display(fresh, currency, fx), None),
        price_changed=fresh.total != cached.total,
        previous_total=cached.total,
    )
