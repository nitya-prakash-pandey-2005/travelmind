from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID, uuid4

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


def _pgbouncer_statement_name() -> str:
    return f"__asyncpg_{uuid4()}__"


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    if settings.environment == "test":
        return create_async_engine(settings.database_url, poolclass=NullPool)
    connect_args: dict[str, Any]
    if settings.db_pgbouncer:
        # Transaction pooling shares a server connection between clients, so no prepared statement
        # may outlive its transaction: asyncpg's and SQLAlchemy's statement caches are off and
        # every statement gets a unique name (SQLAlchemy asyncpg docs, "PgBouncer").
        # PgBouncer rejects unknown startup parameters, so statement_timeout is set per role.
        connect_args = {
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
            "prepared_statement_name_func": _pgbouncer_statement_name,
        }
    else:
        connect_args = {
            "server_settings": {"statement_timeout": str(settings.db_statement_timeout_ms)}
        }
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_s,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_engine(), expire_on_commit=False, sync_session_class=TenantSession
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


# Function scope: the session closes (handing its connection back) as soon as the endpoint has
# returned and its response is serialised, not after the response has been sent.
DbSession = Annotated[AsyncSession, Depends(get_db, scope="function")]


async def release_connection(db: AsyncSession) -> None:
    """Commit the session's open transaction, if any, so its connection goes back to the pool
    before the caller waits on something slow (a supplier, Redis, a lock). The session's next
    statement begins a new transaction, which `TenantSession` binds to the tenant again.

    For code that owns the transaction: anything it wrote so far is committed."""
    if db.in_transaction():
        await db.commit()


def releasing[T](
    db: AsyncSession, loader: Callable[[], Awaitable[T]]
) -> Callable[[], Awaitable[T]]:
    """`loader`, then `release_connection`: for a read-through cache's loader, so the cache
    write that follows a miss doesn't hold the connection."""

    async def load() -> T:
        value = await loader()
        await release_connection(db)
        return value

    return load


@asynccontextmanager
async def pinned_session() -> AsyncIterator[AsyncSession]:
    """A session that keeps one connection across all its commits, for batch work that commits
    often (each commit would otherwise hand the connection back to the pool)."""
    async with get_engine().connect() as connection:
        async with get_sessionmaker()(bind=connection) as session:
            yield session


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
