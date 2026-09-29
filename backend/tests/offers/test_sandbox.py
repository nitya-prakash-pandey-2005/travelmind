import base64
import json
from datetime import UTC, date, datetime, timedelta

import pytest

from tests.offers.airports import lookup
from travelmind.offers.models import FlightSearchRequest
from travelmind.offers.suppliers.base import SupplierError, split_offer_id
from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier


def future(days: int) -> date:
    return datetime.now(UTC).date() + timedelta(days=days)


def supplier() -> SandboxFlightSupplier:
    return SandboxFlightSupplier(lookup)


def request(**changes) -> FlightSearchRequest:
    fields = {"origin": "DEL", "destination": "BOM", "departure_date": future(30)} | changes
    return FlightSearchRequest(**fields)


async def test_same_search_gives_the_same_offers():
    first = await supplier().search(request())
    second = await supplier().search(request())
    assert [(o.id, o.total) for o in first] == [(o.id, o.total) for o in second]
    assert len(first) >= 4


async def test_indian_domestic_route():
    offers = await supplier().search(request())
    assert {o.owner_carrier for o in offers} <= {"AI", "6E", "QP"}
    for offer in offers:
        assert offer.provenance == "SANDBOX"
        assert offer.supplier == "sandbox"
        assert offer.total.currency == "INR"
        assert offer.total.amount_minor % 100 == 0  # whole rupees
        assert offer.stops == 0
        assert offer.expires_at == offer.fetched_at + timedelta(minutes=30)
        assert split_offer_id(offer.id) == ("sandbox", offer.supplier_ref)
        assert offer.base is not None and offer.tax is not None
        assert offer.base.amount_minor + offer.tax.amount_minor == offer.total.amount_minor


async def test_long_haul_offers_connections_through_hubs():
    offers = await supplier().search(request(origin="LHR", destination="SYD"))
    vias = {o.slices[0].segments[0].destination for o in offers if o.stops == 1}
    assert vias & {"DXB", "DOH", "IST"}
    assert all(o.total.currency == "USD" for o in offers)


async def test_nonstop_only_search_drops_connections():
    offers = await supplier().search(request(origin="LHR", destination="SYD", max_connections=0))
    assert offers and all(o.stops == 0 for o in offers)


async def test_routes_without_known_carriers_use_sandbox_air():
    offers = await supplier().search(request(origin="GRU", destination="GIG"))
    assert {o.owner_carrier for o in offers} == {"ZZ"}
    assert offers[0].owner_name == "Sandbox Air"


async def test_business_costs_more_than_economy():
    economy = {
        o.owner_carrier: o.total.amount_minor
        for o in await supplier().search(request())
        if "Flex" not in (o.slices[0].fare_brand or "")
    }
    business = {
        o.owner_carrier: o.total.amount_minor
        for o in await supplier().search(request(cabin="business"))
        if "Flex" not in (o.slices[0].fare_brand or "")
    }
    assert all(business[c] > economy[c] for c in economy)


async def test_round_trip_has_a_return_slice():
    offers = await supplier().search(request(return_date=future(37)))
    back = offers[0].slices[1]
    assert (back.origin, back.destination) == ("BOM", "DEL")
    assert back.segments[0].departing_at.date() == future(37)


async def test_passengers_scale_the_price():
    one = (await supplier().search(request()))[0].total.amount_minor
    two = (await supplier().search(request(adults=2)))[0].total.amount_minor
    with_infant = (await supplier().search(request(adults=2, children_ages=[1])))[
        0
    ].total.amount_minor
    assert two == pytest.approx(one * 2, rel=0.01)
    assert two < with_infant < two * 1.2


async def test_last_minute_is_pricier_than_booking_ahead():
    near = {
        o.owner_carrier: o.total.amount_minor
        for o in await supplier().search(request(departure_date=future(3)))
    }
    far = {
        o.owner_carrier: o.total.amount_minor
        for o in await supplier().search(request(departure_date=future(90)))
    }
    assert sum(near.values()) > sum(far.values())


async def test_price_rebuilds_the_same_offer():
    offer = (await supplier().search(request()))[0]
    repriced = await supplier().price(offer.supplier_ref)
    assert repriced.id == offer.id
    assert repriced.total == offer.total


async def test_price_of_garbage_reference_is_unavailable():
    with pytest.raises(SupplierError) as err:
        await supplier().price("not-a-real-reference")
    assert err.value.code == "offer_unavailable"


async def test_unknown_airport_is_an_invalid_request():
    with pytest.raises(SupplierError) as err:
        await supplier().search(request(origin="XXX"))
    assert err.value.code == "invalid_request"


def _tamper(ref: str, **changes: object) -> str:
    data = json.loads(base64.urlsafe_b64decode(ref + "=" * (-len(ref) % 4))) | changes
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


@pytest.mark.parametrize("changes", [{"via": 123}, {"via": "LHR"}, {"v": 7}, {"v": -1}])
async def test_price_of_tampered_reference_is_unavailable(changes):
    offer = (await supplier().search(request()))[0]
    with pytest.raises(SupplierError) as err:
        await supplier().price(_tamper(offer.supplier_ref, **changes))
    assert err.value.code == "offer_unavailable"
