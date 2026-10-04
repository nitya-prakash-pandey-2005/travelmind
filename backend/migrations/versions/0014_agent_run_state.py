"""agent runs keep their working state; the user's own turns are steps

Revision ID: 0014_agent_run_state
Revises: 0013_agent_steps_integrity
Create Date: 2026-10-04

- `agent_runs.state` (jsonb, null until the run is created by the engine): the conversation sent
  to the model, the run memory (short ids F1/H1/P1 and the supplier ids behind them), repeated
  call answers, the pending question or confirmation and the run's counters. A run that waits
  for the user stops; the next job, in any worker process, rebuilds the run from this column.
  It is internal: API responses never include it (it holds supplier ids).
- Step kind `user`: the user's reply to a question, or their decision on a confirmation, in the
  trace between the question and what the run did next.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_agent_run_state"
down_revision: str | None = "0013_agent_steps_integrity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_KINDS = "('thinking', 'tool_call', 'tool_result', 'ask_user', 'answer', 'guard', 'error')"
NEW_KINDS = (
    "('thinking', 'tool_call', 'tool_result', 'ask_user', 'user', 'answer', 'guard', 'error')"
)


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("state", postgresql.JSONB(), nullable=True))
    op.execute("ALTER TABLE agent_steps DROP CONSTRAINT ck_agent_steps_kind")
    op.execute(
        f"ALTER TABLE agent_steps ADD CONSTRAINT ck_agent_steps_kind CHECK (kind IN {NEW_KINDS})"
    )


def downgrade() -> None:
    op.execute("DELETE FROM agent_steps WHERE kind = 'user'")
    op.execute("ALTER TABLE agent_steps DROP CONSTRAINT ck_agent_steps_kind")
    op.execute(
        f"ALTER TABLE agent_steps ADD CONSTRAINT ck_agent_steps_kind CHECK (kind IN {OLD_KINDS})"
    )
    op.drop_column("agent_runs", "state")
