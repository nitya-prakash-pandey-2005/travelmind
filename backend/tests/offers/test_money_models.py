from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from travelmind.config import Settings
from travelmind.offers.models import FlightSearchRequest, Segment, Slice
from travelmind.offers.money import Money, exponent


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


def test_money_is_immutable_and_validates_currency():
    money = Money(amount_minor=100, currency="USD")
    with pytest.raises(ValidationError):
        money.amount_minor = 5  # type: ignore[misc]
    with pytest.raises(ValidationError):
        Money(amount_minor=100, currency="dollars")


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


def test_slice_counts_stops():
    leg = {
        "marketing_carrier": "EK",
        "flight_number": "511",
        "departing_at": datetime(2026, 11, 20, 4, 0),
        "arriving_at": datetime(2026, 11, 20, 6, 0),
    }
    one_stop = Slice(
        origin="DEL",
        destination="LHR",
        segments=[
            Segment(origin="DEL", destination="DXB", **leg),
            Segment(origin="DXB", destination="LHR", **leg),
        ],
    )
    assert one_stop.stops == 1


def test_sandbox_supplier_defaults_on_except_in_production():
    assert Settings(environment="development").sandbox_supplier_enabled is True
    assert Settings(environment="production").sandbox_supplier_enabled is False
    assert (
        Settings(environment="production", sandbox_supplier=True).sandbox_supplier_enabled is True
    )


def test_empty_sandbox_supplier_env_means_default(monkeypatch):
    monkeypatch.setenv("TM_SANDBOX_SUPPLIER", "")
    assert Settings(environment="development").sandbox_supplier is None
    assert Settings(environment="production").sandbox_supplier_enabled is False
