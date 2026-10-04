"""A counting semaphore shared by every process through Redis.

Holders live in a sorted set scored by when they took their slot (Redis server time, so clocks on
different hosts don't matter). Taking a slot first drops holders older than the TTL, so a process
that crashed while holding one frees it after `ttl_s` at the latest. Taking and counting happen in
one Lua script, so two processes can't both take the last slot.

If Redis can't be reached the semaphore fails open (the caller runs unlimited), like the rate
limiters: losing Redis must not take the feature down with it.

A caller whose acquire fails mid-flight may have been granted the slot already (the script ran;
the reply never arrived), whether it was cancelled or Redis dropped the reply: it releases the
slot anyway, shielded from cancellation, so the slot doesn't sit idle until its TTL. ZREM of a
slot never taken is a no-op. (When Redis is down, that release fails too and is only logged.)
"""

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

log = structlog.get_logger()

POLL_SECONDS = 0.1

_ACQUIRE = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - ttl)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('ZADD', KEYS[1], now, ARGV[1])
  redis.call('PEXPIRE', KEYS[1], ttl)
  return 1
end
return 0
"""


class SemaphoreBusy(Exception):
    """No slot came free within the wait."""


async def take_slot(
    redis: Redis, key: str, holder: str, *, limit: int, ttl_s: float
) -> bool | None:
    """One attempt to take a slot under `key` for `holder`: True when taken, False when all
    `limit` are held, None when Redis failed (fail open; any slot the attempt may have taken is
    handed back). For a slot held across processes (taken here, released elsewhere by holder)."""
    acquire = redis.register_script(_ACQUIRE)
    try:
        return bool(await acquire(keys=[key], args=[holder, limit, int(ttl_s * 1000)]))
    except (RedisError, OSError) as exc:
        log.warning("semaphore_unavailable", key=key, error_type=type(exc).__name__)
        # The script may have run and taken a slot before the reply was lost (a dropped
        # connection, a socket timeout): hand it back, then fail open.
        await asyncio.shield(release_slot(redis, key, holder))
        return None
    except BaseException:  # cancelled mid-acquire: the slot may be ours already
        await asyncio.shield(release_slot(redis, key, holder))
        raise


@asynccontextmanager
async def redis_semaphore(
    redis: Redis, key: str, *, limit: int, ttl_s: float, wait_s: float
) -> AsyncIterator[None]:
    """Hold one of `limit` slots under `key` for the block. Waits up to `wait_s` for a slot, then
    raises SemaphoreBusy. A slot is held for at most `ttl_s` (a crashed holder's lapses)."""
    holder = uuid4().hex
    deadline = time.monotonic() + wait_s
    while True:
        taken = await take_slot(redis, key, holder, limit=limit, ttl_s=ttl_s)
        if taken is not False:
            acquired = bool(taken)  # None: Redis is down, run without a slot
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SemaphoreBusy
        await asyncio.sleep(min(POLL_SECONDS, remaining))
    try:
        yield
    finally:
        if acquired:
            await asyncio.shield(release_slot(redis, key, holder))


async def release_slot(redis: Redis, key: str, holder: str) -> None:
    """Hand back `holder`'s slot (a no-op for one never taken). A failure is only logged: the
    slot lapses after its TTL."""
    try:
        await redis.zrem(key, holder)
    except (RedisError, OSError) as exc:
        log.warning("semaphore_release_failed", key=key, error_type=type(exc).__name__)
