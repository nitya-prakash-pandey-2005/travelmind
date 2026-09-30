"""/api/v1/demo: start a labelled demo workspace in one click, and leave it."""

from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession, pinned_session, utcnow
from travelmind.demo.data import AGENCY_NAME, AGENT_NAMES, PRESENTER_NAME
from travelmind.demo.generator import DemoUnavailable, seed_demo_workspace
from travelmind.identity import service as identity_service
from travelmind.identity.cookies import set_session_cookie
from travelmind.identity.deps import client_ip, session_context
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.identity.router import logout_route, me_response
from travelmind.identity.schemas import MeResponse

RATE_LIMIT_MESSAGE = "Too many demo workspaces from your network. Please try again later."

demo_router = APIRouter(prefix="/api/v1/demo", tags=["demo"])


@demo_router.post("", status_code=status.HTTP_201_CREATED)
async def start_demo_route(
    request: Request, response: Response, db: DbSession, redis: RedisClient
) -> MeResponse:
    settings = get_settings()
    limiter = LoginRateLimiter(redis, settings.demo_max_per_ip, settings.demo_window_seconds)
    if not await limiter.hit(f"rl:demo:{client_ip(request) or 'unknown'}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, RATE_LIMIT_MESSAGE)
    now = utcnow()
    owner, agency, team, token = await identity_service.create_demo_agency(
        db,
        agency_name=AGENCY_NAME,
        owner_name=PRESENTER_NAME,
        agent_names=AGENT_NAMES,
        expires_at=now + timedelta(days=settings.demo_ttl_days),
        ctx=session_context(request),
    )
    agency_settings = await identity_service.get_agency_settings(db, agency.id)
    try:
        # Seeding commits after every search: one pinned connection serves them all.
        async with pinned_session() as seed_db:
            await seed_demo_workspace(
                seed_db, redis, settings, agency=agency_settings, users=team, now=now
            )
    except Exception as exc:
        # Never leave a half-built demo behind: its owner's session goes with it.
        await identity_service.delete_demo_agency(db, agency_settings.id)
        await db.commit()
        if isinstance(exc, DemoUnavailable):
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None
        raise
    set_session_cookie(response, token)
    return me_response(owner, agency)


# Leaving the demo is signing out; the workspace itself expires on its own.
demo_router.add_api_route(
    "/exit", logout_route, methods=["POST"], status_code=status.HTTP_204_NO_CONTENT
)
