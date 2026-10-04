"""Monthly token budget per agency, and the per-agency limit on concurrent runs."""

from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select

from tests.helpers import run_as_owner
from travelmind.agent import budget
from travelmind.agent.budget import BudgetExceeded, TooManyRuns
from travelmind.agent.models import AgentUsageMonthly
from travelmind.cache import get_shared_redis
from travelmind.db import bind_tenant, get_sessionmaker

OCT = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
NOV = datetime(2026, 11, 1, 0, 0, tzinfo=UTC)


async def _agency(name: str = "Alpha") -> UUID:
    agency_id = uuid4()
    await run_as_owner(
        "INSERT INTO agencies (id, name) VALUES (:id, :name)", {"id": agency_id, "name": name}
    )
    return agency_id


def test_month_start_is_the_utc_month():
    assert budget.month_start(OCT) == date(2026, 10, 1)
    # 1 Nov 03:00 in Kolkata is still October in UTC
    from zoneinfo import ZoneInfo

    early = datetime(2026, 11, 1, 3, 0, tzinfo=ZoneInfo("Asia/Kolkata"))
    assert budget.month_start(early) == date(2026, 10, 1)


async def test_record_upserts_the_months_usage():
    agency_id = await _agency()
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        await budget.record(db, agency_id, OCT, input_tokens=100, output_tokens=20)
        await budget.record(db, agency_id, OCT, input_tokens=50, output_tokens=5)
        await budget.record(db, agency_id, NOV, input_tokens=1, output_tokens=1)
        await db.commit()
        rows = (
            await db.execute(
                select(
                    AgentUsageMonthly.month,
                    AgentUsageMonthly.input_tokens,
                    AgentUsageMonthly.output_tokens,
                ).order_by(AgentUsageMonthly.month)
            )
        ).all()
        assert [tuple(r) for r in rows] == [(date(2026, 10, 1), 150, 25), (date(2026, 11, 1), 1, 1)]
        assert await budget.month_usage(db, agency_id, OCT) == 175


async def test_reserve_blocks_at_the_budget():
    agency_id = await _agency()
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        await budget.reserve(db, agency_id, OCT, budget=1000)  # nothing used yet
        await budget.record(db, agency_id, OCT, input_tokens=900, output_tokens=99)
        await budget.reserve(db, agency_id, OCT, budget=1000)  # 999: still under
        await budget.record(db, agency_id, OCT, input_tokens=0, output_tokens=1)
        with pytest.raises(BudgetExceeded) as caught:
            await budget.reserve(db, agency_id, OCT, budget=1000)  # 1000: at the limit
        assert (caught.value.used, caught.value.budget) == (1000, 1000)
        await budget.reserve(db, agency_id, NOV, budget=1000)  # a new month starts fresh


async def test_reserve_uses_the_settings_budget(monkeypatch):
    from travelmind.config import get_settings

    agency_id = await _agency()
    monkeypatch.setattr(get_settings(), "agent_monthly_token_budget", 10)
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        await budget.record(db, agency_id, OCT, input_tokens=10, output_tokens=0)
        with pytest.raises(BudgetExceeded):
            await budget.reserve(db, agency_id, OCT)


async def test_usage_is_per_agency():
    alpha, beta = await _agency("Alpha"), await _agency("Beta")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha)
        await budget.record(db, alpha, OCT, input_tokens=1000, output_tokens=0)
        await db.commit()
    async with get_sessionmaker()() as db:
        await bind_tenant(db, beta)
        assert await budget.month_usage(db, beta, OCT) == 0
        await budget.reserve(db, beta, OCT, budget=1000)


async def test_concurrent_runs_are_limited_per_agency():
    redis = get_shared_redis()
    alpha, beta = uuid4(), uuid4()
    await budget.acquire_run_slot(redis, alpha, "run-1", limit=2)
    await budget.acquire_run_slot(redis, alpha, "run-2", limit=2)
    with pytest.raises(TooManyRuns):
        await budget.acquire_run_slot(redis, alpha, "run-3", limit=2)
    await budget.acquire_run_slot(redis, beta, "run-4", limit=2)  # another agency: its own slots
    await budget.release_run_slot(redis, alpha, "run-1")
    await budget.acquire_run_slot(redis, alpha, "run-3", limit=2)
    assert budget.run_slot_key(alpha) == f"tm:sem:agent:{alpha}"
    assert await redis.zcard(budget.run_slot_key(alpha)) == 2


async def test_run_slots_default_to_settings(monkeypatch):
    from travelmind.config import get_settings

    monkeypatch.setattr(get_settings(), "agent_max_concurrent_runs_per_agency", 1)
    redis = get_shared_redis()
    agency = uuid4()
    await budget.acquire_run_slot(redis, agency, "a")
    with pytest.raises(TooManyRuns):
        await budget.acquire_run_slot(redis, agency, "b")


async def test_a_slot_lapses_after_its_ttl():
    import asyncio

    redis = get_shared_redis()
    agency = uuid4()
    await budget.acquire_run_slot(redis, agency, "crashed", limit=1, ttl_s=0.2)
    with pytest.raises(TooManyRuns):
        await budget.acquire_run_slot(redis, agency, "next", limit=1, ttl_s=0.2)
    await asyncio.sleep(0.3)
    await budget.acquire_run_slot(redis, agency, "next", limit=1, ttl_s=0.2)


async def test_run_slots_fail_open_when_redis_is_down():
    class DownRedis:
        def register_script(self, script):  # type: ignore[no-untyped-def]
            async def run(*args, **kwargs):  # type: ignore[no-untyped-def]
                raise RedisConnectionError("down")

            return run

        async def zrem(self, *args):  # type: ignore[no-untyped-def]
            raise RedisConnectionError("down")

    await budget.acquire_run_slot(DownRedis(), uuid4(), "run", limit=1)  # type: ignore[arg-type]
    await budget.release_run_slot(DownRedis(), uuid4(), "run")  # type: ignore[arg-type]


async def test_each_model_call_checks_the_budget_with_the_runs_unrecorded_tokens():
    """Before every model call: the month's usage plus what this run has spent but not yet
    recorded must stay under the budget, so a run overshoots by at most one call."""
    agency_id = await _agency()
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        await budget.record(db, agency_id, OCT, input_tokens=900, output_tokens=0)
        await budget.assert_within_budget(db, agency_id, OCT, budget=1000)
        await budget.assert_within_budget(db, agency_id, OCT, extra_tokens=99, budget=1000)
        with pytest.raises(BudgetExceeded) as caught:
            await budget.assert_within_budget(db, agency_id, OCT, extra_tokens=100, budget=1000)
        assert (caught.value.used, caught.value.budget) == (1000, 1000)
        await budget.assert_within_budget(db, agency_id, NOV, extra_tokens=100, budget=1000)


async def test_assert_within_budget_uses_the_settings_budget(monkeypatch):
    from travelmind.config import get_settings

    agency_id = await _agency()
    monkeypatch.setattr(get_settings(), "agent_monthly_token_budget", 10)
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        await budget.assert_within_budget(db, agency_id, OCT, extra_tokens=9)
        with pytest.raises(BudgetExceeded):
            await budget.assert_within_budget(db, agency_id, OCT, extra_tokens=10)


def test_the_run_slot_ttl_is_a_setting_that_outlasts_queue_and_run():
    from travelmind.config import Settings

    settings = Settings(_env_file=None)
    assert settings.agent_run_slot_ttl_s > settings.agent_run_timeout_s


async def test_the_slot_ttl_setting_is_counted_from_acquisition(monkeypatch):
    import asyncio

    from travelmind.config import get_settings

    monkeypatch.setattr(get_settings(), "agent_run_slot_ttl_s", 0.3)
    redis = get_shared_redis()
    agency = uuid4()
    await budget.acquire_run_slot(redis, agency, "queued-run", limit=1)
    with pytest.raises(TooManyRuns):
        await budget.acquire_run_slot(redis, agency, "next", limit=1)
    await asyncio.sleep(0.4)  # from acquisition, whether the run ever started or not
    await budget.acquire_run_slot(redis, agency, "next", limit=1)
