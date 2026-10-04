from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status

from travelmind.config import get_settings
from travelmind.db import DbSession, bind_tenant
from travelmind.identity import service
from travelmind.identity.sessioncache import session_cache
from travelmind.identity.tokens import hash_token


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    agency_id: UUID
    email: str
    full_name: str
    role: str


async def get_current_user(request: Request, db: DbSession) -> CurrentUser:
    """The signed-in user, from the per-process session cache (sessioncache) or the database."""
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")
    token_hash = hash_token(token)
    cache = session_cache()
    user = cache.get(token_hash)
    if not isinstance(user, CurrentUser):
        generation = cache.generation
        found = await service.find_session_user(db, token_hash)
        # End the lookup's transaction now: the endpoint's own statements begin a fresh one,
        # which carries the tenant bound below (db.TenantSession re-applies it on every begin).
        await db.commit()
        if found is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again."
            )
        user = CurrentUser(
            id=found.id,
            agency_id=found.agency_id,
            email=found.email,
            full_name=found.full_name,
            role=found.role,
        )
        cache.put(
            token_hash,
            user,
            user_id=user.id,
            agency_id=user.agency_id,
            expires_at=found.expires_at,
            generation=generation,
        )
    await bind_tenant(db, user.agency_id)
    return user


AuthedUser = Annotated[CurrentUser, Depends(get_current_user)]


def require_role(*roles: str) -> Callable[..., Awaitable[CurrentUser]]:
    async def _require(user: AuthedUser) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to do that.")
        return user

    return _require


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def session_context(request: Request) -> service.SessionContext:
    return service.SessionContext(
        user_agent=request.headers.get("user-agent"), ip_address=client_ip(request)
    )
