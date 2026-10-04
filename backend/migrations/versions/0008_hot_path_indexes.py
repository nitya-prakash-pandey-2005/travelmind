"""index the list pages' sort orders and a tenant's searches by route

Revision ID: 0008_hot_path_indexes
Revises: 0007_workspace_fk_indexes
Create Date: 2026-10-03

Chosen by EXPLAIN ANALYZE of every statement behind the hot reads, for an agency with 5,000
enquiries and quotes, 2,500 clients, 25,000 activity events and 8,000 searches, in tables that
also hold a 100,000-row agency:
- enquiries by agency, newest first: the enquiries list read and sorted all 5,000 of the
  agency's enquiries for a 50-row page (4.1 ms); now it walks 50 index entries (0.5 ms).
- quotes by agency, newest first: the quotes list joined all 5,000 quotes to their client and
  version before sorting (13.9 ms); now 50 rows (0.5 ms).
- clients by agency, most recently updated first (`updated_at DESC, id`, the list's exact order):
  the clients list ran its per-client stats lookups for all 2,500 clients before the sort
  (11.4 ms); now for the 50 on the page (0.9 ms).
- flight searches by agency and route, newest first: route intel's "your searches" read 1,680
  of the agency's searches to keep 21 (0.23 ms); now exactly 21 (0.06 ms). This grows with the
  agency's search history.

Already served, so not added: activity by agency and time (ix_activity_agency_time, scanned
backward) and by entity (0007), fare snapshots by route (ix_fare_snapshots_route), sessions by
token hash (unique), the overdue-quote sweep (ix_quotes_agency_status; only the agency's live
sent quotes are left to filter) and enquiries by status (ix_enquiries_agency_status).

`IF NOT EXISTS` keeps the upgrade safe to re-run. These run inside the migration's transaction
and lock writes to each table while it builds, which is fine at this data size; on a large
production database use `CREATE INDEX CONCURRENTLY` outside a transaction instead.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008_hot_path_indexes"
down_revision: str | None = "0007_workspace_fk_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEXES = {
    "ix_enquiries_agency_created": "enquiries (agency_id, created_at, number)",
    "ix_quotes_agency_created": "quotes (agency_id, created_at, number)",
    "ix_clients_agency_updated": "clients (agency_id, updated_at DESC, id)",
    "ix_flight_searches_route": "flight_searches (agency_id, origin, destination, created_at)",
}


def upgrade() -> None:
    for name, target in _INDEXES.items():
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {target}")


def downgrade() -> None:
    for name in reversed(_INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {name}")
