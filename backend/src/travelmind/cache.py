from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from redis.asyncio import ConnectionPool, Redis

from travelmind.config import get_settings

# One pool per process: clients are cheap views over it, so requests never open their own sockets.
_pool: ConnectionPool | None = None


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = ConnectionPool.from_url(
            settings.redis_url, max_connections=settings.redis_max_connections
        )
    return _pool


def get_shared_redis() -> Redis:
    """A client on the process-wide pool, for code that runs outside a request."""
    return Redis(connection_pool=_get_pool())


async def get_redis() -> AsyncIterator[Redis]:
    yield get_shared_redis()  # the pool owns the connections; nothing to close per request


async def close_redis() -> None:
    """Close the shared pool (shutdown). The next caller gets a fresh one."""
    global _pool
    pool, _pool = _pool, None
    if pool is not None:
        await pool.aclose()


RedisClient = Annotated[Redis, Depends(get_redis)]
