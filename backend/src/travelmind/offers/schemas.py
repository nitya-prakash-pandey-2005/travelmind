"""Response shapes for flight search, re-pricing and supplier status."""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from travelmind.fareintel.service import Family
from travelmind.offers.models import FlightOffer
from travelmind.offers.money import Money
from travelmind.offers.search import SourceState


class InsightOut(BaseModel):
    signal: Literal["good", "typical", "high"]
    delta_pct: float
    message: str


class BaselineOut(BaseModel):
    family: Family
    currency: str
    sample_size: int
    p25_minor: int
    median_minor: int
    p75_minor: int
    window_days: int


class OfferView(FlightOffer):
    display_total: Money | None = None
    insight: InsightOut | None = None


class SourceStatusOut(BaseModel):
    supplier: str
    status: SourceState
    offer_count: int
    latency_ms: int
    message: str | None


class FlightSearchResponse(BaseModel):
    search_id: UUID
    display_currency: str
    fx_as_of: date | None
    baseline: BaselineOut | None
    sources: list[SourceStatusOut]
    offers: list[OfferView]


class RepriceResponse(BaseModel):
    offer: OfferView
    price_changed: bool
    previous_total: Money


class SupplierStatusOut(BaseModel):
    code: str
    name: str
    kind: Literal["flights", "hotels", "emissions", "price_history", "exchange_rates"]
    connected: bool
    mode: Literal["live", "test", "sandbox"] | None
    detail: str
