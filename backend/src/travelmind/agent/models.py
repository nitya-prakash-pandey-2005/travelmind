"""Agent run storage: runs, their steps (the visible trace) and monthly token usage.

All three are tenant data under forced RLS (migration 0012_agent_runs). Steps are append-only for
the application role: a run's trace is written once, step by step, in `seq` order.
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
STEP_KINDS = ("thinking", "tool_call", "tool_result", "ask_user", "answer", "guard", "error")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class AgentRun(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (
        CheckConstraint(_in("kind", RUN_KINDS), name="ck_agent_runs_kind"),
        CheckConstraint(_in("status", RUN_STATUSES), name="ck_agent_runs_status"),
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
    created_at: Mapped[datetime] = mapped_column(_TS, default=utcnow, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(_TS)
    finished_at: Mapped[datetime | None] = mapped_column(_TS)


class AgentStep(Base):
    __tablename__ = "agent_steps"
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_agent_steps_seq"),
        CheckConstraint(_in("kind", STEP_KINDS), name="ck_agent_steps_kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"))
    agency_id: Mapped[UUID] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(_TS, default=utcnow, server_default=func.now())


class AgentUsageMonthly(Base):
    """Tokens an agency's runs used in one calendar month (UTC); `month` is its first day."""

    __tablename__ = "agent_usage_monthly"
    __table_args__ = (CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_agent_usage_month"),)

    agency_id: Mapped[UUID] = mapped_column(
        ForeignKey("agencies.id", ondelete="CASCADE"), primary_key=True
    )
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
