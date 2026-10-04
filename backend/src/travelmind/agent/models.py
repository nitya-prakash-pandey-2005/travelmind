"""Agent run storage: runs, their steps (the visible trace) and monthly token usage.

All three are tenant data under forced RLS (migration 0012_agent_runs). Steps are append-only for
the application role: a run's trace is written once, step by step, in `seq` order. A step
references its run by (run_id, agency_id), so it belongs to a run of its own agency, and that key
restricts deletes: a run goes only with its agency (whose delete cascades to runs and steps);
the application role can't delete runs (migration 0013_agent_steps_integrity). A run keeps its
working state in `state` (migration 0014_agent_run_state), so a run that waits for the user can be
resumed by any worker process.
"""

from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base, utcnow

_TS = DateTime(timezone=True)

RUN_KINDS = ("agency", "traveller")
RUN_STATUSES = (
    "queued",
    "running",
    "waiting_for_user",
    "done",
    "failed",
    "cancelled",
    "budget_exceeded",
)
TERMINAL_STATUSES = frozenset({"done", "failed", "cancelled", "budget_exceeded"})
STEP_KINDS = (
    "thinking",
    "tool_call",
    "tool_result",
    "ask_user",
    "user",
    "answer",
    "guard",
    "error",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class AgentRun(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (
        CheckConstraint(_in("kind", RUN_KINDS), name="ck_agent_runs_kind"),
        CheckConstraint(_in("status", RUN_STATUSES), name="ck_agent_runs_status"),
        CheckConstraint("input_tokens >= 0 AND output_tokens >= 0", name="ck_agent_runs_tokens"),
        UniqueConstraint("id", "agency_id", name="uq_agent_runs_id_agency"),
        Index("ix_agent_runs_agency_created", "agency_id", text("created_at DESC")),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(12))
    status: Mapped[str] = mapped_column(String(20), default="queued", server_default="queued")
    prompt: Mapped[str] = mapped_column(Text)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))
    prompt_version: Mapped[str | None] = mapped_column(String(20))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    grounded: Mapped[bool | None] = mapped_column(Boolean)
    # The engine's working state (conversation, run memory, pending question): internal, never
    # in an API response (it holds supplier ids). See agent.state.RunState.
    state: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(_TS, default=utcnow, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(_TS)
    finished_at: Mapped[datetime | None] = mapped_column(_TS)


class AgentStep(Base):
    __tablename__ = "agent_steps"
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_agent_steps_seq"),
        CheckConstraint(_in("kind", STEP_KINDS), name="ck_agent_steps_kind"),
        CheckConstraint("seq >= 0", name="ck_agent_steps_seq"),
        CheckConstraint("duration_ms IS NULL OR duration_ms >= 0", name="ck_agent_steps_duration"),
        ForeignKeyConstraint(
            ["run_id", "agency_id"],
            ["agent_runs.id", "agent_runs.agency_id"],
            name="fk_agent_steps_run_agency",
            ondelete="RESTRICT",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[UUID] = mapped_column()
    agency_id: Mapped[UUID] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(_TS, default=utcnow, server_default=func.now())


class AgentUsageMonthly(Base):
    """Tokens an agency's runs used in one calendar month (UTC); `month` is its first day."""

    __tablename__ = "agent_usage_monthly"
    __table_args__ = (
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_agent_usage_month"),
        CheckConstraint("input_tokens >= 0 AND output_tokens >= 0", name="ck_agent_usage_tokens"),
    )

    agency_id: Mapped[UUID] = mapped_column(
        ForeignKey("agencies.id", ondelete="CASCADE"), primary_key=True
    )
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
