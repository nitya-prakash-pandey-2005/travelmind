import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

log = structlog.get_logger()

# Give back one attempt without ever going below zero (a missing key stays missing).
_REFUND_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
"""


class LoginRateLimiter:
    """Fixed-window counter. Fails open (allows) if Redis is unreachable, and logs it."""

    def __init__(self, redis: Redis, max_attempts: int, window_seconds: int) -> None:
        self._redis = redis
        self._max = max_attempts
        self._window = window_seconds

    async def hit(self, key: str) -> bool:
        try:
            # INCR + EXPIRE NX in one transaction: every counter gets a TTL, so a failure
            # between the two commands can never leave a permanent lockout behind.
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.expire(key, self._window, nx=True)
                count, _ = await pipe.execute()
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error_type=type(exc).__name__)
            return True
        return int(count) <= self._max

    async def reset(self, key: str) -> None:
        try:
            await self._redis.delete(key)
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error_type=type(exc).__name__)

    async def refund(self, key: str) -> None:
        """Give back one attempt, e.g. after a successful login."""
        try:
            await self._redis.eval(_REFUND_SCRIPT, 1, key)
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error_type=type(exc).__name__)
