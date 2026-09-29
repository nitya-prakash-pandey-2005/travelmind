import structlog
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from travelmind.db import DbSession

router = APIRouter()
log = structlog.get_logger()


@router.get("/health")
async def health(db: DbSession) -> JSONResponse:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        log.warning("health_database_unavailable", error=str(exc))
        return JSONResponse({"status": "degraded", "database": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ok", "database": "ok"})
