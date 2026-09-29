"""Response shapes for hotel search."""

from datetime import date

from pydantic import BaseModel

from travelmind.hotels.models import HotelOffer
from travelmind.offers.money import Money
from travelmind.offers.schemas import SourceStatusOut


class HotelOfferView(HotelOffer):
    display_total: Money | None = None


class HotelSearchResponse(BaseModel):
    display_currency: str
    # Date of the exchange rates behind any converted display_total (None if nothing converted).
    fx_as_of: date | None = None
    nights: int
    sources: list[SourceStatusOut]
    offers: list[HotelOfferView]
