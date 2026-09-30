from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from travelmind.config import Settings
from travelmind.offers.models import FlightOffer, FlightSearchRequest, Segment, Slice
from travelmind.offers.money import Money, exponent, per_traveller_minor


def future(days: int) -> date:
    return datetime.now(UTC).date() + timedelta(days=days)


def test_money_from_decimal_uses_minor_units():
    assert Money.from_decimal("45.00", "gbp") == Money(amount_minor=4500, currency="GBP")
    assert Money.from_decimal(Decimal("4500.50"), "INR").amount_minor == 450050
    assert Money.from_decimal("1200", "JPY").amount_minor == 1200
    assert Money.from_decimal("1.234", "KWD").amount_minor == 1234
    assert Money.from_decimal(163.66, "USD").amount_minor == 16366


def test_money_rounds_half_up_and_round_trips():
    assert Money.from_decimal("10.005", "USD").amount_minor == 1001
    assert Money(amount_minor=450050, currency="INR").to_decimal() == Decimal("4500.50")
    assert exponent("usd") == 2


@pytest.mark.parametrize(
    ("total", "travellers", "each"),
    [(500000, 1, 500000), (600001, 2, 300001), (600003, 2, 300002), (100, 3, 33), (200, 3, 67)],
)
def test_per_traveller_share_rounds_half_up_to_a_minor_unit(total, travellers, each):
    assert per_traveller_minor(total, travellers) == each


def test_per_traveller_share_needs_a_traveller():
    with pytest.raises(ValueError):
        per_traveller_minor(1000, 0)


def test_money_is_immutable_and_validates_currency():
    money = Money(amount_minor=100, currency="USD")
    with pytest.raises(ValidationError):
        money.amount_minor = 5  # type: ignore[misc]
    with pytest.raises(ValidationError):
        Money(amount_minor=100, currency="dollars")


@pytest.mark.parametrize(
    "amount", ["NaN", "Infinity", "-inf", float("nan"), float("inf"), Decimal("-Infinity")]
)
def test_money_rejects_non_finite_amounts(amount):
    with pytest.raises(ValueError, match="finite number"):
        Money.from_decimal(amount, "USD")


def test_search_request_normalises_codes():
    request = FlightSearchRequest(origin=" del", destination="bom ", departure_date=future(10))
    assert (request.origin, request.destination) == ("DEL", "BOM")
    assert request.passenger_count == 1


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"destination": "DEL"}, "must be different airports"),
        ({"departure_date": future(-1)}, "in the past"),
        ({"departure_date": future(400)}, "days ahead"),
        ({"return_date": future(5)}, "before the departure date"),
        ({"adults": 8, "children_ages": [5, 7]}, "at most 9 passengers"),
    ],
)
def test_search_request_rejects_impossible_trips(changes, message):
    fields = {"origin": "DEL", "destination": "BOM", "departure_date": future(10)} | changes
    with pytest.raises(ValidationError, match=message):
        FlightSearchRequest(**fields)


def test_search_request_bounds_passenger_fields():
    base = {"origin": "DEL", "destination": "BOM", "departure_date": future(10)}
    with pytest.raises(ValidationError):
        FlightSearchRequest(**base, adults=0)
    with pytest.raises(ValidationError):
        FlightSearchRequest(**base, children_ages=[18])
    with pytest.raises(ValidationError):
        FlightSearchRequest(**base, cabin="luxury")


def leg(origin: str, destination: str) -> Segment:
    return Segment(
        origin=origin,
        destination=destination,
        marketing_carrier="EK",
        flight_number="511",
        departing_at=datetime(2026, 11, 20, 4, 0),
        arriving_at=datetime(2026, 11, 20, 6, 0),
    )


def journey(*airports: str, duration: int | None = None) -> Slice:
    segments = [leg(a, b) for a, b in zip(airports, airports[1:], strict=False)]
    return Slice(
        origin=airports[0], destination=airports[-1], segments=segments, duration_minutes=duration
    )


def offer(*slices: Slice) -> FlightOffer:
    return FlightOffer(
        id="off_1",
        supplier="sandbox",
        supplier_ref="ref_1",
        provenance="SANDBOX",
        total=Money(amount_minor=4500000, currency="INR"),
        owner_carrier="EK",
        passenger_count=1,
        slices=list(slices),
        fetched_at=datetime.now(UTC),
    )


def test_slice_counts_stops():
    assert journey("DEL", "LHR").stops == 0
    assert journey("DEL", "DXB", "LHR").stops == 1
    assert journey("DEL", "DXB", "IST", "LHR").stops == 2
    assert Slice(origin="DEL", destination="LHR", segments=[]).stops == 0


def test_offer_stops_is_the_worst_slice():
    assert offer(journey("DEL", "LHR"), journey("LHR", "DXB", "DEL")).stops == 1
    assert offer(journey("DEL", "LHR")).stops == 0
    assert offer().stops == 0


def test_offer_total_duration_sums_slices_and_needs_every_duration():
    outbound = journey("DEL", "LHR", duration=570)
    inbound = journey("LHR", "DXB", "DEL", duration=660)
    assert offer(outbound, inbound).total_duration_minutes == 1230
    assert offer(outbound, journey("LHR", "DEL")).total_duration_minutes is None
    assert offer().total_duration_minutes == 0


def test_sandbox_supplier_defaults_on_except_in_production():
    # _env_file=None: a developer's backend/.env must not decide this test.
    assert Settings(_env_file=None, environment="development").sandbox_supplier_enabled is True
    assert Settings(_env_file=None, environment="production").sandbox_supplier_enabled is False
    enabled = Settings(_env_file=None, environment="production", sandbox_supplier=True)
    assert enabled.sandbox_supplier_enabled is True


def test_empty_sandbox_supplier_env_means_default(monkeypatch):
    monkeypatch.setenv("TM_SANDBOX_SUPPLIER", "")
    assert Settings(_env_file=None, environment="development").sandbox_supplier is None
    assert Settings(_env_file=None, environment="production").sandbox_supplier_enabled is False
