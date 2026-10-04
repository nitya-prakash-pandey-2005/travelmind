"""find the agencies with stuck agent runs, in one call

Revision ID: 0015_agent_stuck_runs
Revises: 0014_agent_run_state
Create Date: 2026-10-04

A job killed hard (the worker process lost, an OOM kill) leaves its run `running` or `queued`
for good. The worker's minute sweep (`agent.service.sweep_stuck_runs`) fails such runs; this
function finds the agencies that have any, so the sweep visits only those.

`agencies_with_stuck_agent_runs(running_before, queued_before)` follows 0009's pattern: not a
definer function, no policy change; it runs as the caller (the app role), binds each agency in
turn exactly as `bind_tenant` does, checks that agency's runs under the usual tenant RLS, then
puts the caller's own binding back. It returns agency ids only. A run is stuck when it is:
- `running` and its last activity (the latest of started_at, the state's `running_at`, set when a
  job claims it, and its newest step) is before `running_before`;
- `queued` since (the state's `queued_at`, else created_at) before `queued_before`.

`ix_agent_runs_active` (partial: queued and running runs only) keeps each check to the few
active runs of an agency.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015_agent_stuck_runs"
down_revision: str | None = "0014_agent_run_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UPGRADE = [
    """
    CREATE INDEX ix_agent_runs_active ON agent_runs (agency_id, status)
      WHERE status IN ('queued', 'running')
    """,
    """
    CREATE FUNCTION agencies_with_stuck_agent_runs(
      p_running_before timestamptz, p_queued_before timestamptz
    ) RETURNS SETOF uuid
      LANGUAGE plpgsql
      SET search_path = pg_catalog, public, pg_temp
    AS $$
      DECLARE
        v_caller text := current_setting('app.agency_id', true);
        v_agency uuid;
      BEGIN
        FOR v_agency IN SELECT a.id FROM public.agencies a LOOP
          PERFORM set_config('app.agency_id', v_agency::text, true);
          IF EXISTS (
            SELECT 1 FROM public.agent_runs r
            WHERE r.agency_id = v_agency
              AND (
                (r.status = 'running' AND greatest(
                  r.started_at,
                  (r.state ->> 'running_at')::timestamptz,
                  (SELECT max(s.created_at) FROM public.agent_steps s
                    WHERE s.run_id = r.id AND s.agency_id = r.agency_id)
                ) < p_running_before)
                OR (r.status = 'queued' AND coalesce(
                  (r.state ->> 'queued_at')::timestamptz, r.created_at
                ) < p_queued_before)
              )
          ) THEN
            RETURN NEXT v_agency;
          END IF;
        END LOOP;
        PERFORM set_config('app.agency_id', coalesce(v_caller, ''), true);
      END
    $$
    """,
    "REVOKE ALL ON FUNCTION agencies_with_stuck_agent_runs(timestamptz, timestamptz) FROM PUBLIC",
    "GRANT EXECUTE ON FUNCTION agencies_with_stuck_agent_runs(timestamptz, timestamptz) "
    "TO travelmind_app",
]


def upgrade() -> None:
    for statement in _UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS agencies_with_stuck_agent_runs(timestamptz, timestamptz)")
    op.execute("DROP INDEX IF EXISTS ix_agent_runs_active")
