"""The arq background worker: `arq travelmind.worker.WorkerSettings`.

Schedules (UTC; each tick runs on exactly one worker even with several replicas, since arq cron
jobs are unique by default):
- `cleanup_expired_demos`: hourly at :00, and once at startup. Deletes expired demo workspaces
  in bounded batches (`demo.cleanup`).
- `expire_overdue_quotes_all`: every 5 minutes. Marks sent and viewed quotes whose share link
  has lapsed as expired, visiting only agencies that have such quotes (in random order, so a
  timeout never starves the same ones), and invalidates each changed agency's read cache.
- `sweep_stuck_agent_runs`: every minute at :30. Fails agent runs whose job died without a
  trace (`agent.service.sweep_stuck_runs`) and frees their slots.

Queued jobs: `generate_demo_job` (one demo workspace; for the traveller app in a later step) and
`run_agent_job` (one agent run, until it answers, waits for the user or stops: `agent.service`;
never retried, and cancelled after the run's time budget plus a margin, which marks the run
failed).

Worker database sessions get `SET LOCAL statement_timeout = '60s'` in every transaction (the API
keeps its 5 s), through an `after_begin` hook that only `startup` installs. It is transaction
local, so it is safe behind PgBouncer's transaction pooling.
"""

import random
from datetime import datetime
from typing import Any, ClassVar
from uuid import UUID

import structlog
from arq import Retry, cron, func
from arq.cron import CronJob
from arq.worker import Function
from redis.asyncio import Redis
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.agent import service as agent_service
from travelmind.agent.tools.external import warn_about_feed_settings
from travelmind.cache import close_redis, get_shared_redis
from travelmind.config import get_settings
from travelmind.db import (
    TenantSession,
    bind_tenant,
    get_engine,
    get_sessionmaker,
    pinned_session,
    utcnow,
)
from travelmind.demo.cleanup import run_demo_cleanup
from travelmind.demo.service import DemoBusy, start_demo_workspace
from travelmind.http import close_http_clients
from travelmind.identity.service import SessionContext
from travelmind.jobs import arq_redis_settings, close_job_queue
from travelmind.observability import configure_logging
from travelmind.readcache import discard_agency_changes, publish_agency_changes
from travelmind.workspace.quotes import agencies_with_overdue_quotes, expire_overdue_quotes

log = structlog.get_logger()

WORKER_STATEMENT_TIMEOUT = "60s"
_SET_STATEMENT_TIMEOUT = text(f"SET LOCAL statement_timeout = '{WORKER_STATEMENT_TIMEOUT}'")
DEMO_BUSY_RETRY_SECONDS = 15
SWEEP_TIMEOUT_SECONDS = 240  # inside the 5-minute interval, so runs never overlap
STUCK_RUNS_TIMEOUT_SECONDS = 50  # inside the minute
CLEANUP_TIMEOUT_SECONDS = 900


def _statement_timeout(session, transaction, connection) -> None:  # type: ignore[no-untyped-def]
    connection.execute(_SET_STATEMENT_TIMEOUT)


def install_statement_timeout() -> None:
    if not event.contains(TenantSession, "after_begin", _statement_timeout):
        event.listen(TenantSession, "after_begin", _statement_timeout)


def remove_statement_timeout() -> None:
    if event.contains(TenantSession, "after_begin", _statement_timeout):
        event.remove(TenantSession, "after_begin", _statement_timeout)


async def startup(ctx: dict[str, Any]) -> None:
    """Logging and the worker's statement timeout. The shared clients (DB engine, Redis pool,
    httpx clients) open lazily on first use."""
    settings = get_settings()
    configure_logging(settings.log_level)
    warn_about_feed_settings(settings)  # agent runs use the weather and place feeds here
    install_statement_timeout()
    log.info("worker_started")


async def shutdown(ctx: dict[str, Any]) -> None:
    """Close the shared clients (and the job queue pool, if a job opened it); each close runs
    even if an earlier one fails."""
    remove_statement_timeout()
    try:
        await close_model_clients()
        await close_http_clients()
    finally:
        try:
            await close_job_queue()
        finally:
            try:
                await close_redis()
            finally:
                await get_engine().dispose()


async def cleanup_expired_demos(ctx: dict[str, Any]) -> int:
    """One bounded cleanup pass; returns how many demos were deleted. Deleted agencies need no
    cache invalidation: nobody can read their keys, which lapse on their TTL."""
    return await run_demo_cleanup()


def _sweep_order(agency_ids: list[UUID]) -> list[UUID]:
    """Random order: if a run times out, the agencies it didn't reach differ from run to run."""
    random.shuffle(agency_ids)
    return agency_ids


class _Sweep:
    def __init__(self) -> None:
        self.total = self.changed = self.failed = 0


async def expire_overdue_quotes_all(ctx: dict[str, Any]) -> int:
    """Expire overdue quotes in every agency that has some; returns how many.

    One statement finds the agencies with overdue quotes (`agencies_with_overdue_quotes`, under
    RLS); agencies with nothing due are never visited. Each one found is then bound as the tenant
    and handled in its own transaction, so RLS applies to every quote touched and one agency's
    failure doesn't undo or stop the others. A failure whose rollback fails too (a dead
    connection) drops that connection and carries on with a fresh one. Agencies whose quotes
    changed get their read cache invalidated after the commit.
    """
    now = utcnow()
    redis = get_shared_redis()
    async with pinned_session() as db:
        due = await agencies_with_overdue_quotes(db, now=now)
        await db.commit()
    pending = _sweep_order(due)
    sweep = _Sweep()
    while pending:
        remaining = pending
        try:
            async with pinned_session() as db:
                remaining = await _expire_until_broken(db, redis, pending, now, sweep)
        except Exception as exc:  # opening, or closing a broken, connection failed
            log.warning("quote_expiry_connection_failed", error_type=type(exc).__name__)
            if remaining is pending:  # no progress (the database is unreachable): next run
                break
        pending = remaining
    log.info(
        "overdue_quotes_expired",
        count=sweep.total,
        agencies=len(due),
        changed=sweep.changed,
        failed=sweep.failed,
    )
    return sweep.total


async def _expire_until_broken(
    db: AsyncSession, redis: Redis, pending: list[UUID], now: datetime, sweep: _Sweep
) -> list[UUID]:
    """Expire agency by agency on one connection; returns the agencies left when the connection
    broke (a rollback that failed), else an empty list."""
    for index, agency_id in enumerate(pending):
        try:
            await bind_tenant(db, agency_id)
            expired = await expire_overdue_quotes(db, agency_id, now=now)
            await db.commit()
        except Exception as exc:
            discard_agency_changes(db)  # rolled back: nothing to invalidate
            sweep.failed += 1
            log.exception(
                "quote_expiry_failed", agency_id=str(agency_id), error_type=type(exc).__name__
            )
            try:
                await db.rollback()
            except Exception as rollback_exc:
                log.warning(
                    "quote_expiry_rollback_failed",
                    agency_id=str(agency_id),
                    error_type=type(rollback_exc).__name__,
                )
                return pending[index + 1 :]
            continue
        await publish_agency_changes(db, redis)  # bumps this agency if it expired any; clears
        if expired:
            sweep.total += expired
            sweep.changed += 1
    return []


async def sweep_stuck_agent_runs(ctx: dict[str, Any]) -> int:
    """Fail the agent runs whose job is gone; returns how many."""
    return await agent_service.sweep_stuck_runs()


async def generate_demo_job(ctx: dict[str, Any]) -> str:
    """Build one demo workspace; returns its agency id. When every generation slot is taken it
    retries later. The owner session it opens is never handed out and simply expires."""
    settings = get_settings()
    try:
        async with get_sessionmaker()() as db:
            _, agency, _ = await start_demo_workspace(
                db,
                get_shared_redis(),
                settings,
                ctx=SessionContext(user_agent="travelmind-worker", ip_address=None),
                now=utcnow(),
            )
    except DemoBusy:
        raise Retry(defer=DEMO_BUSY_RETRY_SECONDS) from None
    return str(agency.id)


async def run_agent_job(ctx: dict[str, Any], run_id: str, agency_id: str) -> str:
    """Run one agent run (queued by the API); returns its status afterwards."""
    return await agent_service.drive_run(UUID(run_id), UUID(agency_id))


async def close_model_clients() -> None:
    """Close the Gemini SDK clients agent runs opened; a failure is only logged."""
    from travelmind.agent import gemini

    try:
        await gemini.close_clients()
    except Exception as exc:
        log.warning("model_clients_close_failed", error_type=type(exc).__name__)


AGENT_JOB_MARGIN_SECONDS = 60
AGENT_JOB: Function = func(
    run_agent_job,
    name="run_agent_job",
    timeout=get_settings().agent_run_timeout_s + AGENT_JOB_MARGIN_SECONDS,
    max_tries=1,
)


class WorkerSettings:
    """Read by `arq travelmind.worker.WorkerSettings`."""

    # arq's own connection settings and pool (the read cache's shared pool is separate).
    redis_settings = arq_redis_settings()
    functions: ClassVar[list[Any]] = [generate_demo_job, AGENT_JOB]
    cron_jobs: ClassVar[list[CronJob]] = [
        cron(
            cleanup_expired_demos,
            minute=0,
            second=0,
            run_at_startup=True,
            timeout=CLEANUP_TIMEOUT_SECONDS,
        ),
        cron(
            expire_overdue_quotes_all,
            minute=set(range(0, 60, 5)),
            second=0,
            timeout=SWEEP_TIMEOUT_SECONDS,
        ),
        cron(sweep_stuck_agent_runs, second=30, timeout=STUCK_RUNS_TIMEOUT_SECONDS),
    ]
    on_startup = startup
    on_shutdown = shutdown
