"""flight search log (tenant) and fare snapshots (global market data)

Revision ID: 0003_offers
Revises: 0002_reference
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from travelmind.db import tenant_rls_statements

revision: str = "0003_offers"
down_revision: str | None = "0002_reference"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "flight_searches",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("origin", sa.String(3), nullable=False),
        sa.Column("destination", sa.String(3), nullable=False),
        sa.Column("departure_date", sa.Date, nullable=False),
        sa.Column("return_date", sa.Date, nullable=True),
        sa.Column("adults", sa.SmallInteger, nullable=False),
        sa.Column("children", sa.SmallInteger, nullable=False),
        sa.Column("cabin", sa.String(20), nullable=False),
        sa.Column("offer_count", sa.Integer, nullable=False),
        sa.Column("display_currency", sa.String(3), nullable=False),
        sa.Column("cheapest_minor", sa.BigInteger, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_flight_searches_agency_created", "flight_searches", ["agency_id", "created_at"]
    )
    for statement in tenant_rls_statements("flight_searches"):
        op.execute(statement)

    op.create_table(
        "fare_snapshots",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column(
            "observed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("origin", sa.String(3), nullable=False),
        sa.Column("destination", sa.String(3), nullable=False),
        sa.Column("departure_date", sa.Date, nullable=False),
        sa.Column("days_to_departure", sa.Integer, nullable=False),
        sa.Column("cabin", sa.String(20), nullable=False),
        sa.Column("carrier", sa.String(3), nullable=True),
        sa.Column("stops", sa.SmallInteger, nullable=True),
        sa.Column("total_minor", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("provenance", sa.String(10), nullable=False),
        sa.Column("source", sa.String(30), nullable=False),
        sa.CheckConstraint(
            "provenance IN ('LIVE', 'CACHED', 'SANDBOX')", name="ck_fare_snapshots_provenance"
        ),
        # Price insights divide by the median fare, so a zero or negative fare must never get in.
        sa.CheckConstraint("total_minor > 0", name="ck_fare_snapshots_total_positive"),
    )
    op.create_index(
        "ix_fare_snapshots_route",
        "fare_snapshots",
        ["origin", "destination", "cabin", "currency", "observed_at"],
    )
    # Market data is append-only for the application.
    op.execute("REVOKE UPDATE, DELETE ON fare_snapshots FROM travelmind_app")


def downgrade() -> None:
    op.drop_table("fare_snapshots")
    op.drop_table("flight_searches")
