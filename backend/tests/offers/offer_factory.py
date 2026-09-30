from datetime import UTC, datetime, timedelta

from travelmind.offers.models import FlightOffer, Segment, Slice
from travelmind.offers.money import Money


def make_offer(
    segments: list[tuple[str, str, str, str, str]],
    *,
    offer_ref: str = "ref-1",
    supplier: str = "stub",
    total_minor: int = 500000,
    currency: str = "INR",
    provenance: str = "SANDBOX",
    **overrides: object,
) -> FlightOffer:
    legs = []
    for origin, destination, carrier, number, departing in segments:
        start = datetime.fromisoformat(departing)
        legs.append(
            Segment(
                origin=origin,
                destination=destination,
                departing_at=start,
                arriving_at=start + timedelta(hours=2),
                marketing_carrier=carrier,
                flight_number=number,
                operating_carrier=carrier,
                duration_minutes=120,
            )
        )
    fields: dict[str, object] = {
        "id": f"{supplier}~{offer_ref}",
        "supplier": supplier,
        "supplier_ref": offer_ref,
        "provenance": provenance,
        "total": Money(amount_minor=total_minor, currency=currency),
        "owner_carrier": segments[0][2],
        "passenger_count": 1,
        "slices": [
            Slice(
                origin=segments[0][0],
                destination=segments[-1][1],
                duration_minutes=120 * len(legs),
                segments=legs,
            )
        ],
        "fetched_at": datetime.now(UTC),
    } | overrides
    return FlightOffer.model_validate(fields)
