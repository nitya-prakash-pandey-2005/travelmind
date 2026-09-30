"""Enquiries (trip requests) and their pipeline: schemas, service and /api/v1/enquiries router.

Pipeline: new → quoting → quoted → won | lost, with the moves in `ALLOWED`. Numbers (E-0001)
come from the per-agency counter.
"""

import re
from collections.abc import Iterable
from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, BeforeValidator, Field, StringConstraints, model_validator
from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.db import DbSession, utcnow
from travelmind.identity import service as identity_service
from travelmind.identity.deps import AuthedUser
from travelmind.offers.models import MAX_PASSENGERS, Cabin
from travelmind.offers.money import CurrencyCode, Money
from travelmind.workspace._common import (
    NO_NUL,
    SINGLE_LINE,
    Notes,
    OptionalAirport,
    WorkspaceError,
    blank_to_none,
    check_airport,
    escape_like,
    http_error,
)
from travelmind.workspace.activity import record_activity
from travelmind.workspace.counters import format_number, next_number
from travelmind.workspace.models import Client, Enquiry, Quote

__all__ = [
    "ALLOWED",
    "EnquiryCreate",
    "EnquiryError",
    "EnquiryList",
    "EnquiryOut",
    "EnquiryStatus",
    "EnquiryStatusChange",
    "EnquiryUpdate",
    "create_enquiry",
    "enquiries_router",
    "get_enquiry",
    "list_enquiries",
    "load_enquiry",
    "set_enquiry_status",
    "update_enquiry",
]

EnquiryStatus = Literal["new", "quoting", "quoted", "won", "lost"]
EnquirySource = Literal["manual", "pasted", "copilot"]
ALLOWED: dict[str, frozenset[str]] = {
    "new": frozenset({"quoting", "quoted", "lost"}),
    "quoting": frozenset({"quoted", "lost"}),
    "quoted": frozenset({"won", "lost", "quoting"}),
    "lost": frozenset({"new"}),
    "won": frozenset(),
}
CLOSED_STATUSES = frozenset({"won", "lost"})

NOT_FOUND_MESSAGE = "Enquiry not found."
CLIENT_NOT_FOUND_MESSAGE = "Client not found."
NOT_A_TEAMMATE_MESSAGE = "That teammate isn't in your agency."
LOST_REASON_MESSAGE = "Say why the enquiry was lost (up to 200 characters)."
SAME_AIRPORTS_MESSAGE = "Origin and destination must be different airports."
RETURN_BEFORE_DEPART_MESSAGE = "The return date can't be before the departure date."
BUDGET_PAIR_MESSAGE = "A budget needs both an amount and a currency."

MAX_CHILDREN = 8
MAX_LOST_REASON = 200
# Far above any trip budget, and inside Postgres BIGINT.
MAX_BUDGET_MINOR = 10**15
_NUMBER_QUERY = re.compile(r"^E-(\d{1,9})$", re.IGNORECASE)

RawText = Annotated[
    Annotated[str, StringConstraints(max_length=5000, pattern=NO_NUL)] | None,
    BeforeValidator(blank_to_none),
]
Adults = Annotated[int, Field(ge=1, le=MAX_PASSENGERS)]
ChildrenAges = Annotated[list[Annotated[int, Field(ge=0, le=17)]], Field(max_length=MAX_CHILDREN)]
BudgetMinor = Annotated[int, Field(gt=0, le=MAX_BUDGET_MINOR)]
OptionalCurrency = Annotated[CurrencyCode | None, BeforeValidator(blank_to_none)]
LostReason = Annotated[
    Annotated[str, StringConstraints(max_length=MAX_LOST_REASON, pattern=SINGLE_LINE)] | None,
    BeforeValidator(blank_to_none),
]


_TRIP_FIELDS = (
    "origin",
    "destination",
    "depart_date",
    "return_date",
    "budget_minor",
    "budget_currency",
)


def trip_problem(
    origin: str | None,
    destination: str | None,
    depart_date: date | None,
    return_date: date | None,
    budget_minor: int | None,
    budget_currency: str | None,
) -> str | None:
    """What's wrong with this combination of trip fields, or None when they fit together."""
    if origin is not None and origin == destination:
        return SAME_AIRPORTS_MESSAGE
    if depart_date is not None and return_date is not None and return_date < depart_date:
        return RETURN_BEFORE_DEPART_MESSAGE
    if (budget_minor is None) != (budget_currency is None):
        return BUDGET_PAIR_MESSAGE
    return None


class EnquiryCreate(BaseModel):
    client_id: UUID | None = None
    source: EnquirySource = "manual"
    raw_text: RawText = None
    origin: OptionalAirport = None
    destination: OptionalAirport = None
    depart_date: date | None = None
    return_date: date | None = None
    adults: Adults = 1
    children_ages: ChildrenAges = []
    cabin: Cabin = "economy"
    budget_minor: BudgetMinor | None = None
    budget_currency: OptionalCurrency = None
    notes: Notes = None
    assignee_user_id: UUID | None = None

    @model_validator(mode="after")
    def _fields_fit_together(self) -> "EnquiryCreate":
        problem = trip_problem(
            self.origin,
            self.destination,
            self.depart_date,
            self.return_date,
            self.budget_minor,
            self.budget_currency,
        )
        if problem:
            raise ValueError(problem)
        return self


class EnquiryUpdate(BaseModel):
    """Partial update: omitted fields are left alone; optional fields may be cleared with null.

    Cross-field rules (different airports, return after departure, budget amount with currency)
    are checked against the enquiry as it will be after the update.
    """

    client_id: UUID | None = None
    origin: OptionalAirport = None
    destination: OptionalAirport = None
    depart_date: date | None = None
    return_date: date | None = None
    adults: Adults | None = None
    children_ages: ChildrenAges | None = None
    cabin: Cabin | None = None
    budget_minor: BudgetMinor | None = None
    budget_currency: OptionalCurrency = None
    notes: Notes = None
    assignee_user_id: UUID | None = None

    @model_validator(mode="after")
    def _required_fields_not_null(self) -> "EnquiryUpdate":
        for field in ("adults", "children_ages", "cabin"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} can't be empty.")
        return self


class EnquiryStatusChange(BaseModel):
    status: EnquiryStatus
    lost_reason: LostReason = None


class ClientRef(BaseModel):
    id: UUID
    name: str


class AssigneeRef(BaseModel):
    id: UUID
    full_name: str


class EnquiryOut(BaseModel):
    id: UUID
    number: str
    client: ClientRef | None
    source: str
    raw_text: str | None
    origin: str | None
    destination: str | None
    depart_date: date | None
    return_date: date | None
    adults: int
    children_ages: list[int]
    cabin: str
    budget: Money | None
    notes: str | None
    status: str
    lost_reason: str | None
    assignee: AssigneeRef | None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    quote_count: int


class EnquiryList(BaseModel):
    items: list[EnquiryOut]
    total: int


class EnquiryError(WorkspaceError):
    pass


class EnquiryNotFound(EnquiryError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self) -> None:
        super().__init__(NOT_FOUND_MESSAGE)


class InvalidEnquiry(EnquiryError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT


class InvalidTransition(EnquiryError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, from_status: str, to_status: str) -> None:
        super().__init__(f"Can't move an enquiry from {from_status} to {to_status}.")


_QUOTE_COUNT = (
    select(func.count(Quote.id))
    .where(Quote.enquiry_id == Enquiry.id)
    .correlate(Enquiry)
    .scalar_subquery()
)


def _with_details() -> Select[Enquiry, str | None, int]:
    return select(Enquiry, Client.name, _QUOTE_COUNT).outerjoin(
        Client, Client.id == Enquiry.client_id
    )


def _label(enquiry: Enquiry) -> str:
    return format_number("enquiry", enquiry.number)


def _to_out(
    enquiry: Enquiry, client_name: str | None, quote_count: int, names: dict[UUID, str]
) -> EnquiryOut:
    budget = (
        Money(amount_minor=enquiry.budget_minor, currency=enquiry.budget_currency)
        if enquiry.budget_minor is not None and enquiry.budget_currency is not None
        else None
    )
    client = (
        ClientRef(id=enquiry.client_id, name=client_name)
        if enquiry.client_id is not None and client_name is not None
        else None
    )
    assignee_id = enquiry.assignee_user_id
    assignee = (
        AssigneeRef(id=assignee_id, full_name=names[assignee_id])
        if assignee_id is not None and assignee_id in names
        else None
    )
    return EnquiryOut(
        id=enquiry.id,
        number=_label(enquiry),
        client=client,
        source=enquiry.source,
        raw_text=enquiry.raw_text,
        origin=enquiry.origin,
        destination=enquiry.destination,
        depart_date=enquiry.depart_date,
        return_date=enquiry.return_date,
        adults=enquiry.adults,
        children_ages=list(enquiry.children_ages),
        cabin=enquiry.cabin,
        budget=budget,
        notes=enquiry.notes,
        status=enquiry.status,
        lost_reason=enquiry.lost_reason,
        assignee=assignee,
        created_at=enquiry.created_at,
        updated_at=enquiry.updated_at,
        closed_at=enquiry.closed_at,
        quote_count=quote_count,
    )


async def _assignee_names(
    db: AsyncSession, agency_id: UUID, enquiries: Iterable[Enquiry]
) -> dict[UUID, str]:
    ids = {e.assignee_user_id for e in enquiries if e.assignee_user_id is not None}
    return await identity_service.team_names(db, agency_id, ids)


async def _check_client(db: AsyncSession, agency_id: UUID, client_id: UUID | None) -> None:
    if client_id is None:
        return
    client = await db.get(Client, client_id)
    if client is None or client.agency_id != agency_id:
        raise InvalidEnquiry(CLIENT_NOT_FOUND_MESSAGE)


async def _check_assignee(
    db: AsyncSession, agency_id: UUID, user_id: UUID | None
) -> identity_service.TeamMember | None:
    if user_id is None:
        return None
    member = await identity_service.get_team_member(db, agency_id, user_id)
    if member is None:
        raise InvalidEnquiry(NOT_A_TEAMMATE_MESSAGE)
    return member


async def _record_assignment(
    db: AsyncSession,
    enquiry: Enquiry,
    member: identity_service.TeamMember | None,
    actor_user_id: UUID | None,
    at: datetime,
) -> None:
    label = _label(enquiry)
    await record_activity(
        db,
        agency_id=enquiry.agency_id,
        kind="enquiry.assigned",
        summary=f"{label} assigned to {member.full_name}" if member else f"{label} unassigned",
        actor_user_id=actor_user_id,
        entity_type="enquiry",
        entity_id=enquiry.id,
        data={"assignee_user_id": str(member.id) if member else None},
        occurred_at=at,
    )


async def load_enquiry(db: AsyncSession, enquiry_id: UUID, *, for_update: bool = False) -> Enquiry:
    """The enquiry (row-locked when `for_update`), or EnquiryNotFound. RLS scopes it to the
    session's agency."""
    query = select(Enquiry).where(Enquiry.id == enquiry_id)
    if for_update:
        query = query.with_for_update()
    enquiry = await db.scalar(query)
    if enquiry is None:
        raise EnquiryNotFound
    return enquiry


async def create_enquiry(
    db: AsyncSession,
    agency_id: UUID,
    actor_user_id: UUID | None,
    data: EnquiryCreate,
    *,
    now: datetime | None = None,
) -> Enquiry:
    """Add an enquiry (status `new`, next E-number) and its activity. The session must be bound
    to the agency; the caller commits. `now` back-dates the enquiry and its events."""
    await _check_client(db, agency_id, data.client_id)
    await check_airport(db, data.origin)
    await check_airport(db, data.destination)
    member = await _check_assignee(db, agency_id, data.assignee_user_id)
    at = now or utcnow()
    number = await next_number(db, agency_id, "enquiry")
    enquiry = Enquiry(
        agency_id=agency_id,
        number=number,
        status="new",
        created_by=actor_user_id,
        created_at=at,
        updated_at=at,
        **data.model_dump(),
    )
    db.add(enquiry)
    await db.flush()
    route = (
        f" {enquiry.origin} → {enquiry.destination}"
        if enquiry.origin and enquiry.destination
        else ""
    )
    await record_activity(
        db,
        agency_id=agency_id,
        kind="enquiry.created",
        summary=f"New enquiry {_label(enquiry)}{route}",
        actor_user_id=actor_user_id,
        entity_type="enquiry",
        entity_id=enquiry.id,
        occurred_at=at,
    )
    if member is not None:
        await _record_assignment(db, enquiry, member, actor_user_id, at)
    return enquiry


async def set_enquiry_status(
    db: AsyncSession,
    enquiry: Enquiry,
    to_status: str,
    actor_user_id: UUID | None,
    *,
    lost_reason: str | None = None,
    now: datetime | None = None,
) -> None:
    """Move the enquiry along the pipeline (see ALLOWED) and record `enquiry.status_changed`.

    Raises InvalidTransition (409) for a move ALLOWED doesn't permit, and InvalidEnquiry (422)
    when moving to `lost` without a reason. The caller commits.
    """
    from_status = enquiry.status
    if to_status not in ALLOWED.get(from_status, frozenset()):
        raise InvalidTransition(from_status, to_status)
    reason = lost_reason.strip() if lost_reason else ""
    if to_status == "lost" and not 1 <= len(reason) <= MAX_LOST_REASON:
        raise InvalidEnquiry(LOST_REASON_MESSAGE)
    at = now or utcnow()
    enquiry.status = to_status
    enquiry.updated_at = at
    if to_status in CLOSED_STATUSES:
        enquiry.closed_at = at
        enquiry.lost_reason = reason if to_status == "lost" else None
    else:
        enquiry.closed_at = None
        enquiry.lost_reason = None
    data: dict[str, str] = {"from": from_status, "to": to_status}
    if to_status == "lost":
        data["lost_reason"] = reason
    await record_activity(
        db,
        agency_id=enquiry.agency_id,
        kind="enquiry.status_changed",
        summary=f"{_label(enquiry)} moved to {to_status}",
        actor_user_id=actor_user_id,
        entity_type="enquiry",
        entity_id=enquiry.id,
        data=data,
        occurred_at=at,
    )
    await db.flush()


async def update_enquiry(
    db: AsyncSession, enquiry: Enquiry, actor_user_id: UUID | None, data: EnquiryUpdate
) -> None:
    """Apply a partial update; a new assignee records `enquiry.assigned`. The caller commits."""
    changes: dict[str, Any] = {
        field: value
        for field, value in data.model_dump(exclude_unset=True).items()
        if getattr(enquiry, field) != value
    }
    if not changes:
        return
    merged = {field: changes.get(field, getattr(enquiry, field)) for field in _TRIP_FIELDS}
    problem = trip_problem(**merged)
    if problem:
        raise InvalidEnquiry(problem)
    if "client_id" in changes:
        await _check_client(db, enquiry.agency_id, changes["client_id"])
    for field in ("origin", "destination"):
        if field in changes:
            await check_airport(db, changes[field])
    assigning = "assignee_user_id" in changes
    member = await _check_assignee(db, enquiry.agency_id, changes.get("assignee_user_id"))
    at = utcnow()
    for field, value in changes.items():
        setattr(enquiry, field, value)
    enquiry.updated_at = at
    if assigning:
        await _record_assignment(db, enquiry, member, actor_user_id, at)
    await db.flush()


def _filters(
    status_: str | None, assignee: UUID | None, q: str | None
) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []
    if status_:
        conditions.append(Enquiry.status == status_)
    if assignee:
        conditions.append(Enquiry.assignee_user_id == assignee)
    if q:
        by_number = _NUMBER_QUERY.match(q)
        if by_number:
            conditions.append(Enquiry.number == int(by_number.group(1)))
        else:
            pattern = f"%{escape_like(q)}%"
            conditions.append(
                or_(
                    Enquiry.origin.ilike(pattern, escape="\\"),
                    Enquiry.destination.ilike(pattern, escape="\\"),
                    Client.name.ilike(pattern, escape="\\"),
                    Enquiry.notes.ilike(pattern, escape="\\"),
                )
            )
    return conditions


async def list_enquiries(
    db: AsyncSession,
    agency_id: UUID,
    *,
    status_: str | None = None,
    assignee: UUID | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> EnquiryList:
    """Newest first. `q` matches an exact number ("E-0007"), else route codes, client name or
    notes."""
    conditions = _filters(status_, assignee, q.strip() if q else None)
    total = await db.scalar(
        select(func.count())
        .select_from(Enquiry)
        .outerjoin(Client, Client.id == Enquiry.client_id)
        .where(*conditions)
    )
    rows = (
        await db.execute(
            _with_details()
            .where(*conditions)
            .order_by(Enquiry.created_at.desc(), Enquiry.number.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    names = await _assignee_names(db, agency_id, (row[0] for row in rows))
    return EnquiryList(
        items=[_to_out(enquiry, client, quotes, names) for enquiry, client, quotes in rows],
        total=total or 0,
    )


async def get_enquiry(db: AsyncSession, agency_id: UUID, enquiry_id: UUID) -> EnquiryOut:
    row = (await db.execute(_with_details().where(Enquiry.id == enquiry_id))).one_or_none()
    if row is None:
        raise EnquiryNotFound
    enquiry, client_name, quote_count = row
    names = await _assignee_names(db, agency_id, [enquiry])
    return _to_out(enquiry, client_name, quote_count, names)


enquiries_router = APIRouter(prefix="/api/v1/enquiries", tags=["enquiries"])


@enquiries_router.get("")
async def list_enquiries_route(
    current: AuthedUser,
    db: DbSession,
    status_: Annotated[EnquiryStatus | None, Query(alias="status")] = None,
    assignee: UUID | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> EnquiryList:
    return await list_enquiries(
        db,
        current.agency_id,
        status_=status_,
        assignee=assignee,
        q=q,
        limit=limit,
        offset=offset,
    )


@enquiries_router.post("", status_code=status.HTTP_201_CREATED)
async def create_enquiry_route(
    body: EnquiryCreate, current: AuthedUser, db: DbSession
) -> EnquiryOut:
    try:
        enquiry = await create_enquiry(db, current.agency_id, current.id, body)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_enquiry(db, current.agency_id, enquiry.id)


@enquiries_router.get("/{enquiry_id}")
async def get_enquiry_route(enquiry_id: UUID, current: AuthedUser, db: DbSession) -> EnquiryOut:
    try:
        return await get_enquiry(db, current.agency_id, enquiry_id)
    except WorkspaceError as exc:
        raise http_error(exc) from None


@enquiries_router.patch("/{enquiry_id}")
async def update_enquiry_route(
    enquiry_id: UUID, body: EnquiryUpdate, current: AuthedUser, db: DbSession
) -> EnquiryOut:
    try:
        enquiry = await load_enquiry(db, enquiry_id, for_update=True)
        await update_enquiry(db, enquiry, current.id, body)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_enquiry(db, current.agency_id, enquiry_id)


@enquiries_router.post("/{enquiry_id}/status")
async def set_enquiry_status_route(
    enquiry_id: UUID, body: EnquiryStatusChange, current: AuthedUser, db: DbSession
) -> EnquiryOut:
    try:
        enquiry = await load_enquiry(db, enquiry_id, for_update=True)
        await set_enquiry_status(db, enquiry, body.status, current.id, lost_reason=body.lost_reason)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()
    return await get_enquiry(db, current.agency_id, enquiry_id)
