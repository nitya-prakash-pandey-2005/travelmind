from typing import Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CounterKind = Literal["enquiry", "quote"]
_PREFIX: dict[CounterKind, str] = {"enquiry": "E", "quote": "Q"}
_NEXT_SQL = text(
    """
    INSERT INTO agency_counters (agency_id, kind, value) VALUES (:agency_id, :kind, 1)
    ON CONFLICT (agency_id, kind) DO UPDATE SET value = agency_counters.value + 1
    RETURNING value
    """
)


async def next_number(db: AsyncSession, agency_id: UUID | str, kind: CounterKind) -> int:
    """Allocate the next per-agency number.

    Row-locked by the upsert, so concurrent callers never collide.
    """
    return int(
        (await db.execute(_NEXT_SQL, {"agency_id": str(agency_id), "kind": kind})).scalar_one()
    )


def format_number(kind: CounterKind, n: int) -> str:
    return f"{_PREFIX[kind]}-{n:04d}"
