"""Building one demo workspace: the agency, its team and owner session, then its seeded data.

Used by POST /api/v1/demo and by the worker's `generate_demo_job`. At most DEMO_CONCURRENCY
generations run at once across every API and worker process (a Redis semaphore): each one
holds database connections for several seconds, so a burst must not exhaust the pool.
"""

from datetime import datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.config import Settings
from travelmind.db import pinned_session
from travelmind.demo.data import AGENCY_NAME, AGENT_NAMES, PRESENTER_NAME
from travelmind.demo.generator import seed_demo_workspace
from travelmind.identity import service as identity_service
from travelmind.semaphore import SemaphoreBusy, redis_semaphore

DEMO_SEMAPHORE_KEY = "tm:sem:demo"
DEMO_CONCURRENCY = 4
DEMO_WAIT_SECONDS = 10.0
# Longer than any healthy generation; a crashed process's slot frees itself after this.
DEMO_SLOT_TTL_SECONDS = 120.0
BUSY_MESSAGE = "Demo workspaces are busy. Try again in a moment."


class DemoBusy(Exception):
    """Every generation slot stayed taken for DEMO_WAIT_SECONDS."""


async def start_demo_workspace(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    *,
    ctx: identity_service.SessionContext,
    now: datetime,
) -> tuple[identity_service.User, identity_service.Agency, str]:
    """Create and seed a demo workspace; returns its owner, the agency and the owner's session
    token. Raises DemoBusy when no slot comes free in time. A failed seed removes the half-built
    workspace (and with it the owner's session) and re-raises."""
    try:
        async with redis_semaphore(
            redis,
            DEMO_SEMAPHORE_KEY,
            limit=DEMO_CONCURRENCY,
            ttl_s=DEMO_SLOT_TTL_SECONDS,
            wait_s=DEMO_WAIT_SECONDS,
        ):
            return await _build(db, redis, settings, ctx=ctx, now=now)
    except SemaphoreBusy:
        raise DemoBusy(BUSY_MESSAGE) from None


async def _build(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    *,
    ctx: identity_service.SessionContext,
    now: datetime,
) -> tuple[identity_service.User, identity_service.Agency, str]:
    owner, agency, team, token = await identity_service.create_demo_agency(
        db,
        agency_name=AGENCY_NAME,
        owner_name=PRESENTER_NAME,
        agent_names=AGENT_NAMES,
        expires_at=now + timedelta(days=settings.demo_ttl_days),
        ctx=ctx,
    )
    agency_settings = await identity_service.get_agency_settings(db, agency.id)
    try:
        # Seeding commits after every search: one pinned connection serves them all.
        async with pinned_session() as seed_db:
            await seed_demo_workspace(
                seed_db, redis, settings, agency=agency_settings, users=team, now=now
            )
    except Exception:
        # Never leave a half-built demo behind: its owner's session goes with it.
        await identity_service.delete_demo_agency(db, agency_settings.id)
        await db.commit()
        raise
    return owner, agency, token
