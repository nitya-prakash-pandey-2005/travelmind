from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

from travelmind.offers.models import IataCode, Provenance
from travelmind.offers.money import Money

MAX_NIGHTS = 30
MAX_DAYS_AHEAD = 360


class RoomRequest(BaseModel):
    adults: int = Field(default=2, ge=1, le=6)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(
        default_factory=list, max_length=4
    )


class HotelSearchRequest(BaseModel):
    destination: IataCode
    checkin: date
    checkout: date
    rooms: list[RoomRequest] = Field(
        default_factory=lambda: [RoomRequest()], min_length=1, max_length=4
    )
    radius_km: int = Field(default=15, ge=1, le=50)

    @model_validator(mode="after")
    def _check_stay(self) -> "HotelSearchRequest":
        today = datetime.now(UTC).date()
        if self.checkin < today:
            raise ValueError("The check-in date is in the past.")
        if self.checkin > today + timedelta(days=MAX_DAYS_AHEAD):
            raise ValueError(f"Hotels only sell about {MAX_DAYS_AHEAD} days ahead.")
        if self.checkout <= self.checkin:
            raise ValueError("The check-out date must be after check-in.")
        if (self.checkout - self.checkin).days > MAX_NIGHTS:
            raise ValueError(f"A stay can be at most {MAX_NIGHTS} nights.")
        return self

    @property
    def nights(self) -> int:
        return (self.checkout - self.checkin).days


class HotelOffer(BaseModel):
    id: str
    supplier: str
    provenance: Provenance
    hotel_id: str
    name: str
    stars: float | None = None
    rating: float | None = None
    address: str | None = None
    photo_url: str | None = None
    room_name: str | None = None
    board: str | None = None
    total: Money
    refundable: bool | None = None
    free_cancellation_until: str | None = None
    nights: int
    fetched_at: datetime
