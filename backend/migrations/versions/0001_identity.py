"""identity tables, invitations and audit log with tenant RLS

Revision ID: 0001_identity
Revises:
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from travelmind.db import tenant_rls_statements

revision: str = "0001_identity"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "agencies",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        _created_at(),
    )
    op.create_table(
        "users",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        _created_at(),
        sa.CheckConstraint("role IN ('owner', 'admin', 'agent')", name="ck_users_role"),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lower"),
    )
    op.create_index("ix_users_agency_id", "users", ["agency_id"])
    op.create_table(
        "sessions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table(
        "invitations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "invited_by_user_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('admin', 'agent')", name="ck_invitations_role"),
        sa.CheckConstraint("email = lower(email)", name="ck_invitations_email_lower"),
    )
    op.create_index("ix_invitations_agency_id", "invitations", ["agency_id"])
    op.create_table(
        "audit_log",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "actor_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("before", postgresql.JSONB, nullable=True),
        sa.Column("after", postgresql.JSONB, nullable=True),
        _created_at(),
    )
    op.create_index("ix_audit_log_agency_created", "audit_log", ["agency_id", "created_at"])

    for table in ("invitations", "audit_log"):
        for statement in tenant_rls_statements(table):
            op.execute(statement)
    op.execute("REVOKE UPDATE, DELETE ON audit_log FROM travelmind_app")


def downgrade() -> None:
    for table in ("audit_log", "invitations", "sessions", "users", "agencies"):
        op.drop_table(table)
