"""A counting semaphore shared by every process through Redis.

Holders live in a sorted set scored by when they took their slot (Redis server time, so clocks on
different hosts don't matter). Taking a slot first drops holders older than the TTL, so a process
that crashed while holding one frees it after `ttl_s` at the latest. Taking and counting happen in
one Lua script, so two processes can't both take the last slot.

If Redis can't be reached the semaphore fails open (the caller runs unlimited), like the rate
limiters: losing Redis must not take the feature down with it.
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


@asynccontextmanager
async def redis_semaphore(
    redis: Redis, key: str, *, limit: int, ttl_s: float, wait_s: float
) -> AsyncIterator[None]:
    """Hold one of `limit` slots under `key` for the block. Waits up to `wait_s` for a slot, then
    raises SemaphoreBusy. A slot is held for at most `ttl_s` (a crashed holder's lapses)."""
    holder = uuid4().hex
    acquire = redis.register_script(_ACQUIRE)
    deadline = time.monotonic() + wait_s
    acquired = False
    while True:
        try:
            if await acquire(keys=[key], args=[holder, limit, int(ttl_s * 1000)]):
                acquired = True
                break
        except (RedisError, OSError) as exc:
            log.warning("semaphore_unavailable", key=key, error_type=type(exc).__name__)
            break  # fail open
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SemaphoreBusy
        await asyncio.sleep(min(POLL_SECONDS, remaining))
    try:
        yield
    finally:
        if acquired:
            try:
                await redis.zrem(key, holder)
            except (RedisError, OSError) as exc:  # the slot lapses after its TTL
                log.warning("semaphore_release_failed", key=key, error_type=type(exc).__name__)
