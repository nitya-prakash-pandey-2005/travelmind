"""index an agency's search events by time

Revision ID: 0011_activity_searches_index
Revises: 0010_quotes_due_index
Create Date: 2026-10-04

The Command Center's "searches" KPI is computed on every summary read (it is no longer cached
with the other cards, so searches don't retire the dashboard cache). It counts an agency's
`search.flights` and `search.hotels` events per local day over two windows (up to 180 days).
`ix_activity_agency_time` (agency_id, occurred_at) finds the agency's events in the window, but
then every event has to be read to check its kind, and searches are only part of them. This
partial index holds only search events, so the count walks just those.

`IF NOT EXISTS` keeps the upgrade safe to re-run. It runs inside the migration's transaction and
locks writes to activity_events while it builds, which is fine at this data size; on a large
production database use `CREATE INDEX CONCURRENTLY` outside a transaction instead.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0011_activity_searches_index"
down_revision: str | None = "0010_quotes_due_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_activity_agency_searches "
        "ON activity_events (agency_id, occurred_at) "
        "WHERE kind IN ('search.flights', 'search.hotels')"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_activity_agency_searches")
