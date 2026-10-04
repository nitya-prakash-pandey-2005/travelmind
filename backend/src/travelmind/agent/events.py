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

Bounded:
- One Redis subscription per process (`_Hub`): a single PubSub connection, subscribed to a
  run's channel while at least one stream in this process watches that run (reference counted),
  whose reader fans each message out to the streams' own queues. A slow stream whose queue is
  full misses messages, sees the gap in seqs and re-reads the database. If the connection fails,
  every stream is told and falls back to polling the database, backing off from POLL_FIRST_S to
  POLL_MAX_S with jitter (`poll_delay`), heartbeats unchanged.
- At most STREAMS_PER_USER open streams per user and STREAMS_PER_AGENCY per agency, across
  processes (`open_stream`: Redis semaphores keyed by a per-stream holder, held for
  STREAM_SLOT_TTL_S and refreshed on every heartbeat; fails open like the other limits). Past a
  cap the API answers 429 (TOO_MANY_STREAMS). A stream whose response never started (the client
  went away first) holds its slots until their TTL lapses.
- Each heartbeat also re-checks the session (`StreamLease.alive`): a stream whose session was
  revoked (logout) or expired closes.
"""

import asyncio
import contextlib
import json
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

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
from travelmind.semaphore import refresh_slot, release_slot, take_slot

log = structlog.get_logger()

HEARTBEAT_S = 15.0
MAX_STREAM_S = 600.0
POLL_FIRST_S = 1.0  # a stream without a subscription re-reads the database this often at first,
POLL_MAX_S = 5.0  # backing off to this
PUBSUB_HEALTH_CHECK_S = 30
HUB_READ_TIMEOUT_S = 1.0
STREAM_QUEUE_SIZE = 256
STREAMS_PER_USER = 4
STREAMS_PER_AGENCY = 20
STREAM_SLOT_TTL_S = 60.0  # > 3 heartbeats: refreshed on each
TOO_MANY_STREAMS = "Too many live plan views are open. Close one and try again."


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


def poll_delay(attempt: int) -> float:
    """The wait before a stream's `attempt`-th database read without a subscription: 1 s,
    doubling up to 5 s, each ±20%."""
    base = min(POLL_MAX_S, POLL_FIRST_S * 2**attempt)
    return base * random.uniform(0.8, 1.2)


# The hub's message telling a stream its subscription is gone (it polls the database instead).
LOST: dict[str, Any] = {"type": "lost"}


class _Hub:
    """The process's one Redis subscription, shared by its streams (see the module docstring).
    Belongs to one event loop."""

    def __init__(self) -> None:
        self.client: Redis | None = None
        self.pubsub: Any = None
        self.reader: asyncio.Task[None] | None = None
        self.queues: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self.lock = asyncio.Lock()

    def listeners(self, name: str) -> int:
        return len(self.queues.get(name, ()))

    async def subscribe(self, name: str) -> asyncio.Queue[dict[str, Any]]:
        """A queue that receives the channel's messages until `unsubscribe`."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=STREAM_QUEUE_SIZE)
        async with self.lock:
            if self.pubsub is None:
                settings = get_settings()
                self.client = Redis.from_url(
                    settings.redis_url,
                    socket_connect_timeout=settings.redis_socket_timeout_s,
                    health_check_interval=PUBSUB_HEALTH_CHECK_S,
                )
                self.pubsub = self.client.pubsub(ignore_subscribe_messages=True)
            if name not in self.queues:
                try:
                    await self.pubsub.subscribe(name)
                except BaseException:
                    if not self.queues:
                        await self._close()
                    raise
                self.queues[name] = set()
            self.queues[name].add(queue)
            if self.reader is None or self.reader.done():
                self.reader = asyncio.create_task(self._read())
        return queue

    async def unsubscribe(self, name: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self.lock:
            listeners = self.queues.get(name)
            if listeners is None or queue not in listeners:
                return  # the hub dropped it already (a failed connection)
            listeners.discard(queue)
            if listeners:
                return
            del self.queues[name]
            if not self.queues:  # nobody listens: no connection held
                await self._close()
            elif self.pubsub is not None:
                with contextlib.suppress(Exception):
                    await self.pubsub.unsubscribe(name)

    async def _read(self) -> None:
        try:
            while self.queues and self.pubsub is not None:
                raw = await self.pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=HUB_READ_TIMEOUT_S
                )
                if not isinstance(raw, dict):
                    continue
                name = raw.get("channel")
                if isinstance(name, bytes):
                    name = name.decode()
                message = _decode(raw)
                if message is None or not isinstance(name, str):
                    continue
                for queue in list(self.queues.get(name, ())):
                    with contextlib.suppress(asyncio.QueueFull):  # a gap: it re-reads the DB
                        queue.put_nowait(message)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("agent_stream_hub_failed", error_type=type(exc).__name__)
            await self._fail()

    async def _fail(self) -> None:
        """The connection broke: every stream falls back to the database; the next subscribe
        opens a fresh connection."""
        async with self.lock:
            for listeners in self.queues.values():
                for queue in listeners:
                    _put_last(queue, LOST)
            self.queues.clear()
            await self._close()

    async def _close(self) -> None:
        reader, self.reader = self.reader, None
        if reader is not None and reader is not asyncio.current_task():
            reader.cancel()
            with contextlib.suppress(BaseException):
                await reader
        pubsub, client = self.pubsub, self.client
        self.pubsub = self.client = None
        if pubsub is not None:
            with contextlib.suppress(Exception):
                await pubsub.aclose()
        if client is not None:
            with contextlib.suppress(Exception):
                await client.aclose()


def _put_last(queue: asyncio.Queue[dict[str, Any]], message: dict[str, Any]) -> None:
    """Put `message` on the queue, dropping the oldest item if it is full."""
    with contextlib.suppress(asyncio.QueueEmpty):
        if queue.full():
            queue.get_nowait()
    with contextlib.suppress(asyncio.QueueFull):
        queue.put_nowait(message)


_hubs: dict[asyncio.AbstractEventLoop, _Hub] = {}


def _hub() -> _Hub:
    """This event loop's hub (a hub's tasks and connection belong to one loop)."""
    loop = asyncio.get_running_loop()
    for other in [known for known in _hubs if known.is_closed()]:
        del _hubs[other]
    return _hubs.setdefault(loop, _Hub())


def listeners(name: str) -> int:
    """How many of this process's streams watch the channel (tests, metrics)."""
    return _hub().listeners(name)


async def close_hub() -> None:
    """Close this loop's hub (shutdown); open streams fall back to the database."""
    hub = _hubs.pop(asyncio.get_running_loop(), None)
    if hub is not None:
        async with hub.lock:
            for queues in hub.queues.values():
                for queue in queues:
                    _put_last(queue, LOST)
            hub.queues.clear()
            await hub._close()


# --- how many streams --------------------------------------------------------------------------


class TooManyStreams(Exception):
    def __init__(self) -> None:
        super().__init__(TOO_MANY_STREAMS)
        self.message = TOO_MANY_STREAMS


def stream_user_key(user_id: UUID) -> str:
    return f"tm:sem:agent-stream:user:{user_id}"


def stream_agency_key(agency_id: UUID) -> str:
    return f"tm:sem:agent-stream:agency:{agency_id}"


class StreamLease:
    """One open stream's slots (per user and per agency) and its session check."""

    def __init__(
        self,
        redis: Redis,
        user_id: UUID,
        agency_id: UUID,
        holder: str,
        alive: Callable[[], Awaitable[bool]] | None,
    ) -> None:
        self.redis = redis
        self.keys = (stream_user_key(user_id), stream_agency_key(agency_id))
        self.holder = holder
        self.alive = alive

    async def beat(self) -> bool:
        """On a heartbeat: keep the slots and check the session; False closes the stream."""
        for key in self.keys:
            await refresh_slot(self.redis, key, self.holder, ttl_s=STREAM_SLOT_TTL_S)
        return True if self.alive is None else await self.alive()

    async def close(self) -> None:
        for key in self.keys:
            await release_slot(self.redis, key, self.holder)


async def open_stream(
    redis: Redis,
    user_id: UUID,
    agency_id: UUID,
    *,
    alive: Callable[[], Awaitable[bool]] | None = None,
) -> StreamLease:
    """Take a stream slot for the user and one for the agency, or raise TooManyStreams."""
    lease = StreamLease(redis, user_id, agency_id, uuid4().hex, alive)
    user_key, agency_key = lease.keys
    if (
        await take_slot(
            redis, user_key, lease.holder, limit=STREAMS_PER_USER, ttl_s=STREAM_SLOT_TTL_S
        )
        is False
    ):
        raise TooManyStreams
    if (
        await take_slot(
            redis, agency_key, lease.holder, limit=STREAMS_PER_AGENCY, ttl_s=STREAM_SLOT_TTL_S
        )
        is False
    ):
        await release_slot(redis, user_key, lease.holder)
        raise TooManyStreams
    return lease


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


async def stream_run(
    run_id: UUID, agency_id: UUID, last_event_id: int, *, lease: StreamLease | None = None
) -> AsyncIterator[str]:
    """The run's events as SSE text (see the module docstring). `lease` (the stream's slots and
    session check) is released when the stream ends."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + MAX_STREAM_S
    stream = _Stream(run_id, agency_id, last_event_id)
    hub, name = _hub(), channel(run_id)
    queue: asyncio.Queue[dict[str, Any]] | None = None
    try:
        try:
            queue = await hub.subscribe(name)
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
        beat, polls = loop.time(), 0
        while loop.time() < deadline:
            events: list[str] = []
            if queue is not None:
                message: dict[str, Any] | None = None
                try:
                    wait = max(0.0, beat + HEARTBEAT_S - loop.time())
                    message = await asyncio.wait_for(queue.get(), timeout=wait)
                except TimeoutError:
                    pass
                if message is LOST:
                    queue = None  # the hub dropped this stream: poll from now on
                elif message is not None:
                    events = await stream.handle(message)
            else:
                await asyncio.sleep(min(poll_delay(polls), max(0.0, deadline - loop.time())))
                polls += 1
                events = await stream.catch_up()
            if not stream.done and loop.time() - beat >= HEARTBEAT_S:
                beat = loop.time()
                if lease is not None and not await lease.beat():
                    return  # the session is gone: nothing more for this browser
                if queue is not None:
                    events += await stream.catch_up()  # a missed publish still arrives
                events.insert(0, HEARTBEAT)
            for event in events:
                yield event
            if stream.done:
                return
    finally:
        if queue is not None:
            with contextlib.suppress(Exception):
                await asyncio.shield(hub.unsubscribe(name, queue))
        if lease is not None:
            with contextlib.suppress(Exception):
                await asyncio.shield(lease.close())
