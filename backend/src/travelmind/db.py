from collections.abc import AsyncIterator
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import NullPool

from travelmind.config import get_settings

TENANT_SETTING = "app.agency_id"
_SET_TENANT_SQL = text("SELECT set_config(:key, :agency_id, true)")


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


class TenantSession(Session):
    """Sync session class; every transaction it begins carries the bound tenant for RLS."""


@event.listens_for(TenantSession, "after_begin")
def _apply_tenant(session, transaction, connection):  # type: ignore[no-untyped-def]
    agency_id = session.info.get("agency_id")
    if agency_id is not None:
        connection.execute(_SET_TENANT_SQL, {"key": TENANT_SETTING, "agency_id": str(agency_id)})


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    kwargs: dict[str, Any] = (
        {"poolclass": NullPool} if settings.environment == "test" else {"pool_pre_ping": True}
    )
    return create_async_engine(settings.database_url, **kwargs)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_engine(), expire_on_commit=False, sync_session_class=TenantSession
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


async def bind_tenant(session: AsyncSession, agency_id: UUID) -> None:
    """Scope this session to one agency. Applies now and to every later transaction."""
    session.info["agency_id"] = agency_id
    if session.in_transaction():
        await session.execute(_SET_TENANT_SQL, {"key": TENANT_SETTING, "agency_id": str(agency_id)})


def tenant_rls_statements(table: str) -> list[str]:
    """SQL that enables and forces the standard tenant-isolation policy on a table."""
    condition = f"agency_id = NULLIF(current_setting('{TENANT_SETTING}', true), '')::uuid"
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY tenant_isolation ON {table} USING ({condition}) WITH CHECK ({condition})",
    ]
