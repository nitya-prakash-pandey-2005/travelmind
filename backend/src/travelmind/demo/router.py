"""/api/v1/demo: start a labelled demo workspace in one click, and leave it."""

from fastapi import APIRouter, HTTPException, Request, Response, status

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession, utcnow
from travelmind.demo.generator import DemoUnavailable
from travelmind.demo.service import DemoBusy, start_demo_workspace
from travelmind.identity.cookies import set_session_cookie
from travelmind.identity.deps import client_ip, session_context
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.identity.router import logout_route, me_response, revoke_replaced_session
from travelmind.identity.schemas import MeResponse
from travelmind.readcache import InvalidatesAgencyCache

RATE_LIMIT_MESSAGE = "Too many demo workspaces from your network. Please try again later."

demo_router = APIRouter(prefix="/api/v1/demo", tags=["demo"], dependencies=[InvalidatesAgencyCache])


@demo_router.post("", status_code=status.HTTP_201_CREATED)
async def start_demo_route(
    request: Request, response: Response, db: DbSession, redis: RedisClient
) -> MeResponse:
    settings = get_settings()
    limiter = LoginRateLimiter(redis, settings.demo_max_per_ip, settings.demo_window_seconds)
    if not await limiter.hit(f"rl:demo:{client_ip(request) or 'unknown'}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, RATE_LIMIT_MESSAGE)
    try:
        owner, agency, token = await start_demo_workspace(
            db, redis, settings, ctx=session_context(request), now=utcnow()
        )
    except (DemoBusy, DemoUnavailable) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None
    # The demo's session is committed: the one this browser held before is revoked.
    await revoke_replaced_session(request, db, redis, token)
    set_session_cookie(response, token)
    return me_response(owner, agency)


# Leaving the demo is signing out; the workspace itself expires on its own.
demo_router.add_api_route(
    "/exit", logout_route, methods=["POST"], status_code=status.HTTP_204_NO_CONTENT
)
