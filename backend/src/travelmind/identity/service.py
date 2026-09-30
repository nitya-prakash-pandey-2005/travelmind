import asyncio
import secrets
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, text, update
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


DEMO_LOCKED_MESSAGE = "Demo workspaces can't invite people or change settings."


class DemoWorkspaceLocked(Exception):
    """A demo workspace is shared sample data: it can't invite people or change its settings."""


async def ensure_not_demo(db: AsyncSession, agency_id: UUID) -> Agency:
    """The agency, unless it is a demo workspace (then DemoWorkspaceLocked)."""
    agency = await db.get_one(Agency, agency_id)
    if agency.is_demo:
        raise DemoWorkspaceLocked
    return agency


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


# Demo accounts get server-made addresses on a reserved domain (never validated as input, never
# deliverable) and a random password nobody is told: the only way in is the session made here.
DEMO_EMAIL_DOMAIN = "demo.travelmind.invalid"
DEMO_PASSWORD_BYTES = 32


def _demo_email(local_part: str) -> str:
    return f"{local_part}+{uuid4().hex}@{DEMO_EMAIL_DOMAIN}"


async def create_demo_agency(
    db: AsyncSession,
    *,
    agency_name: str,
    owner_name: str,
    agent_names: Sequence[str],
    expires_at: datetime,
    ctx: SessionContext,
    country_code: str = "IN",
) -> tuple[User, Agency, list["TeamMember"], str]:
    """A labelled demo agency (`is_demo`, deleted after `expires_at`) with its owner (the
    presenter) and agents, and a session for the owner. Commits.

    Returns the owner, the agency, the whole team (owner first) and the session token.
    """
    people = [
        (owner_name, "owner", "presenter"),
        *((name, "agent", name.split()[0].lower()) for name in agent_names),
    ]
    hashes = await asyncio.gather(
        *(hash_password_async(secrets.token_urlsafe(DEMO_PASSWORD_BYTES)) for _ in people)
    )
    agency = Agency(
        id=uuid4(),
        name=agency_name,
        country_code=country_code,
        currency=default_currency_for(country_code),
        timezone=default_timezone_for(country_code),
        is_demo=True,
        demo_expires_at=expires_at,
    )
    users = [
        User(
            id=uuid4(),
            agency_id=agency.id,
            email=_demo_email(local_part),
            full_name=full_name,
            password_hash=password_hash,
            role=role,
        )
        for (full_name, role, local_part), password_hash in zip(people, hashes, strict=True)
    ]
    db.add(agency)
    await db.flush()
    db.add_all(users)
    await db.flush()
    owner = users[0]
    await bind_tenant(db, agency.id)
    await record_event(
        db,
        agency_id=agency.id,
        actor_user_id=owner.id,
        action="agency.created",
        entity_type="agency",
        entity_id=str(agency.id),
        after={"name": agency.name, "demo": True},
    )
    token = start_session(db, owner, ctx)
    await db.commit()
    return owner, agency, [TeamMember(id=u.id, full_name=u.full_name) for u in users], token


async def delete_demo_agency(db: AsyncSession, agency_id: UUID) -> None:
    """Remove one demo agency and (by cascade) all its data. Never touches a real agency.
    The caller commits."""
    await db.execute(delete(Agency).where(Agency.id == agency_id, Agency.is_demo.is_(True)))


async def delete_expired_demo_agencies(db: AsyncSession, *, now: datetime) -> list[UUID]:
    """Delete every demo agency that expired before `now`; foreign keys cascade to all its
    tenant rows. Returns the deleted ids. The caller commits."""
    result = await db.execute(
        text("DELETE FROM agencies WHERE is_demo AND demo_expires_at < :now RETURNING id"),
        {"now": now},
    )
    return list(result.scalars().all())


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
    Raises DemoWorkspaceLocked for a demo workspace.

    `agencies` has no RLS, so `agency_id` must come from the authenticated user.
    """
    unknown = changes.keys() - AGENCY_PROFILE_FIELDS
    if unknown:
        raise ValueError(f"Not an agency profile field: {sorted(unknown)}")
    agency = await ensure_not_demo(db, agency_id)
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


@dataclass(frozen=True)
class TeamMember:
    """A teammate as other packages may see them: no email, role or credentials."""

    id: UUID
    full_name: str


async def get_team_member(db: AsyncSession, agency_id: UUID, user_id: UUID) -> TeamMember | None:
    """The active user `user_id` if they belong to `agency_id` (who work can be assigned to)."""
    # `users` has no RLS, so the agency filter here is the isolation boundary.
    row = (
        await db.execute(
            select(User.id, User.full_name).where(
                User.id == user_id, User.agency_id == agency_id, User.is_active.is_(True)
            )
        )
    ).one_or_none()
    return None if row is None else TeamMember(id=row.id, full_name=row.full_name)


async def team_names(
    db: AsyncSession, agency_id: UUID, user_ids: Iterable[UUID]
) -> dict[UUID, str]:
    """Display names for the given users of `agency_id` (deactivated users included)."""
    wanted = set(user_ids)
    if not wanted:
        return {}
    rows = await db.execute(
        select(User.id, User.full_name).where(User.agency_id == agency_id, User.id.in_(wanted))
    )
    return {row.id: row.full_name for row in rows}


@dataclass(frozen=True)
class AgencySettings:
    """What other packages need to know about an agency to compute its figures."""

    id: UUID
    currency: str
    timezone: str
    is_demo: bool


async def get_agency_settings(db: AsyncSession, agency_id: UUID) -> AgencySettings:
    agency = await db.get_one(Agency, agency_id)
    return AgencySettings(
        id=agency.id, currency=agency.currency, timezone=agency.timezone, is_demo=agency.is_demo
    )


@dataclass(frozen=True)
class ActiveMember:
    """An active teammate with their role (for team figures): no email or credentials."""

    id: UUID
    full_name: str
    role: str


async def list_active_members(db: AsyncSession, agency_id: UUID) -> list[ActiveMember]:
    # `users` has no RLS, so the agency filter here is the isolation boundary.
    rows = await db.execute(
        select(User.id, User.full_name, User.role)
        .where(User.agency_id == agency_id, User.is_active.is_(True))
        .order_by(User.created_at, User.email)
    )
    return [ActiveMember(id=row.id, full_name=row.full_name, role=row.role) for row in rows]


async def get_notifications_read_until(db: AsyncSession, user_id: UUID) -> datetime:
    """Events up to this instant are read for the user: when they last marked notifications
    seen, else when they joined (a new teammate doesn't inherit the agency's history)."""
    read_until = await db.scalar(
        select(func.coalesce(User.notifications_seen_at, User.created_at)).where(User.id == user_id)
    )
    assert read_until is not None
    return read_until


async def mark_notifications_seen(
    db: AsyncSession, user_id: UUID, *, until: datetime | None = None, now: datetime | None = None
) -> None:
    """Everything up to `until` (the newest event the user was shown), capped at `now`, counts as
    read; without `until`, everything up to `now`. Never moves back past what was already read
    (see get_notifications_read_until). The caller commits."""
    at = now or datetime.now(UTC)
    if until is not None:
        at = min(at, until)
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            notifications_seen_at=func.greatest(
                func.coalesce(User.notifications_seen_at, User.created_at), at
            )
        )
    )
