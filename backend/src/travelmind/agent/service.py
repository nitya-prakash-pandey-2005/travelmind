"""Agent runs: creating them, running them as jobs, the user's replies and decisions, cancelling.

Statuses: queued → running → done | failed | budget_exceeded, with running → waiting_for_user →
queued → running when the run asks the user something (a question, or a write to confirm), and
cancelled from any status that isn't final. Every change is a conditional update on the current
status, so two writers can't both move a run (a second reply, a cancel racing the job): the
loser gets RunConflict, or the job simply leaves a cancelled run cancelled.

Creating a run (`create_run`): the agency's per-minute limit (`agent_runs_per_minute`), its
monthly token budget (`budget.reserve`) and a run slot (at most
`agent_max_concurrent_runs_per_agency` runs in progress); then the run row (queued) with its
starting state. `launch` then runs the job: in an asyncio task in this process when
`agent_inline_enabled` (development and test by default, so a dev API needs no worker), else on
the arq queue (`run_agent_job`); a queue that doesn't answer fails the run and frees its slot
(QueueUnavailable: the API's 503).

Slots: taken at creation, and again when a reply or decision resumes the run; handed back when
the run stops for the user or ends (and on cancel). A waiting run holds no slot, so unanswered
questions can't block the agency; resuming with every slot busy is TooManyRuns. The slot's TTL
(`agent_run_slot_ttl_s`) counts from when it was taken, so it covers the queue wait and the run
only while the wait stays under the TTL minus `agent_run_timeout_s`: a job that starts later
fails the run ("waited too long") instead of running without a slot.

The job (`drive_run`) claims a queued run, rebuilds its context and memory from the stored
state, applies the user's reply or decision, runs the loop, then stores the outcome and the
state and publishes the status (`agent.events`).

Stuck runs (`sweep_stuck_runs`, the worker's minute cron, and `stuck_runs_loop` in a dev API
that runs the schedules): a job killed hard leaves its run running or queued. The sweep fails
("The plan was interrupted. Try again.") a running run whose last activity (started, claimed by
a job, or its newest step) is older than `agent_run_timeout_s` + SWEEP_MARGIN_S (a live job is
cancelled by then: its arq timeout is the run timeout plus a margin), and a queued run waiting
longer than the slot TTL minus the run timeout (a job starting later would refuse it anyway).
Each with a conditional UPDATE on the same condition, then its slot is released and the status
published; a job that wakes up later finds the run moved and leaves it be.
"""

import asyncio
import contextlib
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import DateTime, and_, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from travelmind import jobs
from travelmind.agent import budget, events
from travelmind.agent.context import build_context
from travelmind.agent.loop import LoopOutcome, run_loop
from travelmind.agent.models import TERMINAL_STATUSES, AgentRun, AgentStep
from travelmind.agent.prompts import PROMPT_VERSION
from travelmind.agent.provider import AgentUnavailable, LLMProvider, get_provider
from travelmind.agent.schemas import Availability, is_demo
from travelmind.agent.state import RunState
from travelmind.cache import get_shared_redis
from travelmind.config import Settings, get_settings
from travelmind.db import bind_tenant, get_sessionmaker, release_connection, utcnow
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.metrics import AGENT_RUNS

__all__ = [
    "AgentUnavailable",
    "QueueUnavailable",
    "RateLimited",
    "RunConflict",
    "RunNotFound",
    "availability",
    "cancel",
    "confirm",
    "create_run",
    "drain_inline_runs",
    "drive_run",
    "get_provider",
    "get_run",
    "launch",
    "list_runs",
    "list_steps",
    "reply",
    "stuck_runs_loop",
    "sweep_stuck_runs",
]

log = structlog.get_logger()

JOB_NAME = "run_agent_job"
RATE_LIMITED = "Too many new plans this minute. Try again shortly."
QUEUE_DOWN = "The planning queue is unavailable right now. Try again shortly."
WAITED_TOO_LONG = "The plan waited too long to start. Try again."
INTERRUPTED = "The plan was interrupted. Try again."
FAILED = "Something went wrong while planning. Try again."
NO_USER = "The person who started this plan no longer has an account."
SWEEP_MARGIN_S = 60  # past a running run's time budget before the sweep calls it stuck

Clock = Callable[[], datetime]


class RunNotFound(Exception):
    """No such run in this agency (another agency's run is not found either)."""


class RunConflict(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class RateLimited(Exception):
    def __init__(self) -> None:
        super().__init__(RATE_LIMITED)
        self.message = RATE_LIMITED


class QueueUnavailable(Exception):
    def __init__(self) -> None:
        super().__init__(QUEUE_DOWN)
        self.message = QUEUE_DOWN


# --- reading ------------------------------------------------------------------------------


async def get_run(
    db: AsyncSession, agency_id: UUID, run_id: UUID, *, kind: str | None = None
) -> AgentRun:
    """The agency's run (of `kind`, when given: "agency" for staff answering their own runs)."""
    query = select(AgentRun).where(AgentRun.id == run_id, AgentRun.agency_id == agency_id)
    if kind is not None:
        query = query.where(AgentRun.kind == kind)
    run = await db.scalar(query)
    if run is None:
        raise RunNotFound
    return run


async def list_runs(
    db: AsyncSession, agency_id: UUID, *, limit: int = 20, kind: str = "agency"
) -> list[AgentRun]:
    """The agency's runs of `kind` (staff see their agency's own planning, not travellers')."""
    rows = await db.execute(
        select(AgentRun)
        .where(AgentRun.agency_id == agency_id, AgentRun.kind == kind)
        .order_by(AgentRun.created_at.desc(), AgentRun.id)
        .limit(limit)
    )
    return list(rows.scalars())


async def list_steps(db: AsyncSession, run_id: UUID) -> list[AgentStep]:
    return await events.read_steps(db, run_id, -1)


def availability(settings: Settings) -> Availability:
    try:
        provider = get_provider(settings)
    except AgentUnavailable:
        return Availability(available=False, provider=None, model=None, demo=False)
    return Availability(
        available=True,
        provider=provider.name,
        model=provider.model,
        demo=is_demo(provider.name, provider.model),
    )


# --- status changes -------------------------------------------------------------------------


async def _move(
    db: AsyncSession, run_id: UUID, from_statuses: tuple[str, ...], **values: Any
) -> bool:
    """Update the run only while its status is one of `from_statuses`; True if it was."""
    result = await db.execute(
        update(AgentRun)
        .where(AgentRun.id == run_id, AgentRun.status.in_(from_statuses))
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    return bool(getattr(result, "rowcount", 0))


async def _release(redis: Redis, agency_id: UUID, run_id: UUID) -> None:
    await asyncio.shield(budget.release_run_slot(redis, agency_id, str(run_id)))


async def _publish(db: AsyncSession, redis: Redis, run: AgentRun) -> None:
    await db.refresh(run)
    await db.commit()
    AGENT_RUNS.labels(status=run.status).inc()
    await events.publish_status(redis, run)


# --- creating and launching --------------------------------------------------------------------


async def create_run(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    *,
    agency_id: UUID,
    user_id: UUID,
    prompt: str,
    provider: LLMProvider,
    clock: Clock = utcnow,
) -> AgentRun:
    """A queued run, after the rate limit, the monthly budget and a run slot. Raises
    RateLimited, budget.BudgetExceeded or budget.TooManyRuns. `db` is bound to the agency."""
    now = clock()
    limiter = LoginRateLimiter(redis, settings.agent_runs_per_minute, 60)
    if not await limiter.hit(f"rl:agent:{agency_id}"):
        raise RateLimited
    await budget.reserve(db, agency_id, now, budget=settings.agent_monthly_token_budget)
    await release_connection(db)
    run_id = uuid4()
    await budget.acquire_run_slot(
        redis,
        agency_id,
        str(run_id),
        limit=settings.agent_max_concurrent_runs_per_agency,
        ttl_s=settings.agent_run_slot_ttl_s,
    )
    try:
        run = AgentRun(
            id=run_id,
            agency_id=agency_id,
            user_id=user_id,
            kind="agency",
            status="queued",
            prompt=prompt,
            provider=provider.name,
            model=provider.model,
            prompt_version=PROMPT_VERSION,
            state=RunState.start(prompt, now).to_json(),
            created_at=now,
        )
        db.add(run)
        await db.commit()
    except BaseException:
        await _release(redis, agency_id, run_id)
        raise
    AGENT_RUNS.labels(status="queued").inc()
    return run


_inline: set[asyncio.Task[str]] = set()


async def _inline_job(run_id: UUID, agency_id: UUID) -> str:
    try:
        return await drive_run(run_id, agency_id)
    except Exception:
        log.exception("agent_inline_run_failed")
        return "failed"


async def launch(run_id: UUID, agency_id: UUID, settings: Settings) -> None:
    """Start the run's job: inline (a task in this process) or on the queue. A queue that
    doesn't answer fails the run, frees its slot and raises QueueUnavailable."""
    if settings.agent_inline_enabled:
        task = asyncio.create_task(_inline_job(run_id, agency_id))
        _inline.add(task)
        task.add_done_callback(_inline.discard)
        return
    try:
        await jobs.enqueue(JOB_NAME, str(run_id), str(agency_id))
    except (TimeoutError, RedisError, OSError) as exc:
        log.warning("agent_enqueue_failed", error_type=type(exc).__name__)
        await _finish_elsewhere(run_id, agency_id, ("queued",), "failed", QUEUE_DOWN)
        raise QueueUnavailable from None


async def drain_inline_runs(*, timeout_s: float = 10.0, cancel: bool = False) -> None:
    """Wait for this process's inline runs (tests), or cancel them (shutdown): a cancelled run
    is marked failed ("interrupted")."""
    tasks = list(_inline)
    if not tasks:
        return
    if cancel:
        for task in tasks:
            task.cancel()
    done, pending = await asyncio.wait(tasks, timeout=timeout_s)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.wait(pending, timeout=timeout_s)


# --- the job --------------------------------------------------------------------------------


async def _finish_elsewhere(
    run_id: UUID,
    agency_id: UUID,
    from_statuses: tuple[str, ...],
    status: str,
    error: str | None,
    *,
    state: RunState | None = None,
    outcome: LoopOutcome | None = None,
    clock: Clock = utcnow,
) -> str:
    """Move the run to `status` in a fresh session (whatever state the job's session is in),
    hand back its slot and publish the status. Returns the run's status afterwards. A move that
    loses (the run was cancelled, or swept, meanwhile: whoever moved it released its slot and
    published) changes, releases, publishes and counts nothing."""
    redis = get_shared_redis()
    values: dict[str, Any] = {"status": status, "error": error}
    if status in TERMINAL_STATUSES:
        values["finished_at"] = clock()
    if state is not None:
        values["state"] = state.to_json()
    if outcome is not None:
        values["result"] = outcome.result
        values["grounded"] = outcome.grounded
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        moved = await _move(db, run_id, from_statuses, **values)
        await db.commit()
        run = await db.get(AgentRun, run_id)
        if not moved:
            await db.commit()
            return run.status if run is not None else "missing"
        await _release(redis, agency_id, run_id)
        if run is None:
            return "missing"
        await _publish(db, redis, run)
        return run.status


async def drive_run(
    run_id: UUID,
    agency_id: UUID,
    *,
    provider: LLMProvider | None = None,
    settings: Settings | None = None,
    clock: Clock = utcnow,
) -> str:
    """Run a queued run until it answers, waits for the user or stops; returns its status."""
    settings = settings or get_settings()
    redis = get_shared_redis()
    run_id, agency_id = UUID(str(run_id)), UUID(str(agency_id))
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        run = await db.get(AgentRun, run_id)
        if run is None:
            return "missing"
        if run.status != "queued":
            await db.commit()
            return run.status
        state = RunState.from_json(run.state)
        now = clock()
        slack = settings.agent_run_slot_ttl_s - settings.agent_run_timeout_s
        if state.queued_at is not None and (now - state.queued_at).total_seconds() > slack:
            await db.commit()
            return await _finish_elsewhere(
                run_id, agency_id, ("queued",), "failed", WAITED_TOO_LONG, clock=clock
            )
        state.running_at = now
        if not await _move(
            db,
            run_id,
            ("queued",),
            status="running",
            started_at=run.started_at or now,
            state=state.to_json(),
        ):
            await db.commit()
            return (await db.get(AgentRun, run_id, populate_existing=True) or run).status
        await db.commit()
        await db.refresh(run)
        AGENT_RUNS.labels(status="running").inc()
        await events.publish_status(redis, run)
        try:
            outcome = await _drive(db, redis, settings, run, state, provider, clock)
        except asyncio.CancelledError:
            await asyncio.shield(
                _finish_elsewhere(
                    run_id, agency_id, ("running",), "failed", INTERRUPTED, state=state, clock=clock
                )
            )
            raise
        except Exception:
            log.exception("agent_run_failed")
            outcome = LoopOutcome("failed", error=FAILED)
        with contextlib.suppress(Exception):
            await db.rollback()
    return await _finish_elsewhere(
        run_id,
        agency_id,
        ("running",),
        outcome.status,
        outcome.error,
        state=state,
        outcome=outcome,
        clock=clock,
    )


async def _drive(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    run: AgentRun,
    state: RunState,
    provider: LLMProvider | None,
    clock: Clock,
) -> LoopOutcome:
    if run.user_id is None:
        return LoopOutcome("failed", error=NO_USER)
    try:
        provider = provider or get_provider(settings)
    except AgentUnavailable as exc:
        return LoopOutcome("failed", error=exc.message)
    ctx = await build_context(
        db,
        redis,
        settings,
        agency_id=run.agency_id,
        user_id=run.user_id,
        role="traveller" if run.kind == "traveller" else "agency",
        memory=state.memory,
        clock=clock,
    )
    writer = await events.StepWriter.open(db, redis, run.id, run.agency_id)
    await release_connection(db)
    return await run_loop(ctx, provider, run, state, writer.emit)


# --- the user's answers -------------------------------------------------------------------------


async def _resume(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    run: AgentRun,
    state: RunState,
    inbox: dict[str, Any],
    step: dict[str, Any],
    clock: Clock,
) -> AgentRun:
    """Queue a waiting run again with the user's answer: budget, a slot, the answer stored for
    the job, the user's step in the trace, then the job.

    The slot's holder is the run id, so two answers at once (a double click, two tabs) share
    it: a loser hands it back only if this call took it and the run isn't now queued or running
    (the winner's resume, which needs it)."""
    run_id, agency_id = run.id, run.agency_id  # a rollback below expires the run's attributes
    now = clock()
    await budget.reserve(db, agency_id, now, budget=settings.agent_monthly_token_budget)
    await release_connection(db)
    took = await budget.acquire_run_slot(
        redis,
        agency_id,
        str(run_id),
        limit=settings.agent_max_concurrent_runs_per_agency,
        ttl_s=settings.agent_run_slot_ttl_s,
    )
    try:
        state.inbox = inbox
        state.queued_at = now
        moved = await _move(
            db, run_id, ("waiting_for_user",), status="queued", state=state.to_json()
        )
        if not moved:
            raise RunConflict("This plan isn't waiting for that any more.")
        writer = await events.StepWriter.open(db, redis, run_id, agency_id)
        await writer.emit("user", step)  # commits the move with the step
    except BaseException:
        with contextlib.suppress(Exception):
            await db.rollback()
        if took:
            await asyncio.shield(_release_unless_resumed(redis, agency_id, run_id))
        raise
    await _publish(db, redis, run)
    return run


async def _release_unless_resumed(redis: Redis, agency_id: UUID, run_id: UUID) -> None:
    """Hand back the run's slot, unless another answer resumed the run meanwhile (it is queued
    or running on that same slot). Read in a fresh session: the caller's may be broken."""
    try:
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency_id)
            status = await db.scalar(select(AgentRun.status).where(AgentRun.id == run_id))
            await db.commit()
    except Exception as exc:
        log.warning("agent_resume_status_unread", error_type=type(exc).__name__)
        status = None
    if status not in ("queued", "running"):
        await _release(redis, agency_id, run_id)


async def reply(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    *,
    agency_id: UUID,
    user_id: UUID,
    run_id: UUID,
    text: str,
    clock: Clock = utcnow,
    kind: str = "agency",
) -> AgentRun:
    """Answer the question a waiting run asked; the run is queued again (the caller launches
    it). Raises RunNotFound, RunConflict, budget.BudgetExceeded or budget.TooManyRuns."""
    run = await get_run(db, agency_id, run_id, kind=kind)
    state = RunState.from_json(run.state)
    pending = state.pending or {}
    if run.status != "waiting_for_user" or pending.get("kind") != "question" or state.inbox:
        raise RunConflict("This plan isn't waiting for an answer.")
    step = {"text": text, "call_id": pending.get("call_id"), "by_user_id": str(user_id)}
    inbox = {"kind": "reply", "text": text, "by_user_id": str(user_id)}
    return await _resume(db, redis, settings, run, state, inbox, step, clock)


async def confirm(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    *,
    agency_id: UUID,
    user_id: UUID,
    run_id: UUID,
    call_id: str,
    approve: bool,
    clock: Clock = utcnow,
    kind: str = "agency",
) -> AgentRun:
    """Approve or decline the write a waiting run asked to make; the run is queued again either
    way (the caller launches it); an approved write runs as `user_id` (the approver). Raises
    like `reply`."""
    run = await get_run(db, agency_id, run_id, kind=kind)
    state = RunState.from_json(run.state)
    pending = state.pending or {}
    if (
        run.status != "waiting_for_user"
        or pending.get("kind") != "confirm"
        or pending.get("call_id") != call_id
        or state.inbox
    ):
        raise RunConflict("This plan isn't waiting for that confirmation.")
    step = {
        "call_id": call_id,
        "decision": "approved" if approve else "declined",
        "action": pending.get("action"),
        "by_user_id": str(user_id),
    }
    inbox = {"kind": "confirm", "call_id": call_id, "approve": approve, "by_user_id": str(user_id)}
    return await _resume(db, redis, settings, run, state, inbox, step, clock)


async def cancel(
    db: AsyncSession,
    redis: Redis,
    *,
    agency_id: UUID,
    run_id: UUID,
    clock: Clock = utcnow,
    kind: str = "agency",
) -> AgentRun:
    """Cancel a run that hasn't finished: a running one stops at its next model call, tool call
    or step. Raises RunNotFound, or RunConflict when it has already finished."""
    run = await get_run(db, agency_id, run_id, kind=kind)
    active = ("queued", "running", "waiting_for_user")
    if run.status in TERMINAL_STATUSES or not await _move(
        db, run.id, active, status="cancelled", finished_at=clock()
    ):
        raise RunConflict("This plan has already finished.")
    await db.commit()
    await _release(redis, agency_id, run.id)
    await _publish(db, redis, run)
    return run


# --- stuck runs -------------------------------------------------------------------------------


def _stuck(running_before: datetime, queued_before: datetime) -> ColumnElement[bool]:
    """The sweep's condition (as `agencies_with_stuck_agent_runs`, migration 0015)."""
    ts = DateTime(timezone=True)
    newest_step = (
        select(func.max(AgentStep.created_at))
        .where(AgentStep.run_id == AgentRun.id, AgentStep.agency_id == AgentRun.agency_id)
        .scalar_subquery()
    )
    running_at = AgentRun.state["running_at"].astext.cast(ts)
    queued_at = AgentRun.state["queued_at"].astext.cast(ts)
    return or_(
        and_(
            AgentRun.status == "running",
            func.greatest(AgentRun.started_at, running_at, newest_step) < running_before,
        ),
        and_(
            AgentRun.status == "queued",
            func.coalesce(queued_at, AgentRun.created_at) < queued_before,
        ),
    )


async def sweep_stuck_runs(*, settings: Settings | None = None, clock: Clock = utcnow) -> int:
    """Fail the runs whose job is gone (see the module docstring); returns how many. Never
    raises (except on cancellation): an agency that fails is logged and the next sweep retries."""
    settings = settings or get_settings()
    now = clock()
    running_before = now - timedelta(seconds=settings.agent_run_timeout_s + SWEEP_MARGIN_S)
    queue_wait = max(0.0, settings.agent_run_slot_ttl_s - settings.agent_run_timeout_s)
    queued_before = now - timedelta(seconds=queue_wait)
    try:
        async with get_sessionmaker()() as db:
            rows = await db.scalars(
                text("SELECT agencies_with_stuck_agent_runs(:running, :queued)"),
                {"running": running_before, "queued": queued_before},
            )
            agencies = list(rows.all())
            await db.commit()
    except Exception as exc:
        log.exception("agent_sweep_failed", error_type=type(exc).__name__)
        return 0
    redis = get_shared_redis()
    swept = 0
    for agency_id in agencies:
        try:
            swept += await _sweep_agency(redis, agency_id, running_before, queued_before, now)
        except Exception as exc:
            log.exception(
                "agent_sweep_agency_failed", agency_id=str(agency_id), error_type=type(exc).__name__
            )
    if swept:
        log.warning("agent_stuck_runs_failed", count=swept, agencies=len(agencies))
    return swept


async def _sweep_agency(
    redis: Redis,
    agency_id: UUID,
    running_before: datetime,
    queued_before: datetime,
    now: datetime,
) -> int:
    stuck = _stuck(running_before, queued_before)
    swept = 0
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        found = await db.scalars(select(AgentRun.id).where(AgentRun.agency_id == agency_id, stuck))
        run_ids = list(found.all())
        await db.commit()
        for run_id in run_ids:
            result = await db.execute(
                update(AgentRun)
                .where(AgentRun.id == run_id, stuck)
                .values(status="failed", error=INTERRUPTED, finished_at=now)
                .execution_options(synchronize_session=False)
            )
            await db.commit()
            if not getattr(result, "rowcount", 0):  # it moved on meanwhile
                continue
            swept += 1
            await _release(redis, agency_id, run_id)
            run = await db.get(AgentRun, run_id)
            if run is not None:
                await _publish(db, redis, run)
    return swept


async def stuck_runs_loop(interval_seconds: float) -> None:
    """Sweep now and then every `interval_seconds`, until cancelled (an API process that runs
    the schedules: development)."""
    while True:
        await sweep_stuck_runs()
        await asyncio.sleep(interval_seconds)
