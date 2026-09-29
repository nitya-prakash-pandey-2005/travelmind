from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis

from travelmind.config import get_settings


async def get_redis() -> AsyncIterator[Redis]:
    client = Redis.from_url(get_settings().redis_url)
    try:
        yield client
    finally:
        await client.aclose()


RedisClient = Annotated[Redis, Depends(get_redis)]
