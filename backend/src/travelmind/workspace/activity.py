"""Workspace activity feed: what happened, who did it and when (append-only).

Imports only the workspace models, so identity can record events without an import cycle.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.db import utcnow
from travelmind.workspace.models import ActivityEvent

ActivityKind = Literal[
    "search.flights",
    "search.hotels",
    "client.created",
    "client.updated",
    "client.deleted",
    "enquiry.created",
    "enquiry.status_changed",
    "enquiry.assigned",
    "quote.created",
    "quote.version_added",
    "quote.sent",
    "quote.viewed",
    "quote.accepted",
    "quote.declined",
    "quote.expired",
    "team.joined",
    "agency.updated",
    "supplier.price_checked",
]
ActivityValue = str | int | float | bool | None
SUMMARY_MAX_LENGTH = 300


async def record_activity(
    db: AsyncSession,
    *,
    agency_id: UUID | str,
    kind: ActivityKind,
    summary: str,
    actor_user_id: UUID | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    data: Mapping[str, ActivityValue | Sequence[ActivityValue]] | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Add an activity event to the session; the caller commits.

    `data` is a small dict of plain display values: never secrets, tokens or raw prices.
    """
    db.add(
        ActivityEvent(
            agency_id=UUID(str(agency_id)),
            occurred_at=occurred_at or utcnow(),
            actor_user_id=actor_user_id,
            kind=kind,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary[:SUMMARY_MAX_LENGTH],
            data=dict(data or {}),
        )
    )
