"""Limits on what an agency's agent runs may use.

- Monthly token budget: `reserve` refuses a new run once the agency's usage this month (UTC
  calendar month) is at or above `agent_monthly_token_budget`; `assert_within_budget` is the same
  check before every model call, counting the tokens the run has spent but not yet recorded, so a
  run overshoots the budget by at most one call; `record` adds a run's tokens to the month as
  they are spent. All run in the caller's transaction, on a session bound to the agency (the
  usage table is under RLS); the caller commits.
- Concurrent runs: at most `agent_max_concurrent_runs_per_agency` runs hold a slot at once, across
  every process (the Redis semaphore of `travelmind.semaphore`, key `tm:sem:agent:<agency>`). A
  slot is taken when the run is created and handed back by run id when it ends, possibly in
  another process. It is held for at most `agent_run_slot_ttl_s`, counted from when it was taken
  (Redis server time), after which a crashed holder's slot lapses. Like the other Redis limits it
  fails open: an unreachable Redis does not stop runs.

Open questions for Task 3 (the engine, API and worker), to settle there:
- Queue wait vs TTL. The TTL runs from acquisition, not from when the worker starts the run, so
  it must cover the queue wait plus `agent_run_timeout_s`. If a queued run can wait longer than
  `agent_run_slot_ttl_s - agent_run_timeout_s`, its slot lapses while it is still pending and a
  further run can start: either fail a run that starts too late (started_at - created_at over
  the slack), re-take the slot when the worker starts, or size the TTL to the queue's worst case.
- waiting_for_user. A run that asks the user a question ends its turn. Holding the slot until
  the reply would let three unanswered questions block the agency, and the TTL would expire the
  slot anyway. Proposed: release the slot when the run enters waiting_for_user and take a new
  one (same holder, the run id) when the reply resumes it, refusing the reply with TooManyRuns
  when none is free; check the monthly budget again (reserve) at that point too.
- Budget checks per call. Call `assert_within_budget(db, agency, now, extra_tokens=<the run's
  tokens not yet recorded>)` before every model call, and `record` after each call (including a
  failed one: ProviderError carries the tokens it cost), so concurrent runs see each other's
  spend and the overshoot stays bounded by one call per running run.
"""

from datetime import UTC, date, datetime
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.agent.models import AgentUsageMonthly
from travelmind.config import get_settings
from travelmind.semaphore import release_slot, take_slot


class BudgetExceeded(Exception):
    """The agency has used its token budget for this month."""

    def __init__(self, used: int, budget: int) -> None:
        super().__init__("This month's agent budget is used up.")
        self.used = used
        self.budget = budget


class TooManyRuns(Exception):
    """The agency already has as many runs in progress as it may."""

    def __init__(self) -> None:
        super().__init__("Too many plans are running at once. Try again when one finishes.")


def month_start(now: datetime) -> date:
    """The first day of `now`'s calendar month in UTC."""
    utc = now.astimezone(UTC)
    return date(utc.year, utc.month, 1)


async def month_usage(db: AsyncSession, agency_id: UUID, now: datetime) -> int:
    """Tokens (input + output) the agency has used in `now`'s month."""
    used = await db.scalar(
        select(AgentUsageMonthly.input_tokens + AgentUsageMonthly.output_tokens).where(
            AgentUsageMonthly.agency_id == agency_id,
            AgentUsageMonthly.month == month_start(now),
        )
    )
    return int(used or 0)


async def assert_within_budget(
    db: AsyncSession,
    agency_id: UUID,
    now: datetime,
    extra_tokens: int = 0,
    *,
    budget: int | None = None,
) -> None:
    """Raise BudgetExceeded when the month's usage plus `extra_tokens` (what the caller has spent
    but not yet recorded) is at or above the budget (the setting by default). Called before
    every model call, so a run overshoots the budget by at most one call."""
    limit = get_settings().agent_monthly_token_budget if budget is None else budget
    used = await month_usage(db, agency_id, now) + extra_tokens
    if used >= limit:
        raise BudgetExceeded(used, limit)


async def reserve(
    db: AsyncSession, agency_id: UUID, now: datetime, *, budget: int | None = None
) -> None:
    """Raise BudgetExceeded when the month's usage is at or above the budget (the setting by
    default): the check before a run is created."""
    await assert_within_budget(db, agency_id, now, budget=budget)


async def record(
    db: AsyncSession, agency_id: UUID, now: datetime, input_tokens: int, output_tokens: int
) -> None:
    """Add tokens to the agency's usage for `now`'s month (creating the month's row)."""
    statement = insert(AgentUsageMonthly).values(
        agency_id=agency_id,
        month=month_start(now),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[AgentUsageMonthly.agency_id, AgentUsageMonthly.month],
            set_={
                "input_tokens": AgentUsageMonthly.input_tokens + statement.excluded.input_tokens,
                "output_tokens": AgentUsageMonthly.output_tokens + statement.excluded.output_tokens,
            },
        )
    )


def run_slot_key(agency_id: UUID) -> str:
    return f"tm:sem:agent:{agency_id}"


async def acquire_run_slot(
    redis: Redis,
    agency_id: UUID,
    holder: str,
    *,
    limit: int | None = None,
    ttl_s: float | None = None,
) -> None:
    """Take one of the agency's run slots for `holder` (the run id), or raise TooManyRuns. The
    slot is held for at most `ttl_s` (agent_run_slot_ttl_s by default) from now."""
    settings = get_settings()
    taken = await take_slot(
        redis,
        run_slot_key(agency_id),
        holder,
        limit=settings.agent_max_concurrent_runs_per_agency if limit is None else limit,
        ttl_s=settings.agent_run_slot_ttl_s if ttl_s is None else ttl_s,
    )
    if taken is False:
        raise TooManyRuns


async def release_run_slot(redis: Redis, agency_id: UUID, holder: str) -> None:
    await release_slot(redis, run_slot_key(agency_id), holder)
