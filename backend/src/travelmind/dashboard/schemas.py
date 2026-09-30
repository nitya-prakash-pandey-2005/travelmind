"""Response shapes for the Command Center: dashboard panels, notifications, onboarding, search.

Money is integer minor units in the agency currency named alongside it; dates are the agency's
local calendar days (YYYY-MM-DD); timestamps are UTC ISO 8601.
"""

import datetime as dt
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

Range = Literal["7d", "30d", "90d"]
HealthRange = Literal["24h", "7d"]
KpiKey = Literal[
    "open_enquiries",
    "quotes_sent",
    "win_rate",
    "pipeline_value",
    "response_time",
    "co2_quoted",
    "searches",
]
KpiUnit = Literal["count", "percent", "money", "minutes", "kg"]
Provenance = Literal["LIVE", "SANDBOX", "MIXED"]
Number = int | float


class SeriesPoint(BaseModel):
    date: dt.date
    value: Number


class Kpi(BaseModel):
    key: KpiKey
    label: str
    value: Number | None
    unit: KpiUnit
    previous: Number | None
    series: list[SeriesPoint]


class SummaryOut(BaseModel):
    range: Range
    currency: str
    kpis: list[Kpi]


class PipelineStage(BaseModel):
    status: Literal["new", "quoting", "quoted", "won", "lost"]
    count: int
    value_minor: int


class PipelineOut(BaseModel):
    currency: str
    stages: list[PipelineStage]


class ActorRef(BaseModel):
    id: UUID
    full_name: str


class ActivityItem(BaseModel):
    id: UUID
    kind: str
    summary: str
    occurred_at: datetime
    actor: ActorRef | None
    entity_type: str | None
    entity_id: UUID | None


class ActivityOut(BaseModel):
    items: list[ActivityItem]


class MarketRoute(BaseModel):
    origin: str
    destination: str
    current_minor: int
    previous_minor: int
    change_pct: float
    samples: int
    weekly: list[int | None]
    provenance: Provenance


class MarketPulseOut(BaseModel):
    currency: str
    routes: list[MarketRoute]


class SupplierHealth(BaseModel):
    supplier: str
    kind: str
    calls: int
    ok: int
    success_pct: float
    p50_ms: int | None
    p95_ms: int | None
    avg_offers: float | None


class SupplierHealthOut(BaseModel):
    suppliers: list[SupplierHealth]


class MemberRef(BaseModel):
    id: UUID
    full_name: str
    role: str


class TeamMemberStats(BaseModel):
    user: MemberRef
    enquiries: int
    quotes_sent: int
    won_value_minor: int


class TeamOut(BaseModel):
    members: list[TeamMemberStats]


class Departure(BaseModel):
    enquiry_id: UUID
    number: str
    client: str | None
    origin: str | None
    destination: str | None
    depart_date: date
    travellers: int


class DeparturesOut(BaseModel):
    items: list[Departure]


class OnboardingItem(BaseModel):
    key: Literal["profile", "supplier", "team", "fare_scan", "client", "quote"]
    label: str
    done: bool
    href: str


class OnboardingOut(BaseModel):
    items: list[OnboardingItem]
    completed: int
    total: int


class NotificationItem(BaseModel):
    id: UUID
    kind: str
    summary: str
    occurred_at: datetime
    read: bool


class NotificationsOut(BaseModel):
    unread: int
    items: list[NotificationItem]


class ClientHit(BaseModel):
    id: UUID
    name: str
    email: str | None
    company_name: str | None


class EnquiryHit(BaseModel):
    id: UUID
    number: str
    origin: str | None
    destination: str | None
    status: str


class QuoteHit(BaseModel):
    id: UUID
    number: str
    status: str
    client_name: str | None


class SearchOut(BaseModel):
    clients: list[ClientHit]
    enquiries: list[EnquiryHit]
    quotes: list[QuoteHit]
