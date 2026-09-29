from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.identity import invitations, service
from travelmind.identity.cookies import clear_session_cookie, set_session_cookie
from travelmind.identity.deps import (
    AuthedUser,
    CurrentUser,
    client_ip,
    require_role,
    session_context,
)
from travelmind.identity.models import Agency, User
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.identity.schemas import (
    AgencyOut,
    InvitationAccept,
    InvitationCreate,
    InvitationCreated,
    InvitationOut,
    LoginRequest,
    MeResponse,
    SignupRequest,
    TeamMember,
    UserOut,
)

auth_router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def me_response(user: User, agency: Agency) -> MeResponse:
    return MeResponse(
        user=UserOut(id=user.id, email=user.email, full_name=user.full_name, role=user.role),
        agency=AgencyOut(id=agency.id, name=agency.name),
    )


@auth_router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup_route(
    body: SignupRequest,
    request: Request,
    response: Response,
    db: DbSession,
    redis: RedisClient,
) -> MeResponse:
    settings = get_settings()
    signup_limiter = LoginRateLimiter(
        redis, settings.signup_max_per_ip, settings.signup_window_seconds
    )
    if not await signup_limiter.hit(f"rl:signup:{client_ip(request) or 'unknown'}"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many sign-up attempts from your network. Please try again later.",
        )
    try:
        user, agency, token = await service.signup(
            db,
            agency_name=body.agency_name,
            full_name=body.full_name,
            email=body.email,
            password=body.password,
            ctx=session_context(request),
        )
    except service.EmailAlreadyRegistered:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists."
        ) from None
    set_session_cookie(response, token)
    return me_response(user, agency)


@auth_router.post("/login")
async def login_route(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    redis: RedisClient,
) -> MeResponse:
    settings = get_settings()
    ip = client_ip(request) or "unknown"
    # Per-IP ceiling stops one client rotating emails; never reset on success.
    ip_limiter = LoginRateLimiter(
        redis, settings.login_ip_max_attempts, settings.login_window_seconds
    )
    limiter = LoginRateLimiter(redis, settings.login_max_attempts, settings.login_window_seconds)
    key = f"rl:login:{ip}:{body.email}"
    if not await ip_limiter.hit(f"rl:login-ip:{ip}") or not await limiter.hit(key):
        minutes = settings.login_window_seconds // 60
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many sign-in attempts. Please wait {minutes} minutes and try again.",
        )
    try:
        user, agency, token = await service.login(
            db, email=body.email, password=body.password, ctx=session_context(request)
        )
    except service.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.") from None
    await limiter.reset(key)
    set_session_cookie(response, token)
    return me_response(user, agency)


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_route(request: Request, db: DbSession) -> Response:
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        await service.revoke_session(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response)
    return response


@auth_router.get("/me")
async def me_route(current: AuthedUser, db: DbSession) -> MeResponse:
    user, agency = await service.get_user_and_agency(db, current.id)
    return me_response(user, agency)


invitations_router = APIRouter(prefix="/api/v1/invitations", tags=["team"])
team_router = APIRouter(prefix="/api/v1/team", tags=["team"])
ManagerUser = Annotated[CurrentUser, Depends(require_role("owner", "admin"))]


@invitations_router.post("", status_code=status.HTTP_201_CREATED)
async def create_invitation_route(
    body: InvitationCreate, current: ManagerUser, db: DbSession
) -> InvitationCreated:
    try:
        invitation, token = await invitations.create_invitation(
            db,
            agency_id=current.agency_id,
            invited_by_user_id=current.id,
            email=body.email,
            role=body.role,
        )
    except invitations.InvitationConflict:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This person already has a TravelMind account."
        ) from None
    return InvitationCreated(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
        token=token,
    )


@invitations_router.get("")
async def list_invitations_route(current: ManagerUser, db: DbSession) -> list[InvitationOut]:
    pending = await invitations.list_pending_invitations(db, current.agency_id)
    return [
        InvitationOut(
            id=i.id, email=i.email, role=i.role, created_at=i.created_at, expires_at=i.expires_at
        )
        for i in pending
    ]


@invitations_router.post("/accept", status_code=status.HTTP_201_CREATED)
async def accept_invitation_route(
    body: InvitationAccept, request: Request, response: Response, db: DbSession
) -> MeResponse:
    try:
        user, agency, token = await invitations.accept_invitation(
            db,
            token=body.token,
            full_name=body.full_name,
            password=body.password,
            ctx=session_context(request),
        )
    except invitations.InvalidInvitation:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, invitations.INVALID_INVITATION_MESSAGE
        ) from None
    set_session_cookie(response, token)
    return me_response(user, agency)


@team_router.get("")
async def team_route(current: AuthedUser, db: DbSession) -> list[TeamMember]:
    members = await service.list_team(db, current.agency_id)
    return [TeamMember(id=m.id, email=m.email, full_name=m.full_name, role=m.role) for m in members]
