"""index the workspace's hot read paths: timelines, client stats and quote lookups

Revision ID: 0007_workspace_fk_indexes
Revises: 0006_public_quotes
Create Date: 2026-10-03

- activity_events by entity, newest first: the enquiry, client and quote timelines.
- enquiries by client and departure date: a client's enquiry count and last/next trip.
- quotes by client and status: a client's quote count and won value.
- quotes by enquiry: an enquiry's quotes (timelines, enquiry detail, client timelines).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_workspace_fk_indexes"
down_revision: str | None = "0006_public_quotes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_activity_entity",
        "activity_events",
        ["agency_id", "entity_type", "entity_id", sa.text("occurred_at DESC")],
    )
    op.create_index("ix_enquiries_client_depart", "enquiries", ["client_id", "depart_date"])
    op.create_index("ix_quotes_client_status", "quotes", ["client_id", "status"])
    op.create_index("ix_quotes_enquiry", "quotes", ["enquiry_id"])


def downgrade() -> None:
    op.drop_index("ix_quotes_enquiry", table_name="quotes")
    op.drop_index("ix_quotes_client_status", table_name="quotes")
    op.drop_index("ix_enquiries_client_depart", table_name="enquiries")
    op.drop_index("ix_activity_entity", table_name="activity_events")
