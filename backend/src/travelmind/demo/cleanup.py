"""Removing demo workspaces once they expire (at startup and then on a timer)."""

import asyncio
from datetime import datetime

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.cache import get_shared_redis
from travelmind.db import get_sessionmaker, utcnow
from travelmind.identity import service as identity_service
from travelmind.identity.sessioncache import evict_and_publish

log = structlog.get_logger()

# Each demo's delete cascades through all its data, so a run deletes a few demos per transaction
# (keeping every statement well inside the statement timeout) and stops after a bounded number of
# batches; a bigger backlog drains over the next runs.
CLEANUP_BATCH_SIZE = 20
CLEANUP_MAX_BATCHES = 50


async def delete_expired_demos(db: AsyncSession, *, now: datetime) -> int:
    """Delete demo agencies that expired before `now`, with all their data (foreign keys
    cascade), in batches of CLEANUP_BATCH_SIZE, committing after each batch, for at most
    CLEANUP_MAX_BATCHES batches. Returns how many were deleted. After each commit, the deleted
    agencies' sessions are evicted from the session cache here and in every API process."""
    total = 0
    for _ in range(CLEANUP_MAX_BATCHES):
        deleted = await identity_service.delete_expired_demo_agencies(
            db, now=now, limit=CLEANUP_BATCH_SIZE
        )
        if not deleted:
            break
        await db.commit()
        redis = get_shared_redis()
        for agency_id in deleted:  # their users' cached sessions must stop working now
            await evict_and_publish(redis, "agency", str(agency_id))
        total += len(deleted)
        if len(deleted) < CLEANUP_BATCH_SIZE:
            break
    log.info("expired_demos_deleted", count=total)
    return total


async def run_demo_cleanup() -> int:
    """One cleanup pass in its own session. Never raises (except on cancellation): a failed
    pass is logged and the next one tries again. Returns how many demos were deleted."""
    try:
        async with get_sessionmaker()() as db:
            return await delete_expired_demos(db, now=utcnow())
    except Exception as exc:
        log.exception("demo_cleanup_failed", error_type=type(exc).__name__)
        return 0


async def demo_cleanup_loop(interval_seconds: float) -> None:
    """Clean up now and then every `interval_seconds`, until cancelled."""
    while True:
        await run_demo_cleanup()
        await asyncio.sleep(interval_seconds)
