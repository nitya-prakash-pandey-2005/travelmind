"""Queueing background jobs for the arq worker (`travelmind.worker`) and reading their status.

Jobs go on arq's default queue in the same Redis (`TM_REDIS_URL`), through arq's own client: its
own connection settings (`arq_redis_settings`, which the worker uses too) and its own pool, made
when first needed and closed by `close_job_queue()`. It never shares the process-wide pool of
`travelmind.cache`, whose short socket timeouts suit the read cache and rate limits, not a job
queue.

A request must never hang on the queue: `enqueue` and `job_status` each give up after
`job_queue_timeout_s` (2 s) with TimeoutError, and opening the pool retries a failed connection
only once (arq's default is 5 retries a second apart).

Callers must map that TimeoutError to 503 Service Unavailable (the queue is unavailable), never
let it surface as a 500: the agent API does (`agent.service.launch` fails the run and raises
QueueUnavailable, which the router answers with 503).
"""

import asyncio
import dataclasses
from typing import Any, Literal

from arq.connections import ArqRedis, RedisSettings, create_pool
from arq.jobs import Job, JobStatus

from travelmind.config import get_settings

JobState = Literal["queued", "running", "done", "failed", "unknown"]

_STATES: dict[JobStatus, JobState] = {
    JobStatus.deferred: "queued",
    JobStatus.queued: "queued",
    JobStatus.in_progress: "running",
    JobStatus.not_found: "unknown",
}

# One failed connect is retried once, after 1 s (arq's delay is whole seconds).
CONN_RETRIES = 1

_queue: ArqRedis | None = None
_queue_lock: asyncio.Lock | None = None


def arq_redis_settings() -> RedisSettings:
    """arq's connection settings, for the worker and for enqueueing alike."""
    settings = RedisSettings.from_dsn(get_settings().redis_url)
    return dataclasses.replace(settings, conn_retries=CONN_RETRIES)


async def queue() -> ArqRedis:
    """The process's arq client (one pool per process; bound to the event loop that opened it,
    like the shared Redis pool, so `close_job_queue()` before that loop ends). Callers racing to
    open it wait for the first one's pool instead of each opening (and leaking) their own."""
    global _queue, _queue_lock
    if _queue is not None:
        return _queue
    if _queue_lock is None:
        _queue_lock = asyncio.Lock()
    async with _queue_lock:
        if _queue is None:
            _queue = await create_pool(arq_redis_settings())
        return _queue


async def close_job_queue() -> None:
    global _queue, _queue_lock
    pool, _queue = _queue, None
    if _queue_lock is not None and not _queue_lock.locked():
        _queue_lock = None  # the next loop gets a fresh lock
    if pool is not None:
        await pool.aclose()


async def enqueue(name: str, *args: Any, job_id: str | None = None) -> str:
    """Queue the worker function `name` with `args`; returns the job id. With `job_id`, a job
    that already exists under that id (queued, running or with a kept result) is not queued
    again, and its id is returned. Raises TimeoutError after `job_queue_timeout_s`: callers must
    map it to 503."""
    async with asyncio.timeout(get_settings().job_queue_timeout_s):
        job = await (await queue()).enqueue_job(name, *args, _job_id=job_id)
    if job is None:  # arq refuses a duplicate id
        assert job_id is not None
        return job_id
    return job.job_id


async def job_status(job_id: str) -> JobState:
    """`queued`, `running`, `done` or `failed` (the job raised), or `unknown` (no such job, or
    its result has expired). Raises TimeoutError after `job_queue_timeout_s`: callers must map it
    to 503."""
    async with asyncio.timeout(get_settings().job_queue_timeout_s):
        job = Job(job_id, await queue())
        status = await job.status()
        if status is JobStatus.complete:
            result = await job.result_info()
            if result is None:  # expired between the two reads
                return "unknown"
            return "done" if result.success else "failed"
    return _STATES[status]
