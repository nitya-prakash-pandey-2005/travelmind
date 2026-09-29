from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from travelmind.audit.service import record_event
from travelmind.config import get_settings
from travelmind.db import bind_tenant
from travelmind.identity.models import Agency, Invitation, User
from travelmind.identity.passwords import hash_password
from travelmind.identity.service import SessionContext, start_session
from travelmind.identity.tokens import hash_token, make_scoped_token, split_scoped_token

INVALID_INVITATION_MESSAGE = "This invitation link is invalid or has expired."


class InvitationConflict(Exception):
    pass


class InvalidInvitation(Exception):
    pass


async def create_invitation(
    db: AsyncSession, *, agency_id: UUID, invited_by_user_id: UUID, email: str, role: str
) -> tuple[Invitation, str]:
    if await db.scalar(select(User.id).where(User.email == email)) is not None:
        raise InvitationConflict
    token, secret = make_scoped_token(agency_id)
    invitation = Invitation(
        agency_id=agency_id,
        email=email,
        role=role,
        token_hash=hash_token(secret),
        invited_by_user_id=invited_by_user_id,
        expires_at=datetime.now(UTC) + timedelta(hours=get_settings().invitation_ttl_hours),
    )
    db.add(invitation)
    await db.flush()
    await record_event(
        db,
        agency_id=agency_id,
        actor_user_id=invited_by_user_id,
        action="invitation.created",
        entity_type="invitation",
        entity_id=str(invitation.id),
        after={"email": email, "role": role},
    )
    await db.commit()
    return invitation, token


async def list_pending_invitations(db: AsyncSession, agency_id: UUID) -> list[Invitation]:
    result = await db.scalars(
        select(Invitation)
        .where(
            Invitation.agency_id == agency_id,
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > datetime.now(UTC),
        )
        .order_by(Invitation.created_at)
    )
    return list(result.all())


async def accept_invitation(
    db: AsyncSession, *, token: str, full_name: str, password: str, ctx: SessionContext
) -> tuple[User, Agency, str]:
    parsed = split_scoped_token(token)
    if parsed is None:
        raise InvalidInvitation
    agency_id, secret = parsed
    await bind_tenant(db, agency_id)
    invitation = await db.scalar(
        select(Invitation).where(Invitation.token_hash == hash_token(secret)).with_for_update()
    )
    now = datetime.now(UTC)
    if invitation is None or invitation.accepted_at is not None or invitation.expires_at <= now:
        raise InvalidInvitation
    if await db.scalar(select(User.id).where(User.email == invitation.email)) is not None:
        raise InvalidInvitation
    password_hash = await run_in_threadpool(hash_password, password)
    user = User(
        id=uuid4(),
        agency_id=invitation.agency_id,
        email=invitation.email,
        full_name=full_name,
        password_hash=password_hash,
        role=invitation.role,
    )
    try:
        db.add(user)
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise InvalidInvitation from exc
    invitation.accepted_at = now
    await record_event(
        db,
        agency_id=invitation.agency_id,
        actor_user_id=user.id,
        action="invitation.accepted",
        entity_type="invitation",
        entity_id=str(invitation.id),
    )
    agency = await db.get_one(Agency, invitation.agency_id)
    session_token = start_session(db, user, ctx)
    await db.commit()
    return user, agency, session_token
