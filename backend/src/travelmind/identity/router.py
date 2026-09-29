from fastapi import APIRouter, HTTPException, Request, Response, status

from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.identity import service
from travelmind.identity.cookies import clear_session_cookie, set_session_cookie
from travelmind.identity.deps import AuthedUser, session_context
from travelmind.identity.models import Agency, User
from travelmind.identity.schemas import (
    AgencyOut,
    LoginRequest,
    MeResponse,
    SignupRequest,
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
    body: SignupRequest, request: Request, response: Response, db: DbSession
) -> MeResponse:
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
    body: LoginRequest, request: Request, response: Response, db: DbSession
) -> MeResponse:
    try:
        user, agency, token = await service.login(
            db, email=body.email, password=body.password, ctx=session_context(request)
        )
    except service.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.") from None
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
