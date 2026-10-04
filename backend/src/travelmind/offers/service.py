"""Flight search and re-pricing, callable from the HTTP API or directly (e.g. by the copilot).

Errors are plain domain exceptions carrying a message that is safe to show to users; the router
maps them to HTTP status codes.
"""

import asyncio
import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID, uuid4

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.config import Settings
from travelmind.db import release_connection, utcnow
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
from travelmind.metrics import supplier_call
from travelmind.offers.cache import recall_offer, remember_offers
from travelmind.offers.carbon import TimClient
from travelmind.offers.db_models import FlightSearchLog
from travelmind.offers.display import display_money
from travelmind.offers.fx import display_currency_for, get_fx_rates
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
from travelmind.offers.search import SourceStatus, fan_out, rank
from travelmind.offers.suppliers.base import FlightSupplier, SupplierError
from travelmind.reference.search import AirportRecord
from travelmind.reference.service import get_airport_index
from travelmind.resilience import CircuitOpen, guarded
from travelmind.workspace.activity import record_activity
from travelmind.workspace.models import SearchSourceResult

log = structlog.get_logger()

# Emissions are optional: a slow TIM adds at most this much on top of the supplier fan-out.
TIM_TIMEOUT_SECONDS = 4.0
REPRICE_TIMEOUT_SECONDS = 20.0
# An identical market fare (same flight option, same price) is recorded at most once per window,
# so repeat searches don't flood the history and insights don't compare offers with themselves.
MARKET_SEEN_TTL_SECONDS = 6 * 3600
_MARKET_PROVENANCES = frozenset(PROVENANCES["market"])
SEARCH_LIMIT_MESSAGE = "Too many searches in a minute. Please wait a moment and try again."
PRICE_CHECK_LIMIT_MESSAGE = "Too many price checks in a minute. Please wait a moment and try again."


class OfferServiceError(Exception):
    """A problem with a message that is safe to show to users."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class RateLimited(OfferServiceError):
    def __init__(self, message: str = SEARCH_LIMIT_MESSAGE) -> None:
        super().__init__(message)


async def _spend_budget(redis: Redis, key: str, per_minute: int, message: str) -> None:
    if not await LoginRateLimiter(redis, per_minute, 60).hit(key):
        raise RateLimited(message)


async def check_search_budget(redis: Redis, settings: Settings, key: str) -> None:
    """Count one search against a per-minute budget; raise RateLimited once it is spent."""
    await _spend_budget(redis, key, settings.search_max_per_minute, SEARCH_LIMIT_MESSAGE)


async def check_price_budget(redis: Redis, settings: Settings, agency_id: UUID) -> None:
    """Count one price check against the agency's own per-minute budget (separate from search)."""
    await _spend_budget(
        redis,
        f"rl:price:{agency_id}",
        settings.reprice_max_per_minute,
        PRICE_CHECK_LIMIT_MESSAGE,
    )


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


def offer_view(
    offer: FlightOffer,
    shown: Money | None,
    insight: Insight | None,
    per_traveller: Money | None = None,
) -> OfferView:
    """An offer as shown to the agency: `shown` is its total in the display currency."""
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


def plural(count: int, noun: str) -> str:
    """'1 offer', '12 offers'."""
    return f"{count} {noun}{'' if count == 1 else 's'}"


def source_results(
    agency_id: UUID,
    kind: str,
    search_id: UUID | None,
    sources: Sequence[SourceStatus | SourceStatusOut],
    occurred_at: datetime,
) -> list[SearchSourceResult]:
    """One row per supplier actually called (a not-configured supplier was never called)."""
    return [
        SearchSourceResult(
            agency_id=agency_id,
            search_kind=kind,
            search_id=search_id,
            supplier=s.supplier[:30],
            status=s.status,
            offer_count=s.offer_count,
            latency_ms=s.latency_ms,
            occurred_at=occurred_at,
        )
        for s in sources
        if s.status != "not_configured"
    ]


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
    suppliers: Sequence[FlightSupplier] | None = None,
    enforce_budget: bool = True,
    occurred_at: datetime | None = None,
) -> FlightSearchResponse:
    """Search every connected supplier and return ranked offers with insights.

    `db` must already be bound to `agency_id` (bind_tenant). Commits before calling the suppliers
    (ending any read transaction, so no connection is held while they answer), and at the end,
    together with one result row per supplier and a `search.flights` activity event.
    Raises RateLimited, UnknownAirport or NoSuppliers.

    Demo seeding only (never exposed over HTTP): `suppliers` replaces the connected suppliers,
    `enforce_budget=False` skips the per-minute limit and `occurred_at` back-dates the search
    log, its source results and its activity. Fare history is always observed now.
    """
    agency_id = UUID(str(agency_id))
    if enforce_budget:
        await check_search_budget(redis, settings, f"rl:search:{agency_id}")
    index = await get_airport_index(db)
    airports: dict[str, AirportRecord] = {}
    for code in (request.origin, request.destination):
        record = index.get(code)
        if record is None:
            raise UnknownAirport(code)
        airports[code] = record
    origin = airports[request.origin]
    if suppliers is None:
        suppliers = flight_suppliers(settings, index.get)
    if not suppliers:
        raise NoSuppliers()

    # Nothing is written before the suppliers answer: hand the connection back while they work.
    await release_connection(db)
    # Exchange rates are fetched while suppliers search, so they never add to the wait.
    (offers, sources), fx = await asyncio.gather(
        fan_out(suppliers, request, settings.search_timeout_seconds),
        get_fx_rates(redis, enabled=settings.fx_enabled),
    )
    if settings.google_tim_api_key and offers:
        tim = TimClient(settings.google_tim_api_key, redis, timeout_s=TIM_TIMEOUT_SECONDS)
        offers = await tim.enrich(offers, request.cabin)

    currency = display_currency_for(origin.country_code)
    one_way = request.return_date is None
    # Never negative: a departure "today" west of UTC can be UTC's yesterday.
    days_out = max((request.departure_date - datetime.now(UTC).date()).days, 0)
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
    for offer in rank(offers, lambda o: display_money(o.total, currency, fx)):
        shown = display_money(offer.total, currency, fx)
        share = _per_traveller(offer, request, currency, family)
        insight = (
            assess(share.amount_minor, baseline, days_out)
            if baseline is not None and share is not None
            else None
        )
        views.append(offer_view(offer, shown, insight, share))

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
    stamp = occurred_at or utcnow()
    log_row = FlightSearchLog(
        id=uuid4(),
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
        created_at=stamp,
    )
    db.add(log_row)
    db.add_all(source_results(agency_id, "flights", log_row.id, sources, stamp))
    travellers = plural(request.passenger_count, "traveller")
    await record_activity(
        db,
        agency_id=agency_id,
        kind="search.flights",
        summary=(
            f"Searched {request.origin} → {request.destination} for {travellers}"
            f" · {plural(len(views), 'offer')}"
        ),
        actor_user_id=user_id,
        data={"origin": request.origin, "destination": request.destination, "offers": len(views)},
        occurred_at=stamp,
    )
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
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    offer_id: str,
    *,
    agency_id: UUID,
    user_id: UUID | None = None,
) -> RepriceResponse:
    """Confirm a recently returned offer's price with its supplier.

    Only offers this agency was shown can be re-priced. `db` must already be bound to
    `agency_id`; a confirmed check commits a `supplier.price_checked` activity event.
    Raises RateLimited, OfferNotFound, SupplierGone, OfferGone or PriceCheckFailed.
    """
    await check_price_budget(redis, settings, agency_id)
    cached = await recall_offer(redis, agency_id, offer_id)
    if cached is None:
        raise OfferNotFound()
    index = await get_airport_index(db)
    supplier = next(
        (s for s in flight_suppliers(settings, index.get) if s.code == cached.supplier), None
    )
    if supplier is None:
        raise SupplierGone()
    await release_connection(db)  # no connection held while the supplier answers
    try:
        async with guarded(supplier.code):
            with supplier_call(supplier.code):
                async with asyncio.timeout(REPRICE_TIMEOUT_SECONDS):
                    fresh = await supplier.price(cached.supplier_ref)
    except CircuitOpen as exc:  # the supplier was skipped, not called
        log.warning("reprice_skipped", supplier=supplier.code, reason=exc.reason)
        raise PriceCheckFailed(exc.message) from None
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
    changed = fresh.total != cached.total
    route = (fresh.slices or cached.slices)[:1]
    origin_code = route[0].origin if route else ""
    destination_code = route[0].destination if route else ""
    await record_activity(
        db,
        agency_id=agency_id,
        kind="supplier.price_checked",
        summary=(
            f"Checked price for {fresh.owner_carrier} {origin_code}→{destination_code}: "
            f"{'changed' if changed else 'confirmed'}"
        ),
        actor_user_id=user_id,
        data={
            "supplier": fresh.supplier,
            "carrier": fresh.owner_carrier,
            "origin": origin_code,
            "destination": destination_code,
            "price_changed": changed,
        },
    )
    await db.commit()
    await remember_offers(redis, agency_id, [fresh])
    return RepriceResponse(
        offer=offer_view(fresh, display_money(fresh.total, currency, fx), None),
        price_changed=changed,
        previous_total=cached.total,
    )
