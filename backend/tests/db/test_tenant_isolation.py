import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from travelmind.audit.models import AuditEvent
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.identity.models import Agency, Invitation, User


async def _seed_agency(name: str) -> tuple[Agency, User]:
    slug = name.lower()
    async with get_sessionmaker()() as db:
        agency = Agency(id=uuid4(), name=name)
        db.add(agency)
        await db.flush()
        owner = User(
            id=uuid4(),
            agency_id=agency.id,
            email=f"owner@{slug}.com",
            full_name=f"{name} Owner",
            password_hash="not-a-real-hash",
            role="owner",
        )
        db.add(owner)
        await db.flush()
        await bind_tenant(db, agency.id)
        db.add(
            Invitation(
                agency_id=agency.id,
                email=f"agent@{slug}.com",
                role="agent",
                token_hash=uuid4().hex,
                invited_by_user_id=owner.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()
        return agency, owner


async def test_tenant_sees_only_own_rows():
    alpha, _ = await _seed_agency("Alpha")
    await _seed_agency("Beta")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        emails = (await db.scalars(select(Invitation.email))).all()
    assert emails == ["agent@alpha.com"]


async def test_no_tenant_context_sees_nothing():
    await _seed_agency("Alpha")
    async with get_sessionmaker()() as db:
        assert (await db.scalars(select(Invitation))).all() == []


async def test_cannot_write_rows_for_another_tenant():
    alpha, _ = await _seed_agency("Alpha")
    beta, beta_owner = await _seed_agency("Beta")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        db.add(
            Invitation(
                agency_id=beta.id,
                email="sneaky@beta.com",
                role="agent",
                token_hash=uuid4().hex,
                invited_by_user_id=beta_owner.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        with pytest.raises(DBAPIError, match="row-level security"):
            await db.flush()


async def test_invitation_email_must_be_lowercase():
    alpha, owner = await _seed_agency("Alpha")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        db.add(
            Invitation(
                agency_id=alpha.id,
                email="Mixed.Case@Alpha.com",
                role="agent",
                token_hash=uuid4().hex,
                invited_by_user_id=owner.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        with pytest.raises(DBAPIError, match="ck_invitations_email_lower"):
            await db.flush()


async def test_tenant_context_survives_commit_in_same_session():
    alpha, _ = await _seed_agency("Alpha")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        first = (await db.scalars(select(Invitation.email))).all()
        await db.commit()
        second = (await db.scalars(select(Invitation.email))).all()
    assert first == second == ["agent@alpha.com"]


async def test_tenant_setting_is_transaction_local():
    alpha, _ = await _seed_agency("Alpha")
    engine = create_async_engine(os.environ["TM_DATABASE_URL"], poolclass=NullPool)
    async with engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text("SELECT set_config('app.agency_id', :aid, true)"), {"aid": str(alpha.id)}
            )
        async with conn.begin():
            leftover = await conn.scalar(text("SELECT current_setting('app.agency_id', true)"))
            visible = (await conn.execute(text("SELECT count(*) FROM invitations"))).scalar()
    await engine.dispose()
    assert leftover in ("", None)
    assert visible == 0


async def test_audit_log_is_append_only():
    alpha, owner = await _seed_agency("Alpha")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        db.add(
            AuditEvent(
                agency_id=alpha.id,
                actor_user_id=owner.id,
                action="test.event",
                entity_type="test",
                entity_id="1",
            )
        )
        await db.commit()
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(update(AuditEvent).values(action="tampered"))
