from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    Field,
    StringConstraints,
    computed_field,
    model_validator,
)

from travelmind.offers.money import Money, normalise_code

IataCode = Annotated[str, BeforeValidator(normalise_code), StringConstraints(pattern=r"^[A-Z]{3}$")]
Cabin = Literal["economy", "premium_economy", "business", "first"]
Provenance = Literal["LIVE", "CACHED", "SANDBOX"]
Co2Source = Literal["google_tim", "google_tim_typical", "supplier"]

MAX_PASSENGERS = 9
MAX_DAYS_AHEAD = 360


class FlightSearchRequest(BaseModel):
    origin: IataCode
    destination: IataCode
    departure_date: date
    return_date: date | None = None
    adults: int = Field(default=1, ge=1, le=MAX_PASSENGERS)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(
        default_factory=list, max_length=8
    )
    cabin: Cabin = "economy"
    max_connections: int = Field(default=1, ge=0, le=2)

    @model_validator(mode="after")
    def _check_trip(self) -> "FlightSearchRequest":
        today = datetime.now(UTC).date()
        if self.origin == self.destination:
            raise ValueError("Origin and destination must be different airports.")
        if self.departure_date < today:
            raise ValueError("The departure date is in the past.")
        if self.departure_date > today + timedelta(days=MAX_DAYS_AHEAD):
            raise ValueError(f"Airlines only sell about {MAX_DAYS_AHEAD} days ahead.")
        if self.return_date is not None and self.return_date < self.departure_date:
            raise ValueError("The return date is before the departure date.")
        if self.adults + len(self.children_ages) > MAX_PASSENGERS:
            raise ValueError(f"A search can include at most {MAX_PASSENGERS} passengers.")
        return self

    @property
    def passenger_count(self) -> int:
        return self.adults + len(self.children_ages)


class Segment(BaseModel):
    origin: str
    destination: str
    departing_at: datetime  # local airport time, no offset (as suppliers return it)
    arriving_at: datetime
    marketing_carrier: str
    marketing_carrier_name: str | None = None
    flight_number: str
    operating_carrier: str | None = None
    operating_flight_number: str | None = None
    duration_minutes: int | None = None


class Slice(BaseModel):
    origin: str
    destination: str
    duration_minutes: int | None = None
    fare_brand: str | None = None
    segments: list[Segment]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def stops(self) -> int:
        return max(len(self.segments) - 1, 0)


class Baggage(BaseModel):
    checked: int | None = None
    carry_on: int | None = None


class FareConditions(BaseModel):
    refundable: bool | None = None
    refund_penalty: Money | None = None
    changeable: bool | None = None
    change_penalty: Money | None = None


class FlightOffer(BaseModel):
    id: str
    supplier: str
    supplier_ref: str
    provenance: Provenance
    total: Money
    base: Money | None = None
    tax: Money | None = None
    owner_carrier: str
    owner_name: str | None = None
    cabin: Cabin | None = None
    passenger_count: int
    slices: list[Slice]
    baggage: Baggage = Field(default_factory=Baggage)
    conditions: FareConditions = Field(default_factory=FareConditions)
    co2_kg_per_passenger: int | None = None
    co2_source: Co2Source | None = None
    fetched_at: datetime
    expires_at: datetime | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def stops(self) -> int:
        return max((s.stops for s in self.slices), default=0)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def total_duration_minutes(self) -> int | None:
        durations = [s.duration_minutes for s in self.slices]
        if any(d is None for d in durations):
            return None
        return sum(d for d in durations if d is not None)
