"""agency profile, workspace tables (clients, enquiries, quotes, activity), per-source results

Revision ID: 0004_workspace
Revises: 0003_offers
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from travelmind.db import tenant_rls_statements

revision: str = "0004_workspace"
down_revision: str | None = "0003_offers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def _agency_fk() -> sa.Column:
    return sa.Column(
        "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
    )


def _user_fk(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=nullable)


def _created() -> sa.Column:
    return sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.add_column(
        "agencies", sa.Column("country_code", sa.String(2), server_default="IN", nullable=False)
    )
    op.add_column(
        "agencies", sa.Column("currency", sa.String(3), server_default="INR", nullable=False)
    )
    op.add_column(
        "agencies",
        sa.Column("timezone", sa.String(64), server_default="Asia/Kolkata", nullable=False),
    )
    op.add_column(
        "agencies", sa.Column("brand_color", sa.String(7), server_default="#22d3ee", nullable=False)
    )
    op.add_column(
        "agencies", sa.Column("is_demo", sa.Boolean, server_default=sa.false(), nullable=False)
    )
    op.add_column("agencies", sa.Column("demo_expires_at", TS, nullable=True))
    op.add_column(
        "agencies", sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False)
    )
    op.create_index(
        "ix_agencies_demo_expiry",
        "agencies",
        ["demo_expires_at"],
        postgresql_where=sa.text("is_demo"),
    )
    op.add_column("users", sa.Column("notifications_seen_at", TS, nullable=True))

    op.create_table(
        "agency_counters",
        _agency_fk(),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("value", sa.Integer, nullable=False),
        sa.PrimaryKeyConstraint("agency_id", "kind"),
    )
    op.create_table(
        "clients",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("company_name", sa.String(200), nullable=True),
        sa.Column("home_airport", sa.String(3), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String(40)), server_default="{}", nullable=False),
        _user_fk("created_by"),
        _created(),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('individual', 'company')", name="ck_clients_kind"),
    )
    op.create_index("ix_clients_agency_name", "clients", ["agency_id", "name"])
    op.create_index(
        "uq_clients_agency_email",
        "clients",
        ["agency_id", sa.text("lower(email)")],
        unique=True,
        postgresql_where=sa.text("email IS NOT NULL"),
    )
    op.create_table(
        "enquiries",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column(
            "client_id", UUID, sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("raw_text", sa.Text, nullable=True),
        sa.Column("origin", sa.String(3), nullable=True),
        sa.Column("destination", sa.String(3), nullable=True),
        sa.Column("depart_date", sa.Date, nullable=True),
        sa.Column("return_date", sa.Date, nullable=True),
        sa.Column("adults", sa.SmallInteger, server_default="1", nullable=False),
        sa.Column(
            "children_ages", postgresql.ARRAY(sa.SmallInteger), server_default="{}", nullable=False
        ),
        sa.Column("cabin", sa.String(20), server_default="economy", nullable=False),
        sa.Column("budget_minor", sa.BigInteger, nullable=True),
        sa.Column("budget_currency", sa.String(3), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("status", sa.String(12), server_default="new", nullable=False),
        sa.Column("lost_reason", sa.String(200), nullable=True),
        _user_fk("assignee_user_id"),
        _user_fk("created_by"),
        _created(),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", TS, nullable=True),
        sa.UniqueConstraint("agency_id", "number", name="uq_enquiries_number"),
        sa.CheckConstraint(
            "status IN ('new','quoting','quoted','won','lost')", name="ck_enquiries_status"
        ),
        sa.CheckConstraint("source IN ('manual','pasted','copilot')", name="ck_enquiries_source"),
    )
    op.create_index(
        "ix_enquiries_agency_status", "enquiries", ["agency_id", "status", "created_at"]
    )
    op.create_table(
        "quotes",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column(
            "enquiry_id", UUID, sa.ForeignKey("enquiries.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "client_id", UUID, sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("status", sa.String(12), server_default="draft", nullable=False),
        sa.Column("current_version", sa.Integer, server_default="0", nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("markup_kind", sa.String(8), server_default="percent", nullable=False),
        sa.Column("markup_value", sa.BigInteger, server_default="0", nullable=False),
        sa.Column("share_token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("share_expires_at", TS, nullable=True),
        sa.Column("sent_at", TS, nullable=True),
        sa.Column("first_viewed_at", TS, nullable=True),
        sa.Column("decided_at", TS, nullable=True),
        _user_fk("created_by"),
        _created(),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("agency_id", "number", name="uq_quotes_number"),
        sa.CheckConstraint(
            "status IN ('draft','sent','viewed','accepted','declined','expired')",
            name="ck_quotes_status",
        ),
        sa.CheckConstraint("markup_kind IN ('fixed','percent')", name="ck_quotes_markup_kind"),
        sa.CheckConstraint("markup_value >= 0", name="ck_quotes_markup_value"),
    )
    op.create_index("ix_quotes_agency_status", "quotes", ["agency_id", "status", "created_at"])
    op.create_table(
        "quote_versions",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("quote_id", UUID, sa.ForeignKey("quotes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("message", sa.Text, server_default="", nullable=False),
        sa.Column("options", postgresql.JSONB, nullable=False),
        sa.Column("totals", postgresql.JSONB, nullable=False),
        _user_fk("created_by"),
        _created(),
        sa.UniqueConstraint("quote_id", "version", name="uq_quote_versions_version"),
    )
    op.create_table(
        "activity_events",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("occurred_at", TS, server_default=sa.func.now(), nullable=False),
        _user_fk("actor_user_id"),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("entity_type", sa.String(20), nullable=True),
        sa.Column("entity_id", UUID, nullable=True),
        sa.Column("summary", sa.String(300), nullable=False),
        sa.Column("data", postgresql.JSONB, server_default="{}", nullable=False),
    )
    op.create_index("ix_activity_agency_time", "activity_events", ["agency_id", "occurred_at"])
    op.create_table(
        "search_source_results",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _agency_fk(),
        sa.Column("search_kind", sa.String(8), nullable=False),
        sa.Column("search_id", UUID, nullable=True),
        sa.Column("supplier", sa.String(30), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("offer_count", sa.Integer, nullable=False),
        sa.Column("latency_ms", sa.Integer, nullable=False),
        sa.Column("occurred_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("search_kind IN ('flights','hotels')", name="ck_ssr_kind"),
    )
    op.create_index("ix_ssr_agency_time", "search_source_results", ["agency_id", "occurred_at"])

    for table in (
        "agency_counters",
        "clients",
        "enquiries",
        "quotes",
        "quote_versions",
        "activity_events",
        "search_source_results",
    ):
        for statement in tenant_rls_statements(table):
            op.execute(statement)
    op.execute(
        "REVOKE UPDATE, DELETE ON activity_events, quote_versions, search_source_results "
        "FROM travelmind_app"
    )


def downgrade() -> None:
    for table in (
        "search_source_results",
        "activity_events",
        "quote_versions",
        "quotes",
        "enquiries",
        "clients",
        "agency_counters",
    ):
        op.drop_table(table)
    op.drop_column("users", "notifications_seen_at")
    op.drop_index("ix_agencies_demo_expiry", table_name="agencies")
    for column in (
        "updated_at",
        "demo_expires_at",
        "is_demo",
        "brand_color",
        "timezone",
        "currency",
        "country_code",
    ):
        op.drop_column("agencies", column)
