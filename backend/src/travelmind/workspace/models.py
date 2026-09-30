"""Workspace tables: clients, enquiries, quotes, activity and per-source search results.

All are tenant data under forced RLS (see migration 0004_workspace). `activity_events`,
`quote_versions` and `search_source_results` are append-only for the application role.
"""

from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base, utcnow

_TS = DateTime(timezone=True)


def _agency_fk() -> Mapped[UUID]:
    return mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))


def _user_fk() -> Mapped[UUID | None]:
    return mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


def _timestamp() -> Mapped[datetime]:
    return mapped_column(_TS, default=utcnow, server_default=func.now())


class AgencyCounter(Base):
    """Per-agency running numbers (enquiry E-0001, quote Q-0001). See workspace.counters."""

    __tablename__ = "agency_counters"

    agency_id: Mapped[UUID] = mapped_column(
        ForeignKey("agencies.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(20), primary_key=True)
    value: Mapped[int] = mapped_column(Integer)


class Client(Base):
    __tablename__ = "clients"
    __table_args__ = (
        CheckConstraint("kind IN ('individual', 'company')", name="ck_clients_kind"),
        Index("ix_clients_agency_name", "agency_id", "name"),
        Index(
            "uq_clients_agency_email",
            "agency_id",
            text("lower(email)"),
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = _agency_fk()
    kind: Mapped[str] = mapped_column(String(12))
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    company_name: Mapped[str | None] = mapped_column(String(200))
    home_airport: Mapped[str | None] = mapped_column(String(3))
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list, server_default="{}")
    created_by: Mapped[UUID | None] = _user_fk()
    created_at: Mapped[datetime] = _timestamp()
    updated_at: Mapped[datetime] = _timestamp()


class Enquiry(Base):
    __tablename__ = "enquiries"
    __table_args__ = (
        UniqueConstraint("agency_id", "number", name="uq_enquiries_number"),
        CheckConstraint(
            "status IN ('new','quoting','quoted','won','lost')", name="ck_enquiries_status"
        ),
        CheckConstraint("source IN ('manual','pasted','copilot')", name="ck_enquiries_source"),
        Index("ix_enquiries_agency_status", "agency_id", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = _agency_fk()
    client_id: Mapped[UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"))
    number: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(12))
    raw_text: Mapped[str | None] = mapped_column(Text)
    origin: Mapped[str | None] = mapped_column(String(3))
    destination: Mapped[str | None] = mapped_column(String(3))
    depart_date: Mapped[date | None] = mapped_column(Date)
    return_date: Mapped[date | None] = mapped_column(Date)
    adults: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1")
    children_ages: Mapped[list[int]] = mapped_column(
        ARRAY(SmallInteger), default=list, server_default="{}"
    )
    cabin: Mapped[str] = mapped_column(String(20), default="economy", server_default="economy")
    budget_minor: Mapped[int | None] = mapped_column(BigInteger)
    budget_currency: Mapped[str | None] = mapped_column(String(3))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), default="new", server_default="new")
    lost_reason: Mapped[str | None] = mapped_column(String(200))
    assignee_user_id: Mapped[UUID | None] = _user_fk()
    created_by: Mapped[UUID | None] = _user_fk()
    created_at: Mapped[datetime] = _timestamp()
    updated_at: Mapped[datetime] = _timestamp()
    closed_at: Mapped[datetime | None] = mapped_column(_TS)


class Quote(Base):
    __tablename__ = "quotes"
    __table_args__ = (
        UniqueConstraint("agency_id", "number", name="uq_quotes_number"),
        CheckConstraint(
            "status IN ('draft','sent','viewed','accepted','declined','expired')",
            name="ck_quotes_status",
        ),
        CheckConstraint("markup_kind IN ('fixed','percent')", name="ck_quotes_markup_kind"),
        CheckConstraint("markup_value >= 0", name="ck_quotes_markup_value"),
        Index("ix_quotes_agency_status", "agency_id", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = _agency_fk()
    enquiry_id: Mapped[UUID] = mapped_column(ForeignKey("enquiries.id", ondelete="CASCADE"))
    client_id: Mapped[UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"))
    number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="draft", server_default="draft")
    current_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The version the client was sent (and the share link shows); later drafts wait for a re-send.
    sent_version: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    markup_kind: Mapped[str] = mapped_column(String(8), default="percent", server_default="percent")
    markup_value: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    share_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    share_expires_at: Mapped[datetime | None] = mapped_column(_TS)
    sent_at: Mapped[datetime | None] = mapped_column(_TS)
    first_viewed_at: Mapped[datetime | None] = mapped_column(_TS)
    decided_at: Mapped[datetime | None] = mapped_column(_TS)
    created_by: Mapped[UUID | None] = _user_fk()
    created_at: Mapped[datetime] = _timestamp()
    updated_at: Mapped[datetime] = _timestamp()


class QuoteVersion(Base):
    """Immutable snapshot of a quote's options and totals (append-only)."""

    __tablename__ = "quote_versions"
    __table_args__ = (UniqueConstraint("quote_id", "version", name="uq_quote_versions_version"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = _agency_fk()
    quote_id: Mapped[UUID] = mapped_column(ForeignKey("quotes.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    message: Mapped[str] = mapped_column(Text, default="", server_default="")
    options: Mapped[list[Any]] = mapped_column(JSONB)
    totals: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_by: Mapped[UUID | None] = _user_fk()
    created_at: Mapped[datetime] = _timestamp()


class ActivityEvent(Base):
    """What happened in the workspace, for the activity feed (append-only)."""

    __tablename__ = "activity_events"
    __table_args__ = (Index("ix_activity_agency_time", "agency_id", "occurred_at"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = _agency_fk()
    occurred_at: Mapped[datetime] = _timestamp()
    actor_user_id: Mapped[UUID | None] = _user_fk()
    kind: Mapped[str] = mapped_column(String(40))
    entity_type: Mapped[str | None] = mapped_column(String(20))
    entity_id: Mapped[UUID | None]
    summary: Mapped[str] = mapped_column(String(300))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")


class SearchSourceResult(Base):
    """One row per supplier per search: status, offer count and latency (append-only)."""

    __tablename__ = "search_source_results"
    __table_args__ = (
        CheckConstraint("search_kind IN ('flights','hotels')", name="ck_ssr_kind"),
        Index("ix_ssr_agency_time", "agency_id", "occurred_at"),
        Index("ix_ssr_search", "search_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    agency_id: Mapped[UUID] = _agency_fk()
    search_kind: Mapped[str] = mapped_column(String(8))
    search_id: Mapped[UUID | None]
    supplier: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(16))
    offer_count: Mapped[int] = mapped_column(Integer)
    latency_ms: Mapped[int] = mapped_column(Integer)
    occurred_at: Mapped[datetime] = _timestamp()
