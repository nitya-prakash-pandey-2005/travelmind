import os
from typing import Any
from uuid import UUID

import httpx
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

DEFAULT_PASSWORD = "correct-horse-battery"


def make_client(app: FastAPI, *, raise_app_exceptions: bool = True) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def signup(
    client: httpx.AsyncClient,
    *,
    email: str = "owner@alphatravels.com",
    agency_name: str = "Alpha Travels",
    full_name: str = "Asha Owner",
    password: str = DEFAULT_PASSWORD,
) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/signup",
        json={
            "agency_name": agency_name,
            "full_name": full_name,
            "email": email,
            "password": password,
        },
    )


async def run_as_owner(sql: str, params: dict[str, Any] | None = None) -> None:
    """Run SQL as the table owner (for identity tables, which have no RLS)."""
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.execute(text(sql), params or {})
    await engine.dispose()


async def exec_as_tenant(
    agency_id: UUID | str, sql: str, params: dict[str, Any] | None = None
) -> list[tuple[Any, ...]]:
    """Run SQL as the app role inside one tenant's RLS context."""
    engine = create_async_engine(os.environ["TM_DATABASE_URL"], poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.agency_id', :aid, true)"), {"aid": str(agency_id)}
        )
        result = await conn.execute(text(sql), params or {})
        rows = [tuple(row) for row in result] if result.returns_rows else []
    await engine.dispose()
    return rows
