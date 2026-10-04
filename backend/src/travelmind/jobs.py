"""Queueing background jobs for the arq worker (`travelmind.worker`) and reading their status.

Jobs go on arq's default queue in the shared Redis. The arq client is a thin view over the
process-wide Redis pool (`travelmind.cache`), made when first needed, so enqueueing never opens
sockets of its own and follows the pool across `close_redis()`.
"""

from typing import Any, Literal

from arq.connections import ArqRedis
from arq.jobs import Job, JobStatus

from travelmind.cache import get_shared_redis

JobState = Literal["queued", "running", "done", "failed", "unknown"]

_STATES: dict[JobStatus, JobState] = {
    JobStatus.deferred: "queued",
    JobStatus.queued: "queued",
    JobStatus.in_progress: "running",
    JobStatus.not_found: "unknown",
}


def _pool() -> ArqRedis:
    return ArqRedis(get_shared_redis().connection_pool)


async def enqueue(name: str, *args: Any, job_id: str | None = None) -> str:
    """Queue the worker function `name` with `args`; returns the job id. With `job_id`, a job
    that already exists under that id (queued, running or with a kept result) is not queued
    again, and its id is returned."""
    job = await _pool().enqueue_job(name, *args, _job_id=job_id)
    if job is None:  # arq refuses a duplicate id
        assert job_id is not None
        return job_id
    return job.job_id


async def job_status(job_id: str) -> JobState:
    """`queued`, `running`, `done` or `failed` (the job raised), or `unknown` (no such job, or
    its result has expired)."""
    pool = _pool()
    job = Job(job_id, pool)
    status = await job.status()
    if status is JobStatus.complete:
        result = await job.result_info()
        if result is None:  # expired between the two reads
            return "unknown"
        return "done" if result.success else "failed"
    return _STATES[status]
