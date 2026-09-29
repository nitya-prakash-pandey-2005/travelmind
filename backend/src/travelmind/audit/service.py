from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.audit.models import AuditEvent


async def record_event(
    db: AsyncSession,
    *,
    agency_id: UUID,
    actor_user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """Append an audit event. The session must already be bound to `agency_id`."""
    db.add(
        AuditEvent(
            agency_id=agency_id,
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
        )
    )
    await db.flush()
