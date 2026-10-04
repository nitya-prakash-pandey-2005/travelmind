"""index live shared quotes by agency and share expiry

Revision ID: 0010_quotes_due_index
Revises: 0009_overdue_quote_agencies
Create Date: 2026-10-04

The overdue-quote lookup (`agencies_with_overdue_quotes`, every 5 minutes for every agency) and
lazy expiry (`expire_overdue_quotes`, on many reads) both look for an agency's sent or viewed
quotes whose share link expired before now. `ix_quotes_agency_status` (agency_id, status,
created_at) finds an agency's sent and viewed quotes, but then every one of them has to be read
to check its expiry. This partial index holds only live shared quotes, ordered by expiry, so the
lookup is one index probe per agency (the first entry before `now`, or none) and the UPDATE
reads only the overdue rows.

`IF NOT EXISTS` keeps the upgrade safe to re-run. It runs inside the migration's transaction and
locks writes to quotes while it builds, which is fine at this data size; on a large production
database use `CREATE INDEX CONCURRENTLY` outside a transaction instead.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010_quotes_due_index"
down_revision: str | None = "0009_overdue_quote_agencies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_quotes_agency_share_due "
        "ON quotes (agency_id, share_expires_at) WHERE status IN ('sent', 'viewed')"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_quotes_agency_share_due")
