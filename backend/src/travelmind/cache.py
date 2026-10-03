"""The process-wide Redis pool.

The pool's connections are bound to the event loop that opened them. A script that calls
`asyncio.run` more than once must `await close_redis()` (and `close_http_clients()`, and dispose
the engine) before each run ends, so the next run starts fresh pools on its own loop.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from redis.asyncio import BlockingConnectionPool, Redis

from travelmind.config import get_settings

# One pool per process: clients are cheap views over it, so requests never open their own sockets.
# A blocking pool: when every connection is busy a command waits briefly for one to come back
# instead of failing at once (the plain pool raises MaxConnectionsError immediately).
_pool: BlockingConnectionPool | None = None


def _get_pool() -> BlockingConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = BlockingConnectionPool.from_url(
            settings.redis_url,
            max_connections=settings.redis_max_connections,
            timeout=settings.redis_pool_timeout_s,
            socket_connect_timeout=settings.redis_socket_timeout_s,
            socket_timeout=settings.redis_socket_timeout_s,
        )
    return _pool


def get_shared_redis() -> Redis:
    """A client on the process-wide pool, for code that runs outside a request."""
    return Redis(connection_pool=_get_pool())


async def get_redis() -> AsyncIterator[Redis]:
    yield get_shared_redis()  # the pool owns the connections; nothing to close per request


async def close_redis() -> None:
    """Close the shared pool (shutdown, or between `asyncio.run` calls). The next caller gets a
    fresh one."""
    global _pool
    pool, _pool = _pool, None
    if pool is not None:
        await pool.aclose()


RedisClient = Annotated[Redis, Depends(get_redis)]
