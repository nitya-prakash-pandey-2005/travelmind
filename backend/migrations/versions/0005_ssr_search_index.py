"""index search_source_results by search (market pulse joins sources to their searches)

Revision ID: 0005_ssr_search_index
Revises: 0004_workspace
Create Date: 2026-09-30
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005_ssr_search_index"
down_revision: str | None = "0004_workspace"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_ssr_search", "search_source_results", ["search_id"])


def downgrade() -> None:
    op.drop_index("ix_ssr_search", table_name="search_source_results")
