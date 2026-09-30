"""Quotes: frozen versions built from offers the agency was shown, server-side markup, share
links and decisions. Schemas, service and /api/v1/quotes router.

A quote has one currency; every option in a version must be billed natively in it. Sell prices
are always computed here from the cached offer's total and the markup, never taken from the
client. Share tokens are returned once, on send, and stored only as their sha256.

Lifecycle: draft → sent (→ viewed, by the public page) → accepted | declined | expired.
Re-sending (from sent, viewed or expired) rotates the share token. The enquiry follows along
where its pipeline allows: new → quoting on the first quote, → quoted on send, → won on accept,
→ lost on decline (unless another of its quotes is still open).
"""

from collections.abc import Sequence
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query, status
from pydantic import AfterValidator, BaseModel, Field, StringConstraints, model_validator
from redis.asyncio import Redis
from sqlalchemy import ColumnElement, Select, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.cache import RedisClient
from travelmind.db import DbSession, utcnow
from travelmind.identity import service as identity_service
from travelmind.identity.deps import AuthedUser
from travelmind.identity.tokens import hash_token, new_token
from travelmind.offers.cache import recall_offer
from travelmind.offers.money import CurrencyCode
from travelmind.offers.schemas import OfferView
from travelmind.offers.service import offer_view
from travelmind.workspace._common import NO_NUL, WorkspaceError, http_error
from travelmind.workspace.activity import ActivityKind, record_activity
from travelmind.workspace.counters import format_number, next_number
from travelmind.workspace.enquiries import (
    ALLOWED,
    CLOSED_STATUSES,
    load_enquiry,
    set_enquiry_status,
)
from travelmind.workspace.models import Client, Enquiry, Quote, QuoteVersion

__all__ = [
    "MAX_OPTIONS",
    "SHARE_TTL",
    "QuoteCreate",
    "QuoteDecision",
    "QuoteDetail",
    "QuoteError",
    "QuoteList",
    "QuoteSent",
    "QuoteStatus",
    "QuoteSummary",
    "QuoteVersionCreate",
    "add_version",
    "add_version_from_views",
    "apply_markup",
    "create_quote",
    "decide_quote",
    "get_quote",
    "list_quotes",
    "load_quote",
    "quotes_router",
    "send_quote",
]

QuoteStatus = Literal["draft", "sent", "viewed", "accepted", "declined", "expired"]
DecisionStatus = Literal["accepted", "declined", "expired"]
MarkupKind = Literal["percent", "fixed"]

MAX_OPTIONS = 3
MAX_MESSAGE = 4000
MAX_PERCENT_BP = 10_000  # basis points: 10000 = 100%
MAX_FIXED_MINOR = 10**9
SHARE_TTL = timedelta(days=14)
SHARE_PATH = "/q/"
DECLINED_REASON = "Quote declined"
# Quotes that can still be revised and (re-)sent; accepted and declined are final.
_REVISABLE = frozenset({"draft", "sent", "viewed", "expired"})
_DECIDABLE = frozenset({"sent", "viewed"})
_OPEN = frozenset({"draft", "sent", "viewed"})

NOT_FOUND_MESSAGE = "Quote not found."
ENQUIRY_CLOSED_MESSAGE = "This enquiry is closed. Reopen it before quoting."
NO_VERSION_MESSAGE = "Add at least one version before sending this quote."
QUOTE_CLOSED_MESSAGE = "This quote was already {status}, so it can't be changed."
NOT_SENT_MESSAGE = "Only a sent quote can be marked {status}."
PERCENT_MESSAGE = "A percentage markup must be between 0 and 100% (0–10000 basis points)."
FIXED_MESSAGE = f"A fixed markup must be between 0 and {MAX_FIXED_MINOR} minor units."
OPTIONS_MESSAGE = f"A version needs 1 to {MAX_OPTIONS} different offers."
MARKUPS_LENGTH_MESSAGE = "Give one markup per offer (or leave it empty)."


def apply_markup(total_minor: int, kind: str, value: int) -> int:
    """The markup on an option, in minor units: `percent` takes `value` basis points of the
    total, rounded half-up to a whole minor unit; `fixed` is `value` itself."""
    if kind == "fixed":
        return value
    share = Decimal(total_minor) * Decimal(value) / Decimal(MAX_PERCENT_BP)
    return int(share.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def markup_problem(kind: str, value: int) -> str | None:
    if kind == "percent" and not 0 <= value <= MAX_PERCENT_BP:
        return PERCENT_MESSAGE
    if kind == "fixed" and not 0 <= value <= MAX_FIXED_MINOR:
        return FIXED_MESSAGE
    return None


def _unique(ids: list[str]) -> list[str]:
    if len(set(ids)) != len(ids):
        raise ValueError(OPTIONS_MESSAGE)
    return ids


OfferId = Annotated[str, StringConstraints(min_length=1, max_length=1000)]
OfferIds = Annotated[
    list[OfferId], Field(min_length=1, max_length=MAX_OPTIONS), AfterValidator(_unique)
]
Message = Annotated[str, StringConstraints(max_length=MAX_MESSAGE, pattern=NO_NUL)]
MarkupValue = Annotated[int, Field(ge=0, le=MAX_FIXED_MINOR)]


class QuoteCreate(BaseModel):
    enquiry_id: UUID
    currency: CurrencyCode | None = None  # the agency's currency when omitted
    markup_kind: MarkupKind = "percent"
    markup_value: MarkupValue = 0

    @model_validator(mode="after")
    def _markup_in_range(self) -> "QuoteCreate":
        problem = markup_problem(self.markup_kind, self.markup_value)
        if problem:
            raise ValueError(problem)
        return self


class QuoteVersionCreate(BaseModel):
    offer_ids: OfferIds
    message: Message = ""
    # Per-option override of the quote's markup, in the quote's markup kind; None keeps it.
    option_markups: list[MarkupValue | None] | None = None

    @model_validator(mode="after")
    def _one_markup_per_offer(self) -> "QuoteVersionCreate":
        if self.option_markups is not None and len(self.option_markups) != len(self.offer_ids):
            raise ValueError(MARKUPS_LENGTH_MESSAGE)
        return self


class QuoteDecision(BaseModel):
    status: DecisionStatus


class ClientRef(BaseModel):
    id: UUID
    name: str


class EnquiryRef(BaseModel):
    id: UUID
    number: str
    origin: str | None
    destination: str | None
    depart_date: date | None


class QuoteSummary(BaseModel):
    id: UUID
    number: str
    status: str
    currency: str
    client: ClientRef | None
    enquiry: EnquiryRef
    current_version: int
    min_sell_minor: int | None
    sent_at: datetime | None
    created_at: datetime


class QuoteVersionOut(BaseModel):
    version: int
    message: str
    options: list[dict[str, Any]]
    totals: dict[str, Any]
    created_at: datetime
    created_by: UUID | None


class QuoteDetail(QuoteSummary):
    markup_kind: str
    markup_value: int
    share_expires_at: datetime | None
    first_viewed_at: datetime | None
    decided_at: datetime | None
    versions: list[QuoteVersionOut]


class QuoteList(BaseModel):
    items: list[QuoteSummary]
    total: int


class QuoteSent(BaseModel):
    share_url: str
    token: str
    expires_at: datetime


class QuoteError(WorkspaceError):
    pass


class QuoteNotFound(QuoteError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self) -> None:
        super().__init__(NOT_FOUND_MESSAGE)


class InvalidQuote(QuoteError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT


class QuoteConflict(QuoteError):
    status_code = status.HTTP_409_CONFLICT


def _label(quote: Quote) -> str:
    return format_number("quote", quote.number)


async def _log(
    db: AsyncSession,
    quote: Quote,
    kind: ActivityKind,
    summary: str,
    actor_user_id: UUID | None,
    at: datetime,
    data: dict[str, str | int] | None = None,
) -> None:
    await record_activity(
        db,
        agency_id=quote.agency_id,
        kind=kind,
        summary=summary,
        actor_user_id=actor_user_id,
        entity_type="quote",
        entity_id=quote.id,
        data=data,
        occurred_at=at,
    )


async def _move_enquiry_if_allowed(
    db: AsyncSession,
    enquiry_id: UUID,
    from_statuses: frozenset[str],
    to_status: str,
    actor_user_id: UUID | None,
    at: datetime,
    *,
    lost_reason: str | None = None,
) -> None:
    """Move the enquiry along with its quote, but only from `from_statuses` and only when the
    pipeline allows it; otherwise leave it where the agent put it."""
    enquiry = await load_enquiry(db, enquiry_id, for_update=True)
    if enquiry.status in from_statuses and to_status in ALLOWED[enquiry.status]:
        await set_enquiry_status(
            db, enquiry, to_status, actor_user_id, lost_reason=lost_reason, now=at
        )


async def load_quote(db: AsyncSession, quote_id: UUID, *, for_update: bool = False) -> Quote:
    """The quote (row-locked when `for_update`), or QuoteNotFound. RLS scopes it to the
    session's agency."""
    query = select(Quote).where(Quote.id == quote_id)
    if for_update:
        query = query.with_for_update()
    quote = await db.scalar(query)
    if quote is None:
        raise QuoteNotFound
    return quote


async def create_quote(
    db: AsyncSession,
    agency_id: UUID,
    actor_user_id: UUID | None,
    data: QuoteCreate,
    *,
    now: datetime | None = None,
) -> Quote:
    """Start a draft quote (next Q-number, no versions yet) for an open enquiry, moving a `new`
    enquiry to `quoting`. The session must be bound to the agency; the caller commits."""
    enquiry = await load_enquiry(db, data.enquiry_id, for_update=True)
    if enquiry.status in CLOSED_STATUSES:
        raise QuoteConflict(ENQUIRY_CLOSED_MESSAGE)
    currency = data.currency or (await identity_service.get_agency(db, agency_id)).currency
    at = now or utcnow()
    number = await next_number(db, agency_id, "quote")
    quote = Quote(
        agency_id=agency_id,
        enquiry_id=enquiry.id,
        client_id=enquiry.client_id,
        number=number,
        status="draft",
        current_version=0,
        currency=currency,
        markup_kind=data.markup_kind,
        markup_value=data.markup_value,
        created_by=actor_user_id,
        created_at=at,
        updated_at=at,
    )
    db.add(quote)
    await db.flush()
    enquiry_label = format_number("enquiry", enquiry.number)
    await _log(
        db,
        quote,
        "quote.created",
        f"New quote {_label(quote)} for {enquiry_label}",
        actor_user_id,
        at,
    )
    if enquiry.status == "new":
        await set_enquiry_status(db, enquiry, "quoting", actor_user_id, now=at)
    return quote


def _check_revisable(quote: Quote) -> None:
    if quote.status not in _REVISABLE:
        raise QuoteConflict(QUOTE_CLOSED_MESSAGE.format(status=quote.status))


async def add_version_from_views(
    db: AsyncSession,
    quote: Quote,
    views: Sequence[OfferView],
    message: str,
    actor_user_id: UUID | None,
    *,
    option_markups: Sequence[int | None] | None = None,
    now: datetime | None = None,
) -> QuoteVersion:
    """Freeze a new version from these offers: each option keeps the offer as shown plus its
    markup and sell price in the quote's currency. Lock the quote (`load_quote(...,
    for_update=True)`) first; the caller commits."""
    _check_revisable(quote)
    if not 1 <= len(views) <= MAX_OPTIONS or len({v.id for v in views}) != len(views):
        raise InvalidQuote(OPTIONS_MESSAGE)
    markups = list(option_markups) if option_markups is not None else [None] * len(views)
    if len(markups) != len(views):
        raise InvalidQuote(MARKUPS_LENGTH_MESSAGE)
    options: list[dict[str, Any]] = []
    for view, override in zip(views, markups, strict=True):
        if view.total.currency != quote.currency:
            raise InvalidQuote(
                f"Offer {view.id} is priced in {view.total.currency}; "
                f"this quote is in {quote.currency}."
            )
        value = quote.markup_value if override is None else override
        problem = markup_problem(quote.markup_kind, value)
        if problem:
            raise InvalidQuote(problem)
        markup = apply_markup(view.total.amount_minor, quote.markup_kind, value)
        options.append(
            {
                "offer": view.model_dump(mode="json"),
                "markup_minor": markup,
                "sell": {
                    "amount_minor": view.total.amount_minor + markup,
                    "currency": quote.currency,
                },
            }
        )
    sells = [option["sell"]["amount_minor"] for option in options]
    at = now or utcnow()
    quote.current_version += 1
    quote.updated_at = at
    version = QuoteVersion(
        agency_id=quote.agency_id,
        quote_id=quote.id,
        version=quote.current_version,
        message=message,
        options=options,
        totals={
            "currency": quote.currency,
            "min_sell_minor": min(sells),
            "max_sell_minor": max(sells),
            "options": len(options),
        },
        created_by=actor_user_id,
        created_at=at,
    )
    db.add(version)
    await db.flush()
    await _log(
        db,
        quote,
        "quote.version_added",
        f"{_label(quote)} version {version.version} ({len(options)} options)",
        actor_user_id,
        at,
        {"version": version.version, "options": len(options)},
    )
    return version


async def add_version(
    db: AsyncSession,
    redis: Redis,
    quote: Quote,
    data: QuoteVersionCreate,
    actor_user_id: UUID | None,
    *,
    now: datetime | None = None,
) -> QuoteVersion:
    """Add a version from offers this agency was recently shown (the per-agency offer cache)."""
    _check_revisable(quote)
    views: list[OfferView] = []
    for offer_id in data.offer_ids:
        offer = await recall_offer(redis, quote.agency_id, offer_id)
        if offer is None:
            raise InvalidQuote(f"Offer {offer_id} is no longer available. Run the search again.")
        views.append(offer_view(offer, offer.total, None))
    return await add_version_from_views(
        db,
        quote,
        views,
        data.message,
        actor_user_id,
        option_markups=data.option_markups,
        now=now,
    )


async def send_quote(
    db: AsyncSession, quote: Quote, actor_user_id: UUID | None, *, now: datetime | None = None
) -> str:
    """Issue a fresh share token (replacing any earlier one) valid for SHARE_TTL and mark the
    quote sent; the enquiry moves to `quoted`. Returns the token: it is never stored or shown
    again. Lock the quote first; the caller commits."""
    _check_revisable(quote)
    if quote.current_version < 1:
        raise QuoteConflict(NO_VERSION_MESSAGE)
    at = now or utcnow()
    token = new_token()
    quote.share_token_hash = hash_token(token)
    quote.share_expires_at = at + SHARE_TTL
    quote.status = "sent"
    quote.sent_at = quote.sent_at or at
    quote.updated_at = at
    await db.flush()
    await _log(
        db,
        quote,
        "quote.sent",
        f"{_label(quote)} sent",
        actor_user_id,
        at,
        {"version": quote.current_version},
    )
    await _move_enquiry_if_allowed(
        db, quote.enquiry_id, frozenset({"new", "quoting"}), "quoted", actor_user_id, at
    )
    return token


_DECISION_KIND: dict[str, ActivityKind] = {
    "accepted": "quote.accepted",
    "declined": "quote.declined",
    "expired": "quote.expired",
}


async def _other_open_quotes(db: AsyncSession, quote: Quote) -> bool:
    return bool(
        await db.scalar(
            select(
                exists().where(
                    Quote.enquiry_id == quote.enquiry_id,
                    Quote.id != quote.id,
                    Quote.status.in_(_OPEN),
                )
            )
        )
    )


async def decide_quote(
    db: AsyncSession,
    quote: Quote,
    to_status: str,
    actor_user_id: UUID | None,
    *,
    now: datetime | None = None,
) -> None:
    """Record the client's decision on a sent quote (accepted, declined or expired).

    Accepting wins the enquiry; declining loses it ("Quote declined") unless another of its
    quotes is still open. Lock the quote first; the caller commits.
    """
    if to_status not in _DECISION_KIND:
        raise InvalidQuote(f"A quote can't be marked {to_status}.")
    if quote.status not in _DECIDABLE:
        if quote.status in _REVISABLE:
            raise QuoteConflict(NOT_SENT_MESSAGE.format(status=to_status))
        raise QuoteConflict(QUOTE_CLOSED_MESSAGE.format(status=quote.status))
    at = now or utcnow()
    quote.status = to_status
    quote.decided_at = at
    quote.updated_at = at
    await db.flush()
    await _log(
        db, quote, _DECISION_KIND[to_status], f"{_label(quote)} {to_status}", actor_user_id, at
    )
    if to_status == "accepted":
        await _move_enquiry_if_allowed(
            db, quote.enquiry_id, frozenset({"quoted"}), "won", actor_user_id, at
        )
    elif to_status == "declined" and not await _other_open_quotes(db, quote):
        await _move_enquiry_if_allowed(
            db,
            quote.enquiry_id,
            frozenset({"new", "quoting", "quoted"}),
            "lost",
            actor_user_id,
            at,
            lost_reason=DECLINED_REASON,
        )


# --- reads ------------------------------------------------------------------------------------

_MIN_SELL = QuoteVersion.totals["min_sell_minor"].as_integer()


def _with_details() -> Select[Quote, Enquiry, str | None, int | None]:
    return (
        select(Quote, Enquiry, Client.name, _MIN_SELL)
        .join(Enquiry, Enquiry.id == Quote.enquiry_id)
        .outerjoin(Client, Client.id == Quote.client_id)
        .outerjoin(
            QuoteVersion,
            (QuoteVersion.quote_id == Quote.id) & (QuoteVersion.version == Quote.current_version),
        )
    )


def _summary_fields(
    quote: Quote, enquiry: Enquiry, client_name: str | None, min_sell: int | None
) -> dict[str, Any]:
    client = (
        ClientRef(id=quote.client_id, name=client_name)
        if quote.client_id is not None and client_name is not None
        else None
    )
    return {
        "id": quote.id,
        "number": _label(quote),
        "status": quote.status,
        "currency": quote.currency,
        "client": client,
        "enquiry": EnquiryRef(
            id=enquiry.id,
            number=format_number("enquiry", enquiry.number),
            origin=enquiry.origin,
            destination=enquiry.destination,
            depart_date=enquiry.depart_date,
        ),
        "current_version": quote.current_version,
        "min_sell_minor": min_sell,
        "sent_at": quote.sent_at,
        "created_at": quote.created_at,
    }


def _filters(
    status_: str | None, client_id: UUID | None, enquiry_id: UUID | None
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []
    if status_:
        conditions.append(Quote.status == status_)
    if client_id:
        conditions.append(Quote.client_id == client_id)
    if enquiry_id:
        conditions.append(Quote.enquiry_id == enquiry_id)
    return conditions


async def list_quotes(
    db: AsyncSession,
    *,
    status_: str | None = None,
    client_id: UUID | None = None,
    enquiry_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> QuoteList:
    """Newest first; `min_sell_minor` is the cheapest option of the current version."""
    conditions = _filters(status_, client_id, enquiry_id)
    total = await db.scalar(select(func.count()).select_from(Quote).where(*conditions))
    rows = (
        await db.execute(
            _with_details()
            .where(*conditions)
            .order_by(Quote.created_at.desc(), Quote.number.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return QuoteList(
        items=[QuoteSummary(**_summary_fields(*row)) for row in rows], total=total or 0
    )


async def get_quote(db: AsyncSession, quote_id: UUID) -> QuoteDetail:
    """The quote with all its versions, newest first. Never includes the share token hash."""
    row = (await db.execute(_with_details().where(Quote.id == quote_id))).one_or_none()
    if row is None:
        raise QuoteNotFound
    quote = row[0]
    versions = (
        await db.scalars(
            select(QuoteVersion)
            .where(QuoteVersion.quote_id == quote.id)
            .order_by(QuoteVersion.version.desc())
        )
    ).all()
    return QuoteDetail(
        **_summary_fields(*row),
        markup_kind=quote.markup_kind,
        markup_value=quote.markup_value,
        share_expires_at=quote.share_expires_at,
        first_viewed_at=quote.first_viewed_at,
        decided_at=quote.decided_at,
        versions=[
            QuoteVersionOut(
                version=v.version,
                message=v.message,
                options=v.options,
                totals=v.totals,
                created_at=v.created_at,
                created_by=v.created_by,
            )
            for v in versions
        ],
    )


# --- router -----------------------------------------------------------------------------------

quotes_router = APIRouter(prefix="/api/v1/quotes", tags=["quotes"])


@quotes_router.get("")
async def list_quotes_route(
    current: AuthedUser,
    db: DbSession,
    status_: Annotated[QuoteStatus | None, Query(alias="status")] = None,
    client_id: UUID | None = None,
    enquiry_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> QuoteList:
    return await list_quotes(
        db,
        status_=status_,
        client_id=client_id,
        enquiry_id=enquiry_id,
        limit=limit,
        offset=offset,
    )


@quotes_router.post("", status_code=status.HTTP_201_CREATED)
async def create_quote_route(body: QuoteCreate, current: AuthedUser, db: DbSession) -> QuoteDetail:
    try:
        quote = await create_quote(db, current.agency_id, current.id, body)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_quote(db, quote.id)


@quotes_router.get("/{quote_id}")
async def get_quote_route(quote_id: UUID, current: AuthedUser, db: DbSession) -> QuoteDetail:
    try:
        return await get_quote(db, quote_id)
    except WorkspaceError as exc:
        raise http_error(exc) from None


@quotes_router.post("/{quote_id}/versions", status_code=status.HTTP_201_CREATED)
async def add_version_route(
    quote_id: UUID,
    body: QuoteVersionCreate,
    current: AuthedUser,
    db: DbSession,
    redis: RedisClient,
) -> QuoteDetail:
    try:
        quote = await load_quote(db, quote_id, for_update=True)
        await add_version(db, redis, quote, body, current.id)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_quote(db, quote_id)


@quotes_router.post("/{quote_id}/send")
async def send_quote_route(quote_id: UUID, current: AuthedUser, db: DbSession) -> QuoteSent:
    try:
        quote = await load_quote(db, quote_id, for_update=True)
        token = await send_quote(db, quote, current.id)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    expires_at = quote.share_expires_at
    await db.commit()
    assert expires_at is not None
    return QuoteSent(share_url=f"{SHARE_PATH}{token}", token=token, expires_at=expires_at)


@quotes_router.post("/{quote_id}/status")
async def decide_quote_route(
    quote_id: UUID, body: QuoteDecision, current: AuthedUser, db: DbSession
) -> QuoteDetail:
    try:
        quote = await load_quote(db, quote_id, for_update=True)
        await decide_quote(db, quote, body.status, current.id)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_quote(db, quote_id)
