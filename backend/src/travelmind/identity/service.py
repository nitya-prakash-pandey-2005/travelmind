from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.audit.service import record_event
from travelmind.config import get_settings
from travelmind.db import bind_tenant
from travelmind.identity.models import Agency, User, UserSession
from travelmind.identity.passwords import hash_password, hash_password_async, verify_password_async
from travelmind.identity.tokens import hash_token, new_token
from travelmind.workspace.regions import default_currency_for, default_timezone_for

# Verified against when the email is unknown, so response time doesn't reveal which emails exist.
# Argon2 is CPU-heavy (~50 ms): request paths use the bounded async wrappers in passwords.py.
_TIMING_DUMMY_HASH = hash_password("timing-equalizer-not-a-real-password")


class EmailAlreadyRegistered(Exception):
    pass


class InvalidCredentials(Exception):
    pass


@dataclass(frozen=True)
class SessionContext:
    user_agent: str | None
    ip_address: str | None


def start_session(db: AsyncSession, user: User, ctx: SessionContext) -> str:
    token = new_token()
    ttl = timedelta(hours=get_settings().session_ttl_hours)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + ttl,
            user_agent=ctx.user_agent[:500] if ctx.user_agent else None,
            ip_address=ctx.ip_address,
        )
    )
    return token


async def signup(
    db: AsyncSession,
    *,
    agency_name: str,
    full_name: str,
    email: str,
    password: str,
    ctx: SessionContext,
    country_code: str = "IN",
) -> tuple[User, Agency, str]:
    if await db.scalar(select(User.id).where(User.email == email)) is not None:
        raise EmailAlreadyRegistered
    password_hash = await hash_password_async(password)
    agency = Agency(
        id=uuid4(),
        name=agency_name,
        country_code=country_code,
        currency=default_currency_for(country_code),
        timezone=default_timezone_for(country_code),
    )
    user = User(
        id=uuid4(),
        agency_id=agency.id,
        email=email,
        full_name=full_name,
        password_hash=password_hash,
        role="owner",
    )
    try:
        db.add(agency)
        await db.flush()
        db.add(user)
        await db.flush()
    except IntegrityError as exc:  # concurrent signup with the same email
        await db.rollback()
        raise EmailAlreadyRegistered from exc
    await bind_tenant(db, agency.id)
    await record_event(
        db,
        agency_id=agency.id,
        actor_user_id=user.id,
        action="agency.created",
        entity_type="agency",
        entity_id=str(agency.id),
        after={"name": agency.name},
    )
    token = start_session(db, user, ctx)
    await db.commit()
    return user, agency, token


async def login(
    db: AsyncSession, *, email: str, password: str, ctx: SessionContext
) -> tuple[User, Agency, str]:
    user = await db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        await verify_password_async(_TIMING_DUMMY_HASH, password)
        raise InvalidCredentials
    if not await verify_password_async(user.password_hash, password):
        raise InvalidCredentials
    agency = await db.get_one(Agency, user.agency_id)
    await bind_tenant(db, user.agency_id)
    await record_event(
        db,
        agency_id=user.agency_id,
        actor_user_id=user.id,
        action="auth.login",
        entity_type="user",
        entity_id=str(user.id),
    )
    token = start_session(db, user, ctx)
    await db.commit()
    return user, agency, token


async def get_user_for_session_token(db: AsyncSession, token: str) -> User | None:
    return await db.scalar(
        select(User)
        .join(UserSession, UserSession.user_id == User.id)
        .where(
            UserSession.token_hash == hash_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(UTC),
            User.is_active.is_(True),
        )
    )


async def revoke_session(db: AsyncSession, token: str) -> None:
    await db.execute(
        update(UserSession)
        .where(UserSession.token_hash == hash_token(token), UserSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()


async def get_user_and_agency(db: AsyncSession, user_id: UUID) -> tuple[User, Agency]:
    user = await db.get_one(User, user_id)
    agency = await db.get_one(Agency, user.agency_id)
    return user, agency


async def get_agency(db: AsyncSession, agency_id: UUID) -> Agency:
    return await db.get_one(Agency, agency_id)


# Agency fields an owner or admin may change from the settings screen.
AGENCY_PROFILE_FIELDS = frozenset({"name", "country_code", "currency", "timezone", "brand_color"})


async def update_agency_profile(
    db: AsyncSession, agency_id: UUID, changes: dict[str, str]
) -> tuple[Agency, dict[str, str], dict[str, str]]:
    """Apply profile changes; returns the agency plus the (before, after) of what changed.

    `agencies` has no RLS, so `agency_id` must come from the authenticated user.
    """
    unknown = changes.keys() - AGENCY_PROFILE_FIELDS
    if unknown:
        raise ValueError(f"Not an agency profile field: {sorted(unknown)}")
    agency = await db.get_one(Agency, agency_id)
    before: dict[str, str] = {}
    after: dict[str, str] = {}
    for field, value in changes.items():
        if getattr(agency, field) != value:
            before[field] = getattr(agency, field)
            after[field] = value
            setattr(agency, field, value)
    if after:
        agency.updated_at = datetime.now(UTC)
        await db.flush()
    return agency, before, after


async def list_team(db: AsyncSession, agency_id: UUID) -> list[User]:
    # `users` has no RLS, so the agency filter here is the isolation boundary.
    result = await db.scalars(
        select(User).where(User.agency_id == agency_id).order_by(User.created_at, User.email)
    )
    return list(result.all())
