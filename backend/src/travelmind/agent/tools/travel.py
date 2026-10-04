"""Airports, flights, hotels, price checks and fare insight, through the existing services.

Every tool runs the same service the app's own screens call, under the run's agency (the
context's session is bound to it), with the normal per-minute search and price-check budgets,
supplier guards and metrics. Results are trimmed to what the model needs, echo the trip they
searched (codes, ISO and displayed dates), and give every price as minor units, currency and
formatted text. Offers and hotels get short run-scoped ids from the run memory (F1, H1).

Converted prices: a total shown in the agency's currency but billed by the supplier in another
is marked `converted: true` with the rates' date (`fx_as_of`), its formatted amounts start with
"≈ " as in the app, and the card also gives the supplier's own total (`supplier_total_*`).

Places and codes: a city alias ("Goa", "goa", "GOA", "Delhi": `reference.search.CITY_ALIASES`)
is that city's main airport in any case, never the code it happens to spell: "GOA" is Goa (GOI),
not Genoa, which stays reachable by name ("Genoa"). Other text in capitals ("DEL") is an airport
code; anything else is read as a name. The code fields here apply that rule before a code is
checked, and `places.resolve` applies it to place names.

Dates count from the agency's own today (`RunContext.today`).
"""

import re
from datetime import date, datetime
from typing import Annotated, Any

from pydantic import BeforeValidator, Field, model_validator

from travelmind.agent.context import RunContext, SeenItem
from travelmind.agent.tools.base import (
    Args,
    ToolError,
    clean_text,
    date_fields,
    display_date,
    format_money,
    money_fields,
    shown_money,
    validate,
)
from travelmind.fareintel.routes import route_currency
from travelmind.fareintel.service import Baseline, Family, compute_baseline
from travelmind.hotels import service as hotels_service
from travelmind.hotels.models import HotelSearchRequest
from travelmind.hotels.schemas import HotelOfferView
from travelmind.offers import service as offers_service
from travelmind.offers.fx import get_fx_rates
from travelmind.offers.models import (
    MAX_DAYS_AHEAD,
    MAX_PASSENGERS,
    Cabin,
    FlightSearchRequest,
    IataCode,
    Slice,
)
from travelmind.offers.money import Money, per_traveller_minor
from travelmind.offers.schemas import OfferView, SourceStatusOut
from travelmind.offers.service import (
    OfferGone,
    OfferNotFound,
    OfferServiceError,
    RateLimited,
    UnknownAirport,
)
from travelmind.reference.search import CITY_ALIASES, AirportRecord, fold
from travelmind.reference.service import get_airport_index

MAX_AIRPORTS = 5
MAX_OFFERS = 6
MAX_HOTELS = 6
MAX_ADULTS_PER_ROOM = 6
MAX_ROOMS = 4
SAME_AIRPORTS = "Origin and destination must be different airports."


# --- codes and names ------------------------------------------------------------------------


def written_as_code(text: str) -> bool:
    """Three capital letters: the way an airport code is written ("GOA", not "Goa")."""
    return len(text) == 3 and text.isascii() and text.isalpha() and text.isupper()


def alias_code(text: object) -> str | None:
    """The main airport of a city alias ("Goa", "goa", "GOA", "New Delhi"), or None. An alias
    wins over the code it spells: "GOA" in capitals is Goa (GOI), not Genoa."""
    if not isinstance(text, str):
        return None
    words = " ".join(text.split())
    codes = CITY_ALIASES.get(fold(words))
    return codes[0] if codes else None


def _code_or_alias(value: object) -> object:
    return alias_code(value) or value


# An airport code field: a city alias written as a name becomes its airport ("goa" → GOI);
# anything else must be a code (case aside: "bom" is BOM).
AirportCode = Annotated[IataCode, BeforeValidator(_code_or_alias)]


def check_trip_start(ctx: RunContext, start: date, what: str) -> None:
    """Refuse a start before the agency's today, or further ahead than suppliers sell."""
    today = ctx.today()
    if start < today:
        raise ToolError("invalid_arguments", f"The {what} date is in the past.")
    if (start - today).days > MAX_DAYS_AHEAD:
        raise ToolError(
            "invalid_arguments", f"Suppliers only sell about {MAX_DAYS_AHEAD} days ahead."
        )


def service_error(exc: OfferServiceError) -> ToolError:
    """A flight or hotel service refusal as the tool's error (its messages are ours)."""
    if isinstance(exc, RateLimited):
        return ToolError("rate_limited", exc.message)
    if isinstance(exc, UnknownAirport | OfferNotFound | OfferGone):
        return ToolError("not_found", exc.message)
    return ToolError("unavailable", exc.message)


def sources_of(sources: list[SourceStatusOut]) -> list[dict[str, Any]]:
    """Which suppliers answered, without their messages (supplier text stays out)."""
    return [
        {"supplier": s.supplier, "status": s.status, "offer_count": s.offer_count} for s in sources
    ]


def _city(record: AirportRecord | None) -> str | None:
    return clean_text(record.city, 60) if record else None


def price_fields(shown: Money, supplier: Money, fx_as_of: date | None) -> dict[str, Any]:
    """The shown total (`total_*`, "≈ " when converted), whether it was converted and the rates'
    date, and the supplier's own total (`supplier_total_*`)."""
    converted = shown.currency != supplier.currency
    return {
        **money_fields("total", shown, converted=converted),
        "converted": converted,
        "fx_as_of": fx_as_of.isoformat() if converted and fx_as_of else None,
        **money_fields("supplier_total", supplier),
    }


# --- lookup_airport ----------------------------------------------------------------------


class LookupAirportArgs(Args):
    query: str = Field(min_length=2, max_length=100, description="City, airport name or code.")


async def lookup_airport(ctx: RunContext, args: LookupAirportArgs) -> dict[str, Any]:
    index = await get_airport_index(ctx.db)
    found = [hit.airport for hit in index.search(args.query, limit=MAX_AIRPORTS)]
    query = " ".join(args.query.split())
    exact = index.get(query) if written_as_code(query) and alias_code(query) is None else None
    if exact is not None:  # a code in capitals is that airport first (an alias's code is not)
        found = [exact, *(a for a in found if a.iata_code != exact.iata_code)][:MAX_AIRPORTS]
    return {
        "matches": [
            {
                "code": airport.iata_code,
                "name": clean_text(airport.name, 100),
                "city": _city(airport),
                "country": clean_text(airport.country_name, 60),
                "country_code": airport.country_code,
            }
            for airport in found
        ]
    }


# --- search_flights ----------------------------------------------------------------------

ChildAge = Annotated[int, Field(ge=0, le=17)]


class SearchFlightsArgs(Args):
    origin: AirportCode = Field(description="3-letter IATA code (lookup_airport finds it).")
    destination: AirportCode = Field(description="3-letter IATA code.")
    depart_date: date = Field(description="YYYY-MM-DD.")
    return_date: date | None = Field(None, description="YYYY-MM-DD; omit for one way.")
    adults: int = Field(1, ge=1, le=MAX_PASSENGERS)
    children_ages: list[ChildAge] = Field(default_factory=list, max_length=8)
    cabin: Cabin = "economy"


def code(value: str | None, limit: int = 3) -> str:
    """A supplier's code (carrier, airport), cleaned like any supplier text."""
    return (clean_text(value, limit) or "").upper()


def flight_number(carrier: str, number: str) -> str:
    """'AI 101', whether the supplier gave '101' or 'AI101'."""
    airline = code(carrier)
    text = code(number, 8)
    if airline and text.startswith(airline) and len(text) > len(airline):
        text = text[len(airline) :].strip()
    return f"{airline} {text}".strip()


def _when(at: datetime) -> tuple[str, str]:
    return at.isoformat(timespec="minutes"), f"{display_date(at.date())}, {at:%H:%M}"


def _slice(part: Slice) -> dict[str, Any]:
    first, last = part.segments[0], part.segments[-1]
    departs_at, departs_display = _when(first.departing_at)
    arrives_at, arrives_display = _when(last.arriving_at)
    return {
        "origin": code(part.origin),
        "destination": code(part.destination),
        "departs_at": departs_at,
        "departs_display": departs_display,
        "arrives_at": arrives_at,
        "arrives_display": arrives_display,
        "stops": part.stops,
        "duration_minutes": part.duration_minutes,
        "flight_numbers": [
            flight_number(s.marketing_carrier, s.flight_number) for s in part.segments
        ],
    }


def remember_offer(
    ctx: RunContext, view: OfferView, fx_as_of: date | None, ref: str | None = None
) -> SeenItem:
    """The offer's card, recorded in the run memory (under `ref` when re-priced)."""
    shown = view.display_total or view.total
    converted = shown.currency != view.total.currency
    share = Money(
        amount_minor=per_traveller_minor(shown.amount_minor, max(view.passenger_count, 1)),
        currency=shown.currency,
    )
    slices = [_slice(s) for s in view.slices if s.segments]
    numbers = [n for s in slices for n in s["flight_numbers"]]
    first_segment = view.slices[0].segments[0] if slices else None
    card = {
        "carrier": code(view.owner_carrier),
        "carrier_name": clean_text(
            view.owner_name or (first_segment.marketing_carrier_name if first_segment else None),
            60,
        ),
        "flight_numbers": numbers,
        "slices": slices,
        "stops": view.stops,
        "duration_minutes": view.total_duration_minutes,
        "cabin": view.cabin,
        **price_fields(shown, view.total, fx_as_of),
        "per_traveller_minor": share.amount_minor,
        "per_traveller_formatted": shown_money(share, converted=converted),
        "provenance": view.provenance,
        "fare_insight": view.insight.signal if view.insight else None,
        "fare_insight_note": view.insight.message if view.insight else None,
        "co2_kg_per_passenger": view.co2_kg_per_passenger,
        "refundable": view.conditions.refundable,
        "checked_bags": view.baggage.checked,
    }
    route = f"{slices[0]['origin']} → {slices[0]['destination']}" if slices else ""
    label = " ".join(p for p in (", ".join(numbers), route) if p) or code(view.owner_carrier)
    if ref is not None:
        return ctx.memory.replace(
            ref,
            source_id=view.id,
            label=label,
            price=shown,
            card=card,
            supplier_price=view.total,
            expires_at=view.expires_at,
        )
    return ctx.memory.remember(
        "flight",
        view.id,
        label=label,
        price=shown,
        card=card,
        supplier_price=view.total,
        expires_at=view.expires_at,
    )


async def search_flights(ctx: RunContext, args: SearchFlightsArgs) -> dict[str, Any]:
    request = validate(
        FlightSearchRequest,
        {
            "origin": args.origin,
            "destination": args.destination,
            "departure_date": args.depart_date,
            "return_date": args.return_date,
            "adults": args.adults,
            "children_ages": args.children_ages,
            "cabin": args.cabin,
        },
    )
    check_trip_start(ctx, request.departure_date, "departure")
    try:
        found = await offers_service.search_flights(
            ctx.db,
            ctx.redis,
            ctx.settings,
            request,
            agency_id=ctx.agency_id,
            user_id=ctx.user_id,
        )
    except OfferServiceError as exc:
        raise service_error(exc) from None
    index = await get_airport_index(ctx.db)
    offers = [remember_offer(ctx, view, found.fx_as_of).card for view in found.offers[:MAX_OFFERS]]
    return {
        "trip": {
            "origin": request.origin,
            "origin_city": _city(index.get(request.origin)),
            "destination": request.destination,
            "destination_city": _city(index.get(request.destination)),
            **date_fields("depart_date", request.departure_date),
            **date_fields("return_date", request.return_date),
            "adults": request.adults,
            "children_ages": list(request.children_ages),
            "cabin": request.cabin,
        },
        "currency": found.display_currency,
        "offer_count": len(found.offers),
        "offers": offers,
        "sources": sources_of(found.sources),
    }


# --- search_hotels -----------------------------------------------------------------------


class SearchHotelsArgs(Args):
    destination: AirportCode = Field(description="3-letter IATA code of the nearest airport.")
    check_in: date = Field(description="YYYY-MM-DD.")
    check_out: date = Field(description="YYYY-MM-DD.")
    adults: int = Field(2, ge=1, le=MAX_ADULTS_PER_ROOM * MAX_ROOMS)
    rooms: int = Field(1, ge=1, le=MAX_ROOMS)

    @model_validator(mode="after")
    def _occupancy(self) -> "SearchHotelsArgs":
        if self.adults < self.rooms:
            raise ValueError("Each room needs at least one adult.")
        if self.adults > self.rooms * MAX_ADULTS_PER_ROOM:
            raise ValueError(f"A room takes at most {MAX_ADULTS_PER_ROOM} adults.")
        return self


def split_adults(adults: int, rooms: int) -> list[int]:
    """Adults spread over rooms as evenly as possible, fuller rooms first: 3 in 2 → [2, 1]."""
    base, extra = divmod(adults, rooms)
    return [base + (1 if n < extra else 0) for n in range(rooms)]


def remember_hotel(
    ctx: RunContext, view: HotelOfferView, nights: int, fx_as_of: date | None
) -> SeenItem:
    shown = view.display_total or view.total
    converted = shown.currency != view.total.currency
    nightly = Money(
        amount_minor=per_traveller_minor(shown.amount_minor, max(nights, 1)),
        currency=shown.currency,
    )
    name = clean_text(view.name, 80) or "Hotel"
    card = {
        "name": name,
        "stars": view.stars,
        "rating": view.rating,
        "area": clean_text(view.address, 120),
        "room": clean_text(view.room_name, 80),
        "board": clean_text(view.board, 40),
        "refundable": view.refundable,
        "free_cancellation_until": clean_text(view.free_cancellation_until, 40),
        **price_fields(shown, view.total, fx_as_of),
        "per_night_minor": nightly.amount_minor,
        "per_night_formatted": shown_money(nightly, converted=converted),
        "nights": nights,
        "provenance": view.provenance,
    }
    return ctx.memory.remember(
        "hotel", view.id, label=name, price=shown, card=card, supplier_price=view.total
    )


async def search_hotels(ctx: RunContext, args: SearchHotelsArgs) -> dict[str, Any]:
    request = validate(
        HotelSearchRequest,
        {
            "destination": args.destination,
            "checkin": args.check_in,
            "checkout": args.check_out,
            "rooms": [{"adults": n} for n in split_adults(args.adults, args.rooms)],
        },
    )
    check_trip_start(ctx, request.checkin, "check-in")
    try:
        found = await hotels_service.search_hotels(
            ctx.db,
            ctx.redis,
            ctx.settings,
            request,
            agency_id=ctx.agency_id,
            guest_nationality=ctx.country,
            user_id=ctx.user_id,
        )
    except OfferServiceError as exc:
        raise service_error(exc) from None
    index = await get_airport_index(ctx.db)
    hotels = [
        remember_hotel(ctx, view, found.nights, found.fx_as_of).card
        for view in found.offers[:MAX_HOTELS]
    ]
    return {
        "trip": {
            "destination": request.destination,
            "destination_city": _city(index.get(request.destination)),
            **date_fields("check_in", request.checkin),
            **date_fields("check_out", request.checkout),
            "nights": request.nights,
            "adults": args.adults,
            "rooms": args.rooms,
        },
        "currency": found.display_currency,
        "hotel_count": len(found.offers),
        "hotels": hotels,
        "sources": sources_of(found.sources),
    }


# --- price_check -------------------------------------------------------------------------


class PriceCheckArgs(Args):
    offer_id: str = Field(min_length=1, max_length=1000, description="An offer_id such as F1.")


def _short_id(ref: object) -> str:
    """A refused id as the error may echo it: only something shaped like a short id (F12)."""
    text = clean_text(ref, 12) or ""
    return text if re.fullmatch(r"[A-Za-z]{1,2}\d{1,6}", text) else "an id"


def unknown_ids(refs: list[str]) -> ToolError:
    shown = ", ".join(dict.fromkeys(_short_id(r) for r in refs[:10]))
    return ToolError(
        "unknown_id",
        f"No tool in this run returned {shown}. Use only the ids earlier results gave "
        "(offer_id, hotel_id, place_id).",
    )


def seen(ctx: RunContext, ref: str, kind: str) -> SeenItem:
    item = ctx.memory.get(ref)
    if item is None or item.kind != kind:
        raise unknown_ids([ref])
    return item


async def price_check(ctx: RunContext, args: PriceCheckArgs) -> dict[str, Any]:
    item = seen(ctx, args.offer_id, "flight")
    try:
        checked = await offers_service.reprice_offer(
            ctx.db,
            ctx.redis,
            ctx.settings,
            item.source_id,
            agency_id=ctx.agency_id,
            user_id=ctx.user_id,
        )
    except OfferServiceError as exc:
        raise service_error(exc) from None
    view = checked.offer
    fx_as_of: date | None = None
    if view.display_total is not None and view.display_total.currency != view.total.currency:
        rates = await get_fx_rates(ctx.redis, enabled=ctx.settings.fx_enabled)
        earlier = item.card.get("fx_as_of")
        fx_as_of = rates.as_of if rates else date.fromisoformat(earlier) if earlier else None
    fresh = remember_offer(ctx, view, fx_as_of, ref=item.ref)
    return {
        "offer_id": item.ref,
        "price_changed": checked.price_changed,
        # The total as this run showed it before (same currency as the offer's card).
        **money_fields("previous_total", item.price, converted=item.converted),
        "offer": fresh.card,
    }


# --- fare_insight ------------------------------------------------------------------------


class FareInsightArgs(Args):
    origin: AirportCode
    destination: AirportCode
    depart_date: date = Field(description="YYYY-MM-DD.")
    cabin: Cabin = "economy"

    @model_validator(mode="after")
    def _route(self) -> "FareInsightArgs":
        if self.origin == self.destination:
            raise ValueError(SAME_AIRPORTS)
        return self


def _baseline(baseline: Baseline) -> dict[str, Any]:
    def amount(name: str, minor: int) -> dict[str, Any]:
        money = Money(amount_minor=minor, currency=baseline.currency)
        return {f"{name}_minor": minor, f"{name}_formatted": format_money(money)}

    return {
        "family": baseline.family,
        "sample_size": baseline.sample_size,
        "window_days": baseline.window_days,
        **amount("low", baseline.p25_minor),
        **amount("median", baseline.median_minor),
        **amount("high", baseline.p75_minor),
    }


async def fare_insight(ctx: RunContext, args: FareInsightArgs) -> dict[str, Any]:
    check_trip_start(ctx, args.depart_date, "departure")
    if (await get_airport_index(ctx.db)).get(args.destination) is None:
        raise ToolError("not_found", f"Unknown airport code {args.destination}.")
    try:
        currency = await route_currency(ctx.db, args.origin)
    except ValueError:
        raise ToolError("not_found", f"Unknown airport code {args.origin}.") from None
    days_out = (args.depart_date - ctx.today()).days
    baseline: Baseline | None = None
    family: Family
    for family in ("market", "sandbox"):
        baseline = await compute_baseline(
            ctx.db,
            origin=args.origin,
            destination=args.destination,
            cabin=args.cabin,
            currency=currency,
            days_to_departure=days_out,
            family=family,
        )
        if baseline is not None:
            break
    if baseline is None:
        note = "Not enough fare history for this route yet."
    else:
        note = (
            f"Per-traveller fares seen for this route in the last {baseline.window_days} days,"
            " booked about as far ahead: low is the 25th percentile, high the 75th."
        )
        if baseline.family == "sandbox":
            note += " Sandbox fares: illustrative only."
    return {
        "route": {
            "origin": args.origin,
            "destination": args.destination,
            **date_fields("depart_date", args.depart_date),
            "cabin": args.cabin,
        },
        "currency": currency,
        "days_to_departure": days_out,
        "baseline": _baseline(baseline) if baseline else None,
        "note": note,
    }
