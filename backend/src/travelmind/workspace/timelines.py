"""Activity timelines for one enquiry, client or quote (read model over `activity_events`).

An enquiry's timeline is its own events plus its quotes'; a client's is the client's, its
enquiries' and their quotes' (plus any quote still filed under the client); a quote's is its own.
Newest first, at most `TIMELINE_LIMIT` items. RLS scopes every table to the session's agency, so
another agency's id reads as not found. Overdue quotes are expired first (their `quote.expired`
events belong on the timeline), so the routes commit.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from travelmind.db import DbSession
from travelmind.identity import service as identity_service
from travelmind.identity.deps import AuthedUser
from travelmind.workspace._common import WorkspaceError, http_error
from travelmind.workspace.clients import ClientNotFound
from travelmind.workspace.enquiries import EnquiryNotFound
from travelmind.workspace.models import ActivityEvent, Client, Enquiry, Quote
from travelmind.workspace.quotes import QuoteNotFound, expire_overdue_quotes

__all__ = [
    "TIMELINE_LIMIT",
    "TimelineActor",
    "TimelineItem",
    "TimelineOut",
    "client_timeline",
    "enquiry_timeline",
    "quote_timeline",
    "timelines_router",
]

TIMELINE_LIMIT = 50


class TimelineActor(BaseModel):
    id: UUID
    full_name: str


class TimelineItem(BaseModel):
    id: UUID
    kind: str
    summary: str
    occurred_at: datetime
    actor: TimelineActor | None


class TimelineOut(BaseModel):
    items: list[TimelineItem]


def _about(entity_type: str, ids: ColumnElement[bool]) -> ColumnElement[bool]:
    return and_(ActivityEvent.entity_type == entity_type, ids)


async def _timeline(
    db: AsyncSession, agency_id: UUID, condition: ColumnElement[bool]
) -> TimelineOut:
    events = (
        await db.scalars(
            select(ActivityEvent)
            .where(ActivityEvent.agency_id == agency_id, condition)
            .order_by(ActivityEvent.occurred_at.desc(), ActivityEvent.id.desc())
            .limit(TIMELINE_LIMIT)
        )
    ).all()
    names = await identity_service.team_names(
        db, agency_id, (e.actor_user_id for e in events if e.actor_user_id is not None)
    )
    return TimelineOut(
        items=[
            TimelineItem(
                id=event.id,
                kind=event.kind,
                summary=event.summary,
                occurred_at=event.occurred_at,
                actor=TimelineActor(id=event.actor_user_id, full_name=names[event.actor_user_id])
                if event.actor_user_id in names
                else None,
            )
            for event in events
        ]
    )


async def _exists(db: AsyncSession, column: InstrumentedAttribute[UUID], entity_id: UUID) -> bool:
    return await db.scalar(select(column).where(column == entity_id)) is not None


async def enquiry_timeline(
    db: AsyncSession, enquiry_id: UUID, *, agency_id: UUID, now: datetime | None = None
) -> TimelineOut:
    await expire_overdue_quotes(db, agency_id, now=now)
    if not await _exists(db, Enquiry.id, enquiry_id):
        raise EnquiryNotFound
    quotes = select(Quote.id).where(Quote.enquiry_id == enquiry_id)
    return await _timeline(
        db,
        agency_id,
        or_(
            _about("enquiry", ActivityEvent.entity_id == enquiry_id),
            _about("quote", ActivityEvent.entity_id.in_(quotes)),
        ),
    )


async def client_timeline(
    db: AsyncSession, client_id: UUID, *, agency_id: UUID, now: datetime | None = None
) -> TimelineOut:
    await expire_overdue_quotes(db, agency_id, now=now)
    if not await _exists(db, Client.id, client_id):
        raise ClientNotFound
    enquiries = select(Enquiry.id).where(Enquiry.client_id == client_id)
    quotes = select(Quote.id).where(
        or_(Quote.client_id == client_id, Quote.enquiry_id.in_(enquiries))
    )
    return await _timeline(
        db,
        agency_id,
        or_(
            _about("client", ActivityEvent.entity_id == client_id),
            _about("enquiry", ActivityEvent.entity_id.in_(enquiries)),
            _about("quote", ActivityEvent.entity_id.in_(quotes)),
        ),
    )


async def quote_timeline(
    db: AsyncSession, quote_id: UUID, *, agency_id: UUID, now: datetime | None = None
) -> TimelineOut:
    await expire_overdue_quotes(db, agency_id, now=now)
    if not await _exists(db, Quote.id, quote_id):
        raise QuoteNotFound
    return await _timeline(db, agency_id, _about("quote", ActivityEvent.entity_id == quote_id))


timelines_router = APIRouter(prefix="/api/v1", tags=["timelines"])


@timelines_router.get("/enquiries/{enquiry_id}/activity")
async def enquiry_timeline_route(
    enquiry_id: UUID, current: AuthedUser, db: DbSession
) -> TimelineOut:
    try:
        timeline = await enquiry_timeline(db, enquiry_id, agency_id=current.agency_id)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()  # keep any lazy expiry
    return timeline


@timelines_router.get("/clients/{client_id}/activity")
async def client_timeline_route(client_id: UUID, current: AuthedUser, db: DbSession) -> TimelineOut:
    try:
        timeline = await client_timeline(db, client_id, agency_id=current.agency_id)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()  # keep any lazy expiry
    return timeline


@timelines_router.get("/quotes/{quote_id}/activity")
async def quote_timeline_route(quote_id: UUID, current: AuthedUser, db: DbSession) -> TimelineOut:
    try:
        timeline = await quote_timeline(db, quote_id, agency_id=current.agency_id)
    except WorkspaceError as exc:
        raise http_error(exc) from None
    await db.commit()  # keep any lazy expiry
    return timeline
