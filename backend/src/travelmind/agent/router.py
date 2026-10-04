"""The agent API under /api/v1/agent: runs, their live event stream, replies, confirmations.

Every route needs a session and works only on the caller's agency's runs (RLS, plus the agency in
every query): another agency's run is 404 everywhere. Responses mirror the run and its steps
(`agent.schemas`), never its working state.

No route takes the read-cache dependency: runs and steps are not cached, and the write tools that
change cached data (create_enquiry, draft_quote) bump the agency's cache themselves when the
job runs them.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from travelmind.agent import budget, events, service
from travelmind.agent.provider import AgentUnavailable
from travelmind.agent.schemas import (
    Availability,
    ConfirmIn,
    CreatedRun,
    CreateRunIn,
    ReplyIn,
    RunDetail,
    RunList,
    RunOut,
    run_detail,
    run_out,
)
from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.identity.deps import AuthedUser

agent_router = APIRouter(prefix="/api/v1/agent", tags=["agent"])

NOT_FOUND = "Plan not found."
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",  # nginx: pass each event on at once
}


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, service.RunNotFound):
        return HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    if isinstance(exc, service.RunConflict):
        return HTTPException(status.HTTP_409_CONFLICT, exc.message)
    if isinstance(exc, service.RateLimited | budget.TooManyRuns | budget.BudgetExceeded):
        return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc))
    if isinstance(exc, service.QueueUnavailable):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, exc.message)
    if isinstance(exc, AgentUnavailable):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, exc.message)
    raise exc


_ERRORS = (
    service.RunNotFound,
    service.RunConflict,
    service.RateLimited,
    service.QueueUnavailable,
    budget.TooManyRuns,
    budget.BudgetExceeded,
    AgentUnavailable,
)


@agent_router.get("/availability")
async def availability_route(_current: AuthedUser) -> Availability:
    return service.availability(get_settings())


@agent_router.post("/runs", status_code=status.HTTP_202_ACCEPTED)
async def create_run_route(
    body: CreateRunIn, current: AuthedUser, db: DbSession, redis: RedisClient
) -> CreatedRun:
    settings = get_settings()
    try:
        provider = service.get_provider(settings)
        run = await service.create_run(
            db,
            redis,
            settings,
            agency_id=current.agency_id,
            user_id=current.id,
            prompt=body.prompt,
            provider=provider,
        )
        await db.close()  # no connection held while the job is queued
        await service.launch(run.id, current.agency_id, settings)
    except _ERRORS as exc:
        raise _http(exc) from None
    return CreatedRun(run_id=run.id, status=run.status)


@agent_router.get("/runs")
async def list_runs_route(
    current: AuthedUser, db: DbSession, limit: Annotated[int, Query(ge=1, le=50)] = 20
) -> RunList:
    runs = await service.list_runs(db, current.agency_id, limit=limit)
    return RunList(items=[run_out(run) for run in runs])


@agent_router.get("/runs/{run_id}")
async def get_run_route(run_id: UUID, current: AuthedUser, db: DbSession) -> RunDetail:
    try:
        run = await service.get_run(db, current.agency_id, run_id)
    except service.RunNotFound as exc:
        raise _http(exc) from None
    return run_detail(run, await service.list_steps(db, run.id))


def _last_event_id(header: str | None, query: str | None) -> int:
    for value in (header, query):
        if value is not None and value.strip().lstrip("-").isdigit():
            return max(-1, int(value.strip()))
    return -1


@agent_router.get("/runs/{run_id}/events")
async def run_events_route(
    run_id: UUID,
    current: AuthedUser,
    db: DbSession,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
    last_event_id_query: Annotated[str | None, Query(alias="last_event_id", max_length=12)] = None,
) -> StreamingResponse:
    """Server-Sent Events: the stored steps after Last-Event-ID (the header, or the
    `last_event_id` query parameter for a first connection, which can't set headers), then the
    live ones, a heartbeat comment every 15 s, closing on a final status (`agent.events`)."""
    try:
        await service.get_run(db, current.agency_id, run_id)
    except service.RunNotFound as exc:
        raise _http(exc) from None
    await db.close()  # the stream reads with its own short sessions
    after = _last_event_id(last_event_id, last_event_id_query)
    return StreamingResponse(
        events.stream_run(run_id, current.agency_id, after),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@agent_router.post("/runs/{run_id}/reply", status_code=status.HTTP_202_ACCEPTED)
async def reply_route(
    run_id: UUID, body: ReplyIn, current: AuthedUser, db: DbSession, redis: RedisClient
) -> RunOut:
    settings = get_settings()
    try:
        run = await service.reply(
            db,
            redis,
            settings,
            agency_id=current.agency_id,
            user_id=current.id,
            run_id=run_id,
            text=body.text,
        )
        shown = run_out(run)
        await db.close()
        await service.launch(run.id, current.agency_id, settings)
    except _ERRORS as exc:
        raise _http(exc) from None
    return shown


@agent_router.post("/runs/{run_id}/confirm", status_code=status.HTTP_202_ACCEPTED)
async def confirm_route(
    run_id: UUID, body: ConfirmIn, current: AuthedUser, db: DbSession, redis: RedisClient
) -> RunOut:
    settings = get_settings()
    try:
        run = await service.confirm(
            db,
            redis,
            settings,
            agency_id=current.agency_id,
            user_id=current.id,
            run_id=run_id,
            call_id=body.call_id,
            approve=body.approve,
        )
        shown = run_out(run)
        await db.close()
        await service.launch(run.id, current.agency_id, settings)
    except _ERRORS as exc:
        raise _http(exc) from None
    return shown


@agent_router.post("/runs/{run_id}/cancel")
async def cancel_route(
    run_id: UUID, current: AuthedUser, db: DbSession, redis: RedisClient
) -> RunOut:
    try:
        run = await service.cancel(db, redis, agency_id=current.agency_id, run_id=run_id)
    except _ERRORS as exc:
        raise _http(exc) from None
    return run_out(run)
