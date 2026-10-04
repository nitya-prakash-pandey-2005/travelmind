"""find the agencies whose shared quotes are overdue, in one call

Revision ID: 0009_overdue_quote_agencies
Revises: 0008_hot_path_indexes
Create Date: 2026-10-04

The worker's expiry sweep used to bind and UPDATE every agency every 5 minutes, most of them
with nothing to expire. `agencies_with_overdue_quotes(now)` returns just the ids of agencies that
have a sent or viewed quote whose share link expired before `now` (the same predicate as
`expire_overdue_quotes`), in one round trip.

It is not a definer function and changes no policy: it runs as the caller (the app role), binds
each agency in turn exactly as `bind_tenant` does, and probes that agency's quotes under the
usual tenant RLS (one `ix_quotes_agency_status` index probe per agency), then puts the caller's
own binding back (an error aborts the transaction, which drops the local setting anyway). It
returns agency ids only.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009_overdue_quote_agencies"
down_revision: str | None = "0008_hot_path_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UPGRADE = [
    """
    CREATE FUNCTION agencies_with_overdue_quotes(p_now timestamptz) RETURNS SETOF uuid
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
            SELECT 1 FROM public.quotes q
            WHERE q.agency_id = v_agency
              AND q.status IN ('sent', 'viewed')
              AND q.share_expires_at < p_now
          ) THEN
            RETURN NEXT v_agency;
          END IF;
        END LOOP;
        PERFORM set_config('app.agency_id', coalesce(v_caller, ''), true);
      END
    $$
    """,
    "REVOKE ALL ON FUNCTION agencies_with_overdue_quotes(timestamptz) FROM PUBLIC",
    "GRANT EXECUTE ON FUNCTION agencies_with_overdue_quotes(timestamptz) TO travelmind_app",
]


def upgrade() -> None:
    for statement in _UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS agencies_with_overdue_quotes(timestamptz)")
