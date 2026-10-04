"""Agent run storage: tenant isolation (forced RLS) on runs, steps and monthly usage."""

import os
from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from tests.helpers import run_as_owner
from travelmind.agent.models import AgentRun, AgentStep, AgentUsageMonthly
from travelmind.db import bind_tenant, get_sessionmaker

TABLES = ["agent_runs", "agent_steps", "agent_usage_monthly"]


async def _agency(name: str) -> tuple[UUID, UUID]:
    agency_id, user_id = uuid4(), uuid4()
    await run_as_owner(
        "INSERT INTO agencies (id, name) VALUES (:id, :name)", {"id": agency_id, "name": name}
    )
    await run_as_owner(
        "INSERT INTO users (id, agency_id, email, full_name, password_hash, role) "
        "VALUES (:id, :aid, :email, 'Owner', 'x', 'owner')",
        {"id": user_id, "aid": agency_id, "email": f"owner@{name.lower()}.com"},
    )
    return agency_id, user_id


async def _seed(agency_id: UUID, user_id: UUID, prompt: str) -> UUID:
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        run = AgentRun(
            agency_id=agency_id,
            user_id=user_id,
            kind="agency",
            status="queued",
            prompt=prompt,
            provider="fake",
            model="demo-planner",
        )
        db.add(run)
        await db.flush()
        db.add(AgentStep(run_id=run.id, agency_id=agency_id, seq=1, kind="thinking", payload={}))
        db.add(
            AgentUsageMonthly(
                agency_id=agency_id, month=date(2026, 10, 1), input_tokens=10, output_tokens=5
            )
        )
        await db.commit()
        return run.id


async def test_agent_tables_force_rls():
    async with get_sessionmaker()() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname = ANY(:names)"
                ),
                {"names": TABLES},
            )
        ).all()
    assert {r.relname for r in rows} == set(TABLES)
    assert all(r.relrowsecurity and r.relforcerowsecurity for r in rows)


async def test_each_agency_sees_only_its_own_runs_steps_and_usage():
    alpha, alpha_user = await _agency("Alpha")
    beta, beta_user = await _agency("Beta")
    alpha_run = await _seed(alpha, alpha_user, "alpha prompt")
    await _seed(beta, beta_user, "beta prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        assert (await db.scalars(select(AgentRun.prompt))).all() == ["alpha prompt"]
        assert (await db.scalars(select(AgentStep.run_id))).all() == [alpha_run]
        assert (await db.scalars(select(AgentUsageMonthly.agency_id))).all() == [alpha]


async def test_no_tenant_context_sees_no_agent_rows():
    alpha, alpha_user = await _agency("Alpha")
    await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        for model in (AgentRun, AgentStep, AgentUsageMonthly):
            assert await db.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize("table", TABLES)
async def test_cannot_write_agent_rows_for_another_agency(table):
    alpha, _ = await _agency("Alpha")
    beta, beta_user = await _agency("Beta")
    beta_run = await _seed(beta, beta_user, "beta prompt")
    rows = {
        "agent_runs": AgentRun(
            agency_id=beta,
            user_id=beta_user,
            kind="agency",
            status="queued",
            prompt="sneaky",
            provider="fake",
            model="demo-planner",
        ),
        "agent_steps": AgentStep(run_id=beta_run, agency_id=beta, seq=2, kind="answer", payload={}),
        "agent_usage_monthly": AgentUsageMonthly(
            agency_id=beta, month=date(2026, 11, 1), input_tokens=1, output_tokens=1
        ),
    }
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        db.add(rows[table])
        with pytest.raises(DBAPIError, match="row-level security"):
            await db.flush()


async def test_steps_are_unique_per_run_and_append_only():
    alpha, alpha_user = await _agency("Alpha")
    run_id = await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        db.add(AgentStep(run_id=run_id, agency_id=alpha, seq=1, kind="answer", payload={}))
        with pytest.raises(IntegrityError):
            await db.flush()
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(text("UPDATE agent_steps SET kind = 'error'"))


async def test_run_defaults_and_status_check():
    alpha, alpha_user = await _agency("Alpha")
    run_id = await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        run = await db.get(AgentRun, run_id)
        assert run is not None
        assert (run.input_tokens, run.output_tokens) == (0, 0)
        assert run.result is None and run.grounded is None and run.finished_at is None
        assert run.created_at is not None
        with pytest.raises(DBAPIError, match="ck_agent_runs_status"):
            await db.execute(
                text("UPDATE agent_runs SET status = 'exploded' WHERE id = :id"), {"id": run_id}
            )


async def test_runs_are_listed_by_agency_and_time():
    async with get_sessionmaker()() as db:
        definition = (
            await db.execute(
                text(
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE indexname = 'ix_agent_runs_agency_created'"
                )
            )
        ).scalar_one()
    assert definition.endswith("USING btree (agency_id, created_at DESC)")


# --- integrity (migration 0013_agent_steps_integrity) ----------------------------------------


async def test_a_step_belongs_to_a_run_of_its_own_agency():
    """Steps reference (run_id, agency_id): a step can't point at another agency's run, even
    when it claims its own agency (which RLS alone would allow)."""
    alpha, alpha_user = await _agency("Alpha")
    beta, _ = await _agency("Beta")
    alpha_run = await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, beta)
        db.add(AgentStep(run_id=alpha_run, agency_id=beta, seq=7, kind="answer", payload={}))
        with pytest.raises(IntegrityError, match="fk_agent_steps_run_agency"):
            await db.flush()


@pytest.mark.parametrize(
    ("statement", "constraint"),
    [
        ("UPDATE agent_runs SET input_tokens = -1", "ck_agent_runs_tokens"),
        ("UPDATE agent_runs SET output_tokens = -1", "ck_agent_runs_tokens"),
        ("UPDATE agent_usage_monthly SET input_tokens = -1", "ck_agent_usage_tokens"),
        ("UPDATE agent_usage_monthly SET output_tokens = -1", "ck_agent_usage_tokens"),
    ],
)
async def test_token_counts_are_never_negative(statement, constraint):
    alpha, alpha_user = await _agency("Alpha")
    await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        with pytest.raises(IntegrityError, match=constraint):
            await db.execute(text(statement))


@pytest.mark.parametrize(
    ("values", "constraint"),
    [
        ({"seq": -1}, "ck_agent_steps_seq"),
        ({"seq": 2, "duration_ms": -5}, "ck_agent_steps_duration"),
    ],
)
async def test_step_numbers_and_durations_are_never_negative(values, constraint):
    alpha, alpha_user = await _agency("Alpha")
    run_id = await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        db.add(AgentStep(run_id=run_id, agency_id=alpha, kind="answer", payload={}, **values))
        with pytest.raises(IntegrityError, match=constraint):
            await db.flush()


async def test_zero_and_missing_durations_are_allowed():
    alpha, alpha_user = await _agency("Alpha")
    run_id = await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        db.add(AgentStep(run_id=run_id, agency_id=alpha, seq=0, kind="answer", duration_ms=0))
        db.add(AgentStep(run_id=run_id, agency_id=alpha, seq=2, kind="answer", duration_ms=None))
        await db.commit()


async def test_the_app_cannot_delete_runs():
    alpha, alpha_user = await _agency("Alpha")
    await _seed(alpha, alpha_user, "alpha prompt")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(text("DELETE FROM agent_runs"))


async def test_a_run_with_steps_is_not_deleted_from_under_them():
    """Deleting a run never takes its trace with it: steps restrict the delete, even for the
    owner role (steps are append-only)."""
    alpha, alpha_user = await _agency("Alpha")
    run_id = await _seed(alpha, alpha_user, "alpha prompt")
    owner = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    try:
        async with owner.begin() as conn:
            await conn.execute(  # forced RLS applies to the owner too
                text("SELECT set_config('app.agency_id', :aid, true)"), {"aid": str(alpha)}
            )
            with pytest.raises(IntegrityError, match="fk_agent_steps_run_agency"):
                await conn.execute(text("DELETE FROM agent_runs WHERE id = :id"), {"id": run_id})
    finally:
        await owner.dispose()


async def test_deleting_an_agency_removes_its_runs_and_steps():
    """Expired demo cleanup (the app role deleting the agency) still removes every run and step:
    the restricting foreign key is checked after the agency's cascades have run."""
    from datetime import UTC, datetime, timedelta

    from travelmind.identity.service import delete_expired_demo_agencies

    alpha, alpha_user = await _agency("Alpha")
    beta, beta_user = await _agency("Beta")
    await _seed(alpha, alpha_user, "alpha prompt")
    await _seed(beta, beta_user, "beta prompt")
    await run_as_owner(
        "UPDATE agencies SET is_demo = true, demo_expires_at = now() - interval '1 day' "
        "WHERE id = :id",
        {"id": alpha},
    )
    async with get_sessionmaker()() as db:
        deleted = await delete_expired_demo_agencies(
            db, now=datetime.now(UTC) + timedelta(seconds=1), limit=10
        )
        await db.commit()
    assert deleted == [alpha]
    for agency, expected in ((alpha, 0), (beta, 1)):
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency)
            for model in (AgentRun, AgentStep, AgentUsageMonthly):
                count = await db.scalar(select(func.count()).select_from(model))
                assert count == expected, (agency, model.__name__)
