"""A run's events: steps written to the database, then published on Redis, and the event stream.

Writing: `StepWriter.emit` stores a step (the next `seq` of its run), commits, and only then
publishes it on `tm:agent:<run_id>`. Status changes are published the same way after their
commit (`publish_status`). Publishing is best effort: a stream that misses a message finds the
step in the database at its next heartbeat.

Streaming (`stream_run`, served as Server-Sent Events):
1. subscribe to the run's channel first,
2. then replay the stored steps after the client's Last-Event-ID and send the run's status,
3. then forward live messages, dropping any step whose seq was already sent.
Subscribing before the replay leaves no gap: a step written meanwhile is in the replay, on the
channel, or both, and the seq check sends it once. Every HEARTBEAT_S without a message the stream
sends a comment (keeping proxies from closing it) and re-reads the database. It closes on a
terminal status, after a final read so no step is left behind, and after MAX_STREAM_S at most
(the browser reconnects with its Last-Event-ID).

Wire format: a step is `id: <seq>`, `event: step`, `data: <StepOut JSON>`; a status is
`event: status`, `data: <RunOut JSON>` with no id (the browser's last event id stays the last
step's); a heartbeat is the comment line `: heartbeat`.
"""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.agent.models import TERMINAL_STATUSES, AgentRun, AgentStep
from travelmind.agent.schemas import RunOut, run_out, step_out
from travelmind.config import get_settings
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.metrics import AGENT_STEPS

log = structlog.get_logger()

HEARTBEAT_S = 15.0
MAX_STREAM_S = 600.0
POLL_WITHOUT_PUBSUB_S = 1.0  # how often a stream without a subscription re-reads the database
PUBSUB_HEALTH_CHECK_S = 30


def channel(run_id: UUID | str) -> str:
    return f"tm:agent:{run_id}"


async def publish(redis: Redis, run_id: UUID | str, message: dict[str, Any]) -> None:
    """Best effort: a failure is logged (streams re-read the database on their heartbeat)."""
    try:
        await redis.publish(channel(run_id), json.dumps(message, ensure_ascii=False))
    except (RedisError, OSError) as exc:
        log.warning("agent_event_publish_failed", error_type=type(exc).__name__)


async def publish_status(redis: Redis, run: AgentRun) -> None:
    await publish(redis, run.id, {"type": "status", "run": run_out(run).model_dump(mode="json")})


class StepWriter:
    """Appends a run's steps in seq order. One writer at a time per run: the job while it runs,
    or the API between jobs (a reply or a decision, written before the next job is queued)."""

    def __init__(
        self, db: AsyncSession, redis: Redis, run_id: UUID, agency_id: UUID, next_seq: int
    ) -> None:
        self.db = db
        self.redis = redis
        self.run_id = run_id
        self.agency_id = agency_id
        self.next_seq = next_seq

    @classmethod
    async def open(
        cls, db: AsyncSession, redis: Redis, run_id: UUID | str, agency_id: UUID | str
    ) -> "StepWriter":
        run, agency = UUID(str(run_id)), UUID(str(agency_id))
        last = await db.scalar(select(func.max(AgentStep.seq)).where(AgentStep.run_id == run))
        return cls(db, redis, run, agency, 0 if last is None else last + 1)

    async def emit(
        self, kind: str, payload: dict[str, Any], duration_ms: int | None = None
    ) -> AgentStep:
        """Store the step (committing the session), then publish it."""
        step = AgentStep(
            run_id=self.run_id,
            agency_id=self.agency_id,
            seq=self.next_seq,
            kind=kind,
            payload=payload,
            duration_ms=None if duration_ms is None else max(0, duration_ms),
        )
        self.db.add(step)
        await self.db.commit()
        self.next_seq += 1
        AGENT_STEPS.labels(kind=kind).inc()
        out = step_out(step).model_dump(mode="json")
        await publish(self.redis, self.run_id, {"type": "step", "step": out})
        return step


async def read_steps(db: AsyncSession, run_id: UUID, after: int) -> list[AgentStep]:
    rows = await db.execute(
        select(AgentStep)
        .where(AgentStep.run_id == run_id, AgentStep.seq > after)
        .order_by(AgentStep.seq)
    )
    return list(rows.scalars())


def sse(event: str, data: dict[str, Any], event_id: int | None = None) -> str:
    lines = [] if event_id is None else [f"id: {event_id}"]
    lines += [f"event: {event}", f"data: {json.dumps(data, ensure_ascii=False)}"]
    return "\n".join(lines) + "\n\n"


HEARTBEAT = ": heartbeat\n\n"


async def _snapshot(
    run_id: UUID, agency_id: UUID, after: int
) -> tuple[RunOut | None, list[dict[str, Any]]]:
    """The run, then its steps after `after`: read in that order, so a terminal run's steps
    are all there (a run's last step is committed before its final status)."""
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        run = await db.get(AgentRun, run_id)
        shown = run_out(run) if run is not None else None
        steps = await read_steps(db, run_id, after)
        out = [step_out(s).model_dump(mode="json") for s in steps]
        await db.commit()
    return shown, out


async def _subscribe(run_id: UUID) -> tuple[Redis, Any]:
    settings = get_settings()
    client = Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=settings.redis_socket_timeout_s,
        health_check_interval=PUBSUB_HEALTH_CHECK_S,
    )
    pubsub = client.pubsub(ignore_subscribe_messages=True)
    try:
        await pubsub.subscribe(channel(run_id))
    except BaseException:
        with contextlib.suppress(Exception):
            await pubsub.aclose()
            await client.aclose()
        raise
    return client, pubsub


class _Stream:
    def __init__(self, run_id: UUID, agency_id: UUID, last: int) -> None:
        self.run_id = run_id
        self.agency_id = agency_id
        self.last = last
        self.done = False

    def steps(self, steps: list[dict[str, Any]]) -> list[str]:
        sent = []
        for step in steps:
            if step["seq"] > self.last:
                self.last = step["seq"]
                sent.append(sse("step", step, step["seq"]))
        return sent

    async def catch_up(self) -> list[str]:
        """Steps the database has after the last sent, then the status if the run is over."""
        run, steps = await _snapshot(self.run_id, self.agency_id, self.last)
        sent = self.steps(steps)
        if run is None or run.status in TERMINAL_STATUSES:
            self.done = True
            if run is not None:
                sent.append(sse("status", run.model_dump(mode="json")))
        return sent

    async def handle(self, message: dict[str, Any]) -> list[str]:
        if message.get("type") == "step":
            step = message.get("step") or {}
            if not isinstance(step.get("seq"), int) or step["seq"] <= self.last:
                return []
            if step["seq"] > self.last + 1:  # a message was missed: read what's stored
                return await self.catch_up()
            return self.steps([step])
        if message.get("type") == "status":
            run = message.get("run") or {}
            if run.get("status") in TERMINAL_STATUSES:
                return await self.catch_up()
            return [sse("status", run)]
        return []


def _decode(raw: Any) -> dict[str, Any] | None:
    data = raw.get("data") if isinstance(raw, dict) else None
    if not isinstance(data, bytes | str):
        return None
    try:
        message = json.loads(data)
    except ValueError:
        return None
    return message if isinstance(message, dict) else None


async def stream_run(run_id: UUID, agency_id: UUID, last_event_id: int) -> AsyncIterator[str]:
    """The run's events as SSE text (see the module docstring)."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + MAX_STREAM_S
    stream = _Stream(run_id, agency_id, last_event_id)
    client: Redis | None = None
    pubsub: Any = None
    try:
        try:
            client, pubsub = await _subscribe(run_id)
        except Exception as exc:  # Redis away: the stream polls the database instead
            log.warning("agent_stream_subscribe_failed", error_type=type(exc).__name__)
        run, steps = await _snapshot(run_id, agency_id, stream.last)
        if run is None:
            return
        for event in stream.steps(steps):
            yield event
        yield sse("status", run.model_dump(mode="json"))
        if run.status in TERMINAL_STATUSES:
            return
        beat = loop.time()
        while loop.time() < deadline:
            raw = None
            if pubsub is not None:
                try:
                    raw = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=HEARTBEAT_S
                    )
                except Exception as exc:
                    log.warning("agent_stream_pubsub_failed", error_type=type(exc).__name__)
                    pubsub = None
            else:
                await asyncio.sleep(min(HEARTBEAT_S, POLL_WITHOUT_PUBSUB_S))
            message = _decode(raw)
            if message is not None:
                events = await stream.handle(message)
            else:
                events = await stream.catch_up()
                if loop.time() - beat >= HEARTBEAT_S or pubsub is not None:
                    beat = loop.time()
                    events.insert(0, HEARTBEAT)
            for event in events:
                yield event
            if stream.done:
                return
    finally:
        if pubsub is not None:
            with contextlib.suppress(Exception):
                await pubsub.aclose()
        if client is not None:
            with contextlib.suppress(Exception):
                await client.aclose()
