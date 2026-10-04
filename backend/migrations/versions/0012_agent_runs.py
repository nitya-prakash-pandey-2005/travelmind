"""agent runs, their steps and monthly token usage

Revision ID: 0012_agent_runs
Revises: 0011_activity_searches_index
Create Date: 2026-10-04

Storage for the agent engine (travelmind.agent). A run is one planning request; its steps are the
trace the browser streams (written before they are published, replayed by `seq`); monthly usage
backs the per-agency token budget. All three are tenant data under forced RLS. Steps are
append-only for the application role.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from travelmind.db import tenant_rls_statements

revision: str = "0012_agent_runs"
down_revision: str | None = "0011_activity_searches_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)
TABLES = ("agent_runs", "agent_steps", "agent_usage_monthly")


def _agency_fk() -> sa.Column:
    return sa.Column(
        "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("status", sa.String(20), server_default="queued", nullable=False),
        sa.Column("prompt", sa.Text, nullable=False),
        sa.Column("result", postgresql.JSONB, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        sa.Column("prompt_version", sa.String(20), nullable=True),
        sa.Column("input_tokens", sa.Integer, server_default="0", nullable=False),
        sa.Column("output_tokens", sa.Integer, server_default="0", nullable=False),
        sa.Column("grounded", sa.Boolean, nullable=True),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", TS, nullable=True),
        sa.Column("finished_at", TS, nullable=True),
        sa.CheckConstraint("kind IN ('agency', 'traveller')", name="ck_agent_runs_kind"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'waiting_for_user', 'done', 'failed', "
            "'cancelled', 'budget_exceeded')",
            name="ck_agent_runs_status",
        ),
    )
    op.create_index(
        "ix_agent_runs_agency_created", "agent_runs", ["agency_id", sa.text("created_at DESC")]
    )
    op.create_table(
        "agent_steps",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column(
            "run_id", UUID, sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False
        ),
        _agency_fk(),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("payload", postgresql.JSONB, server_default="{}", nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("run_id", "seq", name="uq_agent_steps_seq"),
        sa.CheckConstraint(
            "kind IN ('thinking', 'tool_call', 'tool_result', 'ask_user', 'answer', 'guard', "
            "'error')",
            name="ck_agent_steps_kind",
        ),
    )
    op.create_table(
        "agent_usage_monthly",
        _agency_fk(),
        sa.Column("month", sa.Date, nullable=False),
        sa.Column("input_tokens", sa.BigInteger, server_default="0", nullable=False),
        sa.Column("output_tokens", sa.BigInteger, server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("agency_id", "month"),
        sa.CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_agent_usage_month"),
    )
    for table in TABLES:
        for statement in tenant_rls_statements(table):
            op.execute(statement)
    op.execute("REVOKE UPDATE, DELETE ON agent_steps FROM travelmind_app")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
