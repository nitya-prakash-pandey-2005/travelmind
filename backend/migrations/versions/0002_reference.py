"""global reference data: countries and airports

Revision ID: 0002_reference
Revises: 0001_identity
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_reference"
down_revision: str | None = "0001_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "countries",
        sa.Column("code", sa.String(2), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("continent", sa.String(2), nullable=True),
    )
    op.create_table(
        "airports",
        sa.Column("iata_code", sa.String(3), primary_key=True),
        sa.Column("ident", sa.String(16), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("city", sa.String(200), nullable=True),
        sa.Column("country_code", sa.String(2), sa.ForeignKey("countries.code"), nullable=False),
        sa.Column("airport_type", sa.String(32), nullable=False),
        sa.Column("scheduled_service", sa.Boolean, nullable=False),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("keywords", sa.Text, nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # Reference data is written only by the importer (owner role); the app just reads it.
    op.execute("REVOKE INSERT, UPDATE, DELETE ON countries, airports FROM travelmind_app")


def downgrade() -> None:
    op.drop_table("airports")
    op.drop_table("countries")
