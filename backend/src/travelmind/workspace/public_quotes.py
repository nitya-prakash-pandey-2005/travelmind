"""The client's quote page: what they see at /q/<token>, and their accept or decline.

No sign-in. The share token is hashed and resolved to its agency by the `public_quote_agency`
definer function (exact hash match only); the session is then bound to that agency and the
quote is read under RLS as usual. Unknown, rotated and malformed tokens all get the same 404.

Only the version the client was sent (`sent_version`) is shown, and only what a client should
see: carriers, times, baggage, conditions, CO2 and the sell price. Never supplier references,
costs, markups, agent details, other versions, activity or internal ids. Every request counts
against a per-network and a per-link budget; the limiter keys hold only a prefix of the token's
hash, and the token itself is never logged or stored. Every response, errors included, is sent
with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`: the page is never cached and
its URL (which is the token) never leaks to another site in a Referer.
"""

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, Strict
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession, bind_tenant, utcnow
from travelmind.identity import service as identity_service
from travelmind.identity.deps import client_ip
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.identity.tokens import hash_token
from travelmind.offers.models import Cabin
from travelmind.offers.money import Money, per_traveller_minor
from travelmind.offers.schemas import OfferView
from travelmind.readcache import InvalidatesAgencyCache, mark_agency_changed
from travelmind.workspace._common import WorkspaceError, http_error
from travelmind.workspace.activity import record_activity
from travelmind.workspace.counters import format_number
from travelmind.workspace.models import Client, Enquiry, Quote, QuoteVersion
from travelmind.workspace.quotes import decide_quote, expire_overdue_quotes

__all__ = [
    "PublicDecision",
    "PublicQuote",
    "decide_public_quote",
    "open_share_link",
    "public_quotes_router",
    "view_public_quote",
]

PublicStatus = Literal["sent", "viewed", "accepted", "declined", "expired"]
PriceLabel = Literal[
    "Indicative price — confirm with your travel agent", "Live fare at the time of quoting"
]
INDICATIVE_LABEL: PriceLabel = "Indicative price — confirm with your travel agent"
LIVE_LABEL: PriceLabel = "Live fare at the time of quoting"

INVALID_LINK_MESSAGE = "This quote link isn't valid. Ask your travel agent for a new one."
EXPIRED_MESSAGE = "This quote has expired. Ask your travel agent for a fresh one."
DECIDED_MESSAGE = "This quote has already been {status}."
CHOOSE_OPTION_MESSAGE = "Choose which option you're accepting."
NO_SUCH_OPTION_MESSAGE = "That option isn't in this quote."
RATE_LIMIT_MESSAGE = "Too many requests. Please try again in a minute."
# Share tokens are 43 characters; anything much longer is refused without hashing it.
MAX_TOKEN_LENGTH = 256
# The per-link limiter key holds this much of the token's hash (64 bits), never the token.
TOKEN_KEY_PREFIX = 16
_FINAL = frozenset({"accepted", "declined"})


# --- schemas ----------------------------------------------------------------------------------


class PublicAgency(BaseModel):
    name: str
    brand_color: str
    timezone: str  # IANA zone: the page shows dates such as the expiry in the agency's time


class PublicSegment(BaseModel):
    marketing_carrier: str
    flight_number: str
    origin: str
    destination: str
    departing_at: datetime  # local airport time, as the supplier gave it
    arriving_at: datetime


class PublicSlice(BaseModel):
    origin: str
    destination: str
    departing_at: datetime
    arriving_at: datetime
    duration_minutes: int | None
    stops: int
    segments: list[PublicSegment]


class PublicBaggage(BaseModel):
    checked: int | None
    carry_on: int | None


class PublicOption(BaseModel):
    index: int
    carrier_code: str
    carrier_name: str | None
    cabin: Cabin | None
    slices: list[PublicSlice]
    baggage: PublicBaggage
    refundable: bool | None
    changeable: bool | None
    co2_kg_per_passenger: int | None
    price_label: PriceLabel
    sell: Money
    # An even share of the sell price, only for an adults-only party of two or more.
    per_traveller: Money | None


class PublicQuote(BaseModel):
    number: str
    status: PublicStatus
    agency: PublicAgency
    client_first_name: str | None
    message: str
    options: list[PublicOption]
    currency: str
    expires_at: datetime | None
    decided_at: datetime | None
    accepted_option: int | None


class PublicDecision(BaseModel):
    decision: Literal["accept", "decline"]
    # Required to accept: the index of one of the options shown.
    option_index: Annotated[int, Strict()] | None = None


# --- errors -----------------------------------------------------------------------------------


class PublicQuoteError(WorkspaceError):
    pass


class LinkNotValid(PublicQuoteError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self) -> None:
        super().__init__(INVALID_LINK_MESSAGE)


class QuoteExpired(PublicQuoteError):
    status_code = status.HTTP_410_GONE

    def __init__(self) -> None:
        super().__init__(EXPIRED_MESSAGE)


class AlreadyDecided(PublicQuoteError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, decided: str) -> None:
        super().__init__(DECIDED_MESSAGE.format(status=decided))


class InvalidOption(PublicQuoteError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT


# --- service ----------------------------------------------------------------------------------

_AGENCY_FOR_TOKEN = text("SELECT public_quote_agency(:token_hash)")


@dataclass(frozen=True)
class ShareLink:
    agency_id: UUID
    token_hash: str


async def open_share_link(db: AsyncSession, token: str, *, now: datetime) -> ShareLink:
    """Resolve the token to its agency (LinkNotValid unless its hash matches exactly), bind the
    session to that agency and expire its overdue quotes. The caller commits."""
    if not token or len(token) > MAX_TOKEN_LENGTH:
        raise LinkNotValid
    token_hash = hash_token(token)
    agency_id = await db.scalar(_AGENCY_FOR_TOKEN, {"token_hash": token_hash})
    if agency_id is None:
        raise LinkNotValid
    await bind_tenant(db, agency_id)
    await expire_overdue_quotes(db, agency_id, now=now)
    return ShareLink(agency_id=agency_id, token_hash=token_hash)


async def _load(db: AsyncSession, link: ShareLink) -> Quote:
    """The linked quote, row-locked; LinkNotValid if the token was rotated meanwhile."""
    quote = await db.scalar(
        select(Quote).where(Quote.share_token_hash == link.token_hash).with_for_update()
    )
    if quote is None or quote.sent_version is None:
        raise LinkNotValid
    return quote


async def _sent_options(db: AsyncSession, quote: Quote) -> tuple[str, list[dict[str, Any]]]:
    version = await db.scalar(
        select(QuoteVersion).where(
            QuoteVersion.quote_id == quote.id, QuoteVersion.version == quote.sent_version
        )
    )
    if version is None:
        raise LinkNotValid
    return version.message, list(version.options)


def _price_label(provenance: str) -> PriceLabel:
    return LIVE_LABEL if provenance == "LIVE" else INDICATIVE_LABEL


def _public_option(index: int, stored: dict[str, Any], adults_only: bool) -> PublicOption:
    offer = OfferView.model_validate(stored["offer"])
    sell = Money.model_validate(stored["sell"])
    share = None
    if adults_only and offer.passenger_count > 1:
        share = Money(
            amount_minor=per_traveller_minor(sell.amount_minor, offer.passenger_count),
            currency=sell.currency,
        )
    return PublicOption(
        index=index,
        carrier_code=offer.owner_carrier,
        carrier_name=offer.owner_name,
        cabin=offer.cabin,
        slices=[
            PublicSlice(
                origin=s.origin,
                destination=s.destination,
                departing_at=s.segments[0].departing_at,
                arriving_at=s.segments[-1].arriving_at,
                duration_minutes=s.duration_minutes,
                stops=s.stops,
                segments=[
                    PublicSegment(
                        marketing_carrier=g.marketing_carrier,
                        flight_number=g.flight_number,
                        origin=g.origin,
                        destination=g.destination,
                        departing_at=g.departing_at,
                        arriving_at=g.arriving_at,
                    )
                    for g in s.segments
                ],
            )
            for s in offer.slices
            if s.segments
        ],
        baggage=PublicBaggage(checked=offer.baggage.checked, carry_on=offer.baggage.carry_on),
        refundable=offer.conditions.refundable,
        changeable=offer.conditions.changeable,
        co2_kg_per_passenger=offer.co2_kg_per_passenger,
        price_label=_price_label(offer.provenance),
        sell=sell,
        per_traveller=share,
    )


async def _first_name(db: AsyncSession, quote: Quote) -> str | None:
    """The client's first name for the greeting (individual clients only)."""
    if quote.client_id is None:
        return None
    client = await db.get(Client, quote.client_id)
    if client is None or client.kind != "individual":
        return None
    parts = client.name.split()
    return parts[0] if parts else None


async def _public_view(db: AsyncSession, quote: Quote) -> PublicQuote:
    agency = await identity_service.get_agency(db, quote.agency_id)
    message, options = await _sent_options(db, quote)
    enquiry = await db.get(Enquiry, quote.enquiry_id)
    adults_only = enquiry is not None and not enquiry.children_ages
    return PublicQuote(
        number=format_number("quote", quote.number),
        status=cast(PublicStatus, quote.status),  # a linked quote is never a draft
        agency=PublicAgency(
            name=agency.name, brand_color=agency.brand_color, timezone=agency.timezone
        ),
        client_first_name=await _first_name(db, quote),
        message=message,
        options=[_public_option(i, o, adults_only) for i, o in enumerate(options)],
        currency=quote.currency,
        expires_at=quote.share_expires_at,
        decided_at=quote.decided_at,
        accepted_option=quote.accepted_option,
    )


async def view_public_quote(db: AsyncSession, link: ShareLink, *, now: datetime) -> PublicQuote:
    """The quote as the client sees it. The first read of a sent quote marks it viewed
    ("Client opened Q-0004"). The caller commits."""
    quote = await _load(db, link)
    if quote.status == "sent":
        quote.status = "viewed"
        quote.first_viewed_at = quote.first_viewed_at or now
        quote.updated_at = now
        await db.flush()
        mark_agency_changed(db, quote.agency_id)
        await record_activity(
            db,
            agency_id=quote.agency_id,
            kind="quote.viewed",
            summary=f"Client opened {format_number('quote', quote.number)}",
            entity_type="quote",
            entity_id=quote.id,
            occurred_at=now,
        )
    return await _public_view(db, quote)


async def decide_public_quote(
    db: AsyncSession, link: ShareLink, body: PublicDecision, *, now: datetime
) -> PublicQuote:
    """Record the client's accept (of one option) or decline, with the workspace's decision
    rules (accept wins the enquiry; decline loses it unless another quote is open). Expired →
    QuoteExpired; already decided → AlreadyDecided. The caller commits."""
    quote = await _load(db, link)
    if quote.status == "expired":
        raise QuoteExpired
    if quote.status in _FINAL:
        raise AlreadyDecided(quote.status)
    _, options = await _sent_options(db, quote)
    index = body.option_index
    if body.decision == "accept" and index is None:
        raise InvalidOption(CHOOSE_OPTION_MESSAGE)
    if index is not None and not 0 <= index < len(options):
        raise InvalidOption(NO_SUCH_OPTION_MESSAGE)
    accepting = body.decision == "accept"
    await decide_quote(
        db,
        quote,
        "accepted" if accepting else "declined",
        None,
        now=now,
        accepted_option=index if accepting else None,
        data={"option_index": index},
    )
    return await _public_view(db, quote)


# --- router -----------------------------------------------------------------------------------

PRIVATE_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}


class _PrivateRoute(APIRoute):
    """Adds PRIVATE_HEADERS to every response of the route: success, HTTP errors (404, 409, 410,
    422, 429) and request-validation 422s alike."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def private(request: Request) -> Response:
            try:
                response = await handler(request)
            except StarletteHTTPException as exc:
                exc.headers = {**(exc.headers or {}), **PRIVATE_HEADERS}
                raise
            except RequestValidationError as exc:
                # Answer it here, with the app's own handler, so the headers can be added.
                on_invalid = request.app.exception_handlers.get(
                    RequestValidationError, request_validation_exception_handler
                )
                response = await on_invalid(request, exc)
            response.headers.update(PRIVATE_HEADERS)
            return response

        return private


public_quotes_router = APIRouter(
    prefix="/api/v1/public/quotes",
    tags=["public"],
    route_class=_PrivateRoute,
    dependencies=[InvalidatesAgencyCache],
)


async def _check_budget(redis: Redis, request: Request, token: str) -> None:
    """One request against the caller's network and against the link (by hash prefix)."""
    per_minute = get_settings().public_quote_max_per_minute
    limiter = LoginRateLimiter(redis, per_minute, 60)
    if not await limiter.hit(f"rl:pq:{client_ip(request) or 'unknown'}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, RATE_LIMIT_MESSAGE)
    link_key = hash_token(token[:MAX_TOKEN_LENGTH])[:TOKEN_KEY_PREFIX]
    if not await limiter.hit(f"rl:pqt:{link_key}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, RATE_LIMIT_MESSAGE)


async def _open(db: AsyncSession, token: str, now: datetime) -> ShareLink:
    """Resolve the link and keep any lazy expiry, before the request's own work."""
    try:
        link = await open_share_link(db, token, now=now)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return link


@public_quotes_router.get("/{token}")
async def view_public_quote_route(
    token: str, request: Request, db: DbSession, redis: RedisClient
) -> PublicQuote:
    await _check_budget(redis, request, token)
    now = utcnow()
    link = await _open(db, token, now)
    try:
        quote = await view_public_quote(db, link, now=now)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return quote


@public_quotes_router.post("/{token}/decision")
async def decide_public_quote_route(
    token: str, body: PublicDecision, request: Request, db: DbSession, redis: RedisClient
) -> PublicQuote:
    await _check_budget(redis, request, token)
    now = utcnow()
    link = await _open(db, token, now)
    try:
        quote = await decide_public_quote(db, link, body, now=now)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return quote
