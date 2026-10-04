"""agent steps belong to a run of their own agency; counts are never negative

Revision ID: 0013_agent_steps_integrity
Revises: 0012_agent_runs
Create Date: 2026-10-04

- A step references its run by (run_id, agency_id), so it can't point at another agency's run
  (RLS checks the step's own agency_id, not its run's). That needs a unique key on
  agent_runs (id, agency_id).
- The step-to-run key restricts instead of cascading: deleting a run never takes its trace with
  it. Runs go only with their agency (expired demo cleanup, account removal), whose delete
  cascades to both runs and steps; the restricting check runs after those cascades, so it
  passes. The application role may not delete runs at all.
- Token counts, step numbers and durations are never negative.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0013_agent_steps_integrity"
down_revision: str | None = "0012_agent_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = [
    "ALTER TABLE agent_runs ADD CONSTRAINT uq_agent_runs_id_agency UNIQUE (id, agency_id)",
    "ALTER TABLE agent_steps DROP CONSTRAINT agent_steps_run_id_fkey",
    "ALTER TABLE agent_steps ADD CONSTRAINT fk_agent_steps_run_agency "
    "FOREIGN KEY (run_id, agency_id) REFERENCES agent_runs (id, agency_id) ON DELETE RESTRICT",
    "ALTER TABLE agent_runs ADD CONSTRAINT ck_agent_runs_tokens "
    "CHECK (input_tokens >= 0 AND output_tokens >= 0)",
    "ALTER TABLE agent_usage_monthly ADD CONSTRAINT ck_agent_usage_tokens "
    "CHECK (input_tokens >= 0 AND output_tokens >= 0)",
    "ALTER TABLE agent_steps ADD CONSTRAINT ck_agent_steps_seq CHECK (seq >= 0)",
    "ALTER TABLE agent_steps ADD CONSTRAINT ck_agent_steps_duration "
    "CHECK (duration_ms IS NULL OR duration_ms >= 0)",
    "REVOKE DELETE ON agent_runs FROM travelmind_app",
]

DOWNGRADE = [
    "GRANT DELETE ON agent_runs TO travelmind_app",
    "ALTER TABLE agent_steps DROP CONSTRAINT ck_agent_steps_duration",
    "ALTER TABLE agent_steps DROP CONSTRAINT ck_agent_steps_seq",
    "ALTER TABLE agent_usage_monthly DROP CONSTRAINT ck_agent_usage_tokens",
    "ALTER TABLE agent_runs DROP CONSTRAINT ck_agent_runs_tokens",
    "ALTER TABLE agent_steps DROP CONSTRAINT fk_agent_steps_run_agency",
    "ALTER TABLE agent_steps ADD CONSTRAINT agent_steps_run_id_fkey "
    "FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE CASCADE",
    "ALTER TABLE agent_runs DROP CONSTRAINT uq_agent_runs_id_agency",
]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE:
        op.execute(statement)
