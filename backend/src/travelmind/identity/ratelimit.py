import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

log = structlog.get_logger()


class LoginRateLimiter:
    """Fixed-window counter. Fails open (allows) if Redis is unreachable, and logs it."""

    def __init__(self, redis: Redis, max_attempts: int, window_seconds: int) -> None:
        self._redis = redis
        self._max = max_attempts
        self._window = window_seconds

    async def hit(self, key: str) -> bool:
        try:
            count = await self._redis.incr(key)
            if count == 1:
                await self._redis.expire(key, self._window)
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error=str(exc))
            return True
        return count <= self._max

    async def reset(self, key: str) -> None:
        try:
            await self._redis.delete(key)
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error=str(exc))
