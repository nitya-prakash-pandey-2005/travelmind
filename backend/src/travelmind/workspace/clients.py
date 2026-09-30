"""Agency clients (travellers and companies): schemas, service and /api/v1/clients router."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Response, status
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    model_validator,
)
from sqlalchemy import ColumnElement, Select, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.db import DbSession, utcnow
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
from travelmind.workspace.models import Client, Enquiry, Quote

__all__ = [
    "ClientCreate",
    "ClientError",
    "ClientList",
    "ClientOut",
    "ClientUpdate",
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


_CLIENT_FIELDS = tuple(
    f for f in ClientOut.model_fields if f not in ("enquiry_count", "quote_count")
)


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


def _with_counts() -> Select[Client, int, int]:
    return select(Client, _ENQUIRY_COUNT, _QUOTE_COUNT)


def _to_out(client: Client, enquiry_count: int, quote_count: int) -> ClientOut:
    fields = {name: getattr(client, name) for name in _CLIENT_FIELDS}
    return ClientOut(**fields, enquiry_count=enquiry_count, quote_count=quote_count)


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


async def _load(db: AsyncSession, client_id: UUID) -> tuple[Client, int, int]:
    row = (await db.execute(_with_counts().where(Client.id == client_id))).one_or_none()
    if row is None:
        raise ClientNotFound
    client, enquiry_count, quote_count = row
    return client, enquiry_count, quote_count


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
    q: str | None = None,
    tag: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ClientList:
    conditions = _filters(q.strip() if q else None, tag.strip().lower() if tag else None)
    total = await db.scalar(select(func.count()).select_from(Client).where(*conditions))
    rows = await db.execute(
        _with_counts()
        .where(*conditions)
        .order_by(Client.updated_at.desc(), Client.id)
        .limit(limit)
        .offset(offset)
    )
    return ClientList(
        items=[_to_out(client, enquiries, quotes) for client, enquiries, quotes in rows],
        total=total or 0,
    )


async def get_client(db: AsyncSession, client_id: UUID) -> ClientOut:
    return _to_out(*await _load(db, client_id))


async def update_client(
    db: AsyncSession, client_id: UUID, actor_user_id: UUID | None, data: ClientUpdate
) -> ClientOut:
    client, _, _ = await _load(db, client_id)
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
    return await get_client(db, client_id)


async def delete_client(db: AsyncSession, client_id: UUID, actor_user_id: UUID | None) -> None:
    client, _, _ = await _load(db, client_id)
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
    return await list_clients(db, q=q, tag=tag, limit=limit, offset=offset)


@clients_router.post("", status_code=status.HTTP_201_CREATED)
async def create_client_route(body: ClientCreate, current: AuthedUser, db: DbSession) -> ClientOut:
    try:
        client = await create_client(db, current.agency_id, current.id, body)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_client(db, client.id)


@clients_router.get("/{client_id}")
async def get_client_route(client_id: UUID, current: AuthedUser, db: DbSession) -> ClientOut:
    try:
        return await get_client(db, client_id)
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
