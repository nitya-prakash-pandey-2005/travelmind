import asyncio
from collections.abc import Awaitable

import structlog
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from travelmind.cache import RedisClient
from travelmind.db import DbSession

router = APIRouter()
log = structlog.get_logger()
READY_TIMEOUT_SECONDS = 2.0  # caps the whole readiness check; both parts run concurrently


@router.get("/health")
async def health(db: DbSession) -> JSONResponse:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        log.warning("health_database_unavailable", error=str(exc))
        return JSONResponse({"status": "degraded", "database": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ok", "database": "ok"})


async def _check(part: str, probe: Awaitable[object], timeout_s: float) -> str:
    try:
        async with asyncio.timeout(timeout_s):
            await probe
    except Exception as exc:
        # Type only: driver messages can carry hosts and connection details.
        log.warning("ready_check_failed", part=part, error_type=type(exc).__name__)
        return "unavailable"
    return "ok"


@router.get("/ready")
async def ready(db: DbSession, redis: RedisClient) -> JSONResponse:
    """Readiness for load balancers: the database and Redis both answer within the time limit."""
    timeout_s = READY_TIMEOUT_SECONDS
    database, cache = await asyncio.gather(
        _check("database", db.execute(text("SELECT 1")), timeout_s),
        _check("redis", redis.ping(), timeout_s),
    )
    ok = database == "ok" and cache == "ok"
    return JSONResponse(
        {"status": "ready" if ok else "unavailable", "database": database, "redis": cache},
        status_code=200 if ok else 503,
    )
