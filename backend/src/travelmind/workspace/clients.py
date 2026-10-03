"""Agency clients (travellers and companies): schemas, service and /api/v1/clients router.

Each client read carries its stats in the agency currency:
- `won_value_minor`: the sum over the client's accepted quotes in that currency of the option the
  client accepted on the public page, from the version they were sent (`sent_version`); a quote
  the agent marked accepted (no option recorded) counts its sent version's cheapest option.
- `last_trip` / `next_trip`: among the client's enquiries that aren't lost and have an origin,
  destination and departure date, the one with the latest departure on or before today (the
  agency's local date), and the one with the earliest departure after today. Same-day ties go to
  the most recently created enquiry, then the highest number.
"""

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query, Response, status
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    model_validator,
)
from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Row,
    Select,
    String,
    cast,
    exists,
    func,
    or_,
    select,
    true,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.selectable import LateralFromClause

from travelmind.db import DbSession, utcnow
from travelmind.identity import service as identity_service
from travelmind.identity.deps import AuthedUser
from travelmind.identity.schemas import NormalizedEmail, PersonName
from travelmind.workspace._common import (
    SINGLE_LINE,
    Notes,
    OptionalAirport,
    WorkspaceError,
    blank_to_none,
    check_airport,
    escape_like,
    http_error,
    strip_lower,
)
from travelmind.workspace.activity import record_activity
from travelmind.workspace.models import Client, Enquiry, Quote, QuoteVersion

__all__ = [
    "ClientCreate",
    "ClientError",
    "ClientList",
    "ClientNotFound",
    "ClientOut",
    "ClientUpdate",
    "TripRef",
    "clients_router",
    "create_client",
    "delete_client",
    "get_client",
    "list_clients",
    "update_client",
]

NOT_FOUND_MESSAGE = "Client not found."
DUPLICATE_EMAIL_MESSAGE = "A client with this email already exists."
HAS_QUOTES_MESSAGE = "This client has quotes, so it can't be deleted."
MAX_TAGS = 10


def _dedupe(tags: list[str]) -> list[str]:
    return list(dict.fromkeys(tags))


ClientKind = Literal["individual", "company"]
Tag = Annotated[
    str,
    BeforeValidator(strip_lower),
    StringConstraints(min_length=1, max_length=40, pattern=r"^[^\x00-\x1f\x7f]+$"),
]
Tags = Annotated[list[Tag], Field(max_length=MAX_TAGS), AfterValidator(_dedupe)]
OptionalEmail = Annotated[NormalizedEmail | None, BeforeValidator(blank_to_none)]
Phone = Annotated[
    Annotated[str, StringConstraints(max_length=40, pattern=SINGLE_LINE)] | None,
    BeforeValidator(blank_to_none),
]
CompanyName = Annotated[
    Annotated[str, StringConstraints(max_length=200, pattern=SINGLE_LINE)] | None,
    BeforeValidator(blank_to_none),
]


class ClientCreate(BaseModel):
    kind: ClientKind = "individual"
    name: PersonName
    email: OptionalEmail = None
    phone: Phone = None
    company_name: CompanyName = None
    home_airport: OptionalAirport = None
    notes: Notes = None
    tags: Tags = []


class ClientUpdate(BaseModel):
    """Partial update: omitted fields are left alone; optional fields may be cleared with null."""

    kind: ClientKind | None = None
    name: PersonName | None = None
    email: OptionalEmail = None
    phone: Phone = None
    company_name: CompanyName = None
    home_airport: OptionalAirport = None
    notes: Notes = None
    tags: Tags | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> "ClientUpdate":
        for field in ("kind", "name", "tags"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} can't be empty.")
        return self


class TripRef(BaseModel):
    origin: str
    destination: str
    depart_date: date


class ClientOut(BaseModel):
    id: UUID
    kind: str
    name: str
    email: str | None
    phone: str | None
    company_name: str | None
    home_airport: str | None
    notes: str | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    enquiry_count: int
    quote_count: int
    won_value_minor: int
    currency: str
    last_trip: TripRef | None
    next_trip: TripRef | None


_STAT_FIELDS = (
    "enquiry_count",
    "quote_count",
    "won_value_minor",
    "currency",
    "last_trip",
    "next_trip",
)
_CLIENT_FIELDS = tuple(f for f in ClientOut.model_fields if f not in _STAT_FIELDS)


class ClientList(BaseModel):
    items: list[ClientOut]
    total: int


class ClientError(WorkspaceError):
    pass


class ClientNotFound(ClientError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self) -> None:
        super().__init__(NOT_FOUND_MESSAGE)


class DuplicateEmail(ClientError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self) -> None:
        super().__init__(DUPLICATE_EMAIL_MESSAGE)


class ClientHasQuotes(ClientError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self) -> None:
        super().__init__(HAS_QUOTES_MESSAGE)


_ENQUIRY_COUNT = (
    select(func.count(Enquiry.id))
    .where(Enquiry.client_id == Client.id)
    .correlate(Client)
    .scalar_subquery()
)
_QUOTE_COUNT = (
    select(func.count(Quote.id))
    .where(Quote.client_id == Client.id)
    .correlate(Client)
    .scalar_subquery()
)


# The accepted option's sell price in the sent version, else (agent-marked) its cheapest option.
_ACCEPTED_SELL = func.coalesce(
    cast(
        func.jsonb_extract_path_text(
            QuoteVersion.options, cast(Quote.accepted_option, String), "sell", "amount_minor"
        ),
        BigInteger,
    ),
    QuoteVersion.totals["min_sell_minor"].as_integer(),
)


def _won_value(currency: str) -> ColumnElement[int]:
    return (
        select(cast(func.coalesce(func.sum(_ACCEPTED_SELL), 0), BigInteger))
        .select_from(Quote)
        .join(
            QuoteVersion,
            (QuoteVersion.quote_id == Quote.id) & (QuoteVersion.version == Quote.sent_version),
        )
        .where(Quote.client_id == Client.id, Quote.status == "accepted", Quote.currency == currency)
        .correlate(Client)
        .scalar_subquery()
    )


def _trip(today: date, *, upcoming: bool) -> LateralFromClause:
    """The client's last trip (departing on or before `today`) or next one (after `today`)."""
    when = Enquiry.depart_date > today if upcoming else Enquiry.depart_date <= today
    return (
        select(Enquiry.origin, Enquiry.destination, Enquiry.depart_date)
        .where(
            Enquiry.client_id == Client.id,
            Enquiry.status != "lost",
            Enquiry.origin.is_not(None),
            Enquiry.destination.is_not(None),
            Enquiry.depart_date.is_not(None),
            when,
        )
        .order_by(
            Enquiry.depart_date.asc() if upcoming else Enquiry.depart_date.desc(),
            Enquiry.created_at.desc(),
            Enquiry.number.desc(),
        )
        .limit(1)
        .correlate(Client)
        .lateral("next_trip" if upcoming else "last_trip")
    )


_TripCols = tuple[str | None, str | None, date | None]
_StatsRow = Row[
    Client, int, int, int, str | None, str | None, date | None, str | None, str | None, date | None
]


def _with_stats(
    currency: str, today: date
) -> Select[
    Client, int, int, int, str | None, str | None, date | None, str | None, str | None, date | None
]:
    """Each client with its stats, in one statement (lateral trip lookups, no per-row queries)."""
    last, upcoming = _trip(today, upcoming=False), _trip(today, upcoming=True)
    return (
        select(
            Client,
            _ENQUIRY_COUNT,
            _QUOTE_COUNT,
            _won_value(currency),
            last.c.origin,
            last.c.destination,
            last.c.depart_date,
            upcoming.c.origin,
            upcoming.c.destination,
            upcoming.c.depart_date,
        )
        .outerjoin_from(Client, last, true())
        .outerjoin_from(Client, upcoming, true())
    )


def _trip_ref(cols: _TripCols) -> TripRef | None:
    origin, destination, depart_date = cols
    if origin is None or destination is None or depart_date is None:
        return None
    return TripRef(origin=origin, destination=destination, depart_date=depart_date)


def _to_out(row: _StatsRow, currency: str) -> ClientOut:
    client, enquiry_count, quote_count, won_value = row[:4]
    fields = {name: getattr(client, name) for name in _CLIENT_FIELDS}
    return ClientOut(
        **fields,
        enquiry_count=enquiry_count,
        quote_count=quote_count,
        won_value_minor=int(won_value),
        currency=currency,
        last_trip=_trip_ref((row[4], row[5], row[6])),
        next_trip=_trip_ref((row[7], row[8], row[9])),
    )


async def _stats_context(db: AsyncSession, agency_id: UUID) -> tuple[str, date]:
    """The agency's currency and today's date in its time zone."""
    agency = await identity_service.get_agency_settings(db, agency_id)
    return agency.currency, utcnow().astimezone(ZoneInfo(agency.timezone)).date()


async def _check_email_free(db: AsyncSession, email: str | None, *, exclude: UUID | None) -> None:
    if email is None:
        return
    query = select(Client.id).where(func.lower(Client.email) == email.lower())
    if exclude is not None:
        query = query.where(Client.id != exclude)
    if await db.scalar(query) is not None:
        raise DuplicateEmail


async def _flush_client(db: AsyncSession, client: Client) -> None:
    """Flush in a savepoint so a racing duplicate email becomes a clean 409."""
    try:
        async with db.begin_nested():
            db.add(client)
    except IntegrityError as exc:
        raise DuplicateEmail from exc


async def _load(db: AsyncSession, client_id: UUID) -> Client:
    client = await db.scalar(select(Client).where(Client.id == client_id))
    if client is None:
        raise ClientNotFound
    return client


async def create_client(
    db: AsyncSession,
    agency_id: UUID,
    actor_user_id: UUID | None,
    data: ClientCreate,
    *,
    now: datetime | None = None,
) -> Client:
    """Add a client and its `client.created` activity. The session must be bound to the agency;
    the caller commits."""
    await check_airport(db, data.home_airport)
    await _check_email_free(db, data.email, exclude=None)
    at = now or utcnow()
    client = Client(
        agency_id=agency_id,
        created_by=actor_user_id,
        created_at=at,
        updated_at=at,
        **data.model_dump(),
    )
    await _flush_client(db, client)
    await record_activity(
        db,
        agency_id=agency_id,
        kind="client.created",
        summary=f"Added client {client.name}",
        actor_user_id=actor_user_id,
        entity_type="client",
        entity_id=client.id,
        occurred_at=at,
    )
    return client


def _filters(q: str | None, tag: str | None) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []
    if q:
        pattern = f"%{escape_like(q)}%"
        conditions.append(
            or_(
                Client.name.ilike(pattern, escape="\\"),
                Client.email.ilike(pattern, escape="\\"),
                Client.company_name.ilike(pattern, escape="\\"),
            )
        )
    if tag:
        conditions.append(Client.tags.contains([tag]))
    return conditions


async def list_clients(
    db: AsyncSession,
    *,
    agency_id: UUID,
    q: str | None = None,
    tag: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ClientList:
    conditions = _filters(q.strip() if q else None, tag.strip().lower() if tag else None)
    total = await db.scalar(select(func.count()).select_from(Client).where(*conditions))
    currency, today = await _stats_context(db, agency_id)
    rows = await db.execute(
        _with_stats(currency, today)
        .where(*conditions)
        .order_by(Client.updated_at.desc(), Client.id)
        .limit(limit)
        .offset(offset)
    )
    return ClientList(items=[_to_out(row, currency) for row in rows], total=total or 0)


async def get_client(db: AsyncSession, client_id: UUID, *, agency_id: UUID) -> ClientOut:
    """The client with its counts and stats (see the module docstring), or ClientNotFound."""
    currency, today = await _stats_context(db, agency_id)
    row = (
        await db.execute(_with_stats(currency, today).where(Client.id == client_id))
    ).one_or_none()
    if row is None:
        raise ClientNotFound
    return _to_out(row, currency)


async def update_client(
    db: AsyncSession, client_id: UUID, actor_user_id: UUID | None, data: ClientUpdate
) -> ClientOut:
    client = await _load(db, client_id)
    changes: dict[str, Any] = {
        field: value
        for field, value in data.model_dump(exclude_unset=True).items()
        if getattr(client, field) != value
    }
    if changes:
        if "home_airport" in changes:
            await check_airport(db, changes["home_airport"])
        if "email" in changes:
            await _check_email_free(db, changes["email"], exclude=client.id)
        for field, value in changes.items():
            setattr(client, field, value)
        client.updated_at = utcnow()
        await _flush_client(db, client)
        await record_activity(
            db,
            agency_id=client.agency_id,
            kind="client.updated",
            summary=f"Updated client {client.name}",
            actor_user_id=actor_user_id,
            entity_type="client",
            entity_id=client.id,
            data={"fields": sorted(changes)},
        )
    return await get_client(db, client_id, agency_id=client.agency_id)


async def delete_client(db: AsyncSession, client_id: UUID, actor_user_id: UUID | None) -> None:
    client = await _load(db, client_id)
    if await db.scalar(select(exists().where(Quote.client_id == client.id))):
        raise ClientHasQuotes
    await db.delete(client)
    await record_activity(
        db,
        agency_id=client.agency_id,
        kind="client.deleted",
        summary=f"Removed client {client.name}",
        actor_user_id=actor_user_id,
        entity_type="client",
        entity_id=client.id,
    )
    await db.flush()


clients_router = APIRouter(prefix="/api/v1/clients", tags=["clients"])


@clients_router.get("")
async def list_clients_route(
    current: AuthedUser,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    tag: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ClientList:
    return await list_clients(
        db, agency_id=current.agency_id, q=q, tag=tag, limit=limit, offset=offset
    )


@clients_router.post("", status_code=status.HTTP_201_CREATED)
async def create_client_route(body: ClientCreate, current: AuthedUser, db: DbSession) -> ClientOut:
    try:
        client = await create_client(db, current.agency_id, current.id, body)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_client(db, client.id, agency_id=current.agency_id)


@clients_router.get("/{client_id}")
async def get_client_route(client_id: UUID, current: AuthedUser, db: DbSession) -> ClientOut:
    try:
        return await get_client(db, client_id, agency_id=current.agency_id)
    except WorkspaceError as exc:
        raise http_error(exc) from None


@clients_router.patch("/{client_id}")
async def update_client_route(
    client_id: UUID, body: ClientUpdate, current: AuthedUser, db: DbSession
) -> ClientOut:
    try:
        client = await update_client(db, client_id, current.id, body)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return client


@clients_router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_client_route(client_id: UUID, current: AuthedUser, db: DbSession) -> Response:
    try:
        await delete_client(db, client_id, current.id)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
