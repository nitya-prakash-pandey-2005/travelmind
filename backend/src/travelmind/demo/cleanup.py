"""Removing demo workspaces once they expire (at startup and then on a timer)."""

import asyncio
from datetime import datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.db import get_sessionmaker, utcnow
from travelmind.identity import service as identity_service

log = structlog.get_logger()


async def delete_expired_demos(db: AsyncSession, *, now: datetime) -> int:
    """Delete demo agencies that expired before `now`, with all their data (foreign keys
    cascade). Returns how many were deleted. The caller commits."""
    deleted = await identity_service.delete_expired_demo_agencies(db, now=now)
    log.info("expired_demos_deleted", count=len(deleted))
    return len(deleted)


async def run_demo_cleanup() -> int:
    """One cleanup pass in its own session. Never raises (except on cancellation): a failed
    pass is logged and the next one tries again. Returns how many demos were deleted."""
    try:
        async with get_sessionmaker()() as db:
            count = await delete_expired_demos(db, now=utcnow())
            await db.commit()
            return count
    except Exception as exc:
        log.exception("demo_cleanup_failed", error_type=type(exc).__name__)
        return 0


async def demo_cleanup_loop(interval_seconds: float) -> None:
    """Clean up now and then every `interval_seconds`, until cancelled."""
    while True:
        await run_demo_cleanup()
        await asyncio.sleep(interval_seconds)
