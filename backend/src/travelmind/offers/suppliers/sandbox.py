"""Deterministic test inventory for demos, tests and offline development.

Every offer is labelled SANDBOX. Schedules are synthetic and times ignore time zones;
prices follow a simple distance/cabin/demand curve converted at a fixed rate. Nothing here
is bookable and the UI says so.
"""

import base64
import hashlib
import json
import random
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from travelmind.offers.models import (
    Baggage,
    FareConditions,
    FlightOffer,
    FlightSearchRequest,
    Segment,
    Slice,
)
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import AirportLookup, SupplierError, offer_id
from travelmind.reference.geo import great_circle_km
from travelmind.reference.search import AirportRecord

SANDBOX_CODE = "sandbox"
OFFER_TTL = timedelta(minutes=30)
CRUISE_KMH = 800
GROUND_MINUTES = 35
LONG_HAUL_KM = 2500
NONSTOP_LIMIT_KM = 9000
LOW_COST_RANGE_KM = 3500
MAX_CARRIERS = 5
VARIANTS = 2  # a saver and a flexible fare per carrier
SANDBOX_INR_PER_USD = 83.5  # fixed on purpose: sandbox prices are illustrative, never quoted
DEPARTURE_HOURS = (5, 6, 7, 8, 9, 11, 13, 15, 17, 19, 21, 23)
CABIN_MULTIPLIER = {"economy": 1.0, "premium_economy": 1.7, "business": 3.4, "first": 5.5}


@dataclass(frozen=True)
class Carrier:
    code: str
    name: str
    hub: str
    low_cost: bool = False


CARRIERS: dict[str, Carrier] = {
    c.code: c
    for c in (
        Carrier("6E", "IndiGo", "DEL", low_cost=True),
        Carrier("QP", "Akasa Air", "BOM", low_cost=True),
        Carrier("AI", "Air India", "DEL"),
        Carrier("EK", "Emirates", "DXB"),
        Carrier("EY", "Etihad Airways", "AUH"),
        Carrier("QR", "Qatar Airways", "DOH"),
        Carrier("TK", "Turkish Airlines", "IST"),
        Carrier("BA", "British Airways", "LHR"),
        Carrier("LH", "Lufthansa", "FRA"),
        Carrier("AF", "Air France", "CDG"),
        Carrier("UA", "United Airlines", "EWR"),
        Carrier("SQ", "Singapore Airlines", "SIN"),
        Carrier("ZZ", "Sandbox Air", ""),
    )
}
HOME_CARRIERS: dict[str, tuple[str, ...]] = {
    "IN": ("AI", "6E", "QP"),
    "AE": ("EK", "EY"),
    "QA": ("QR",),
    "TR": ("TK",),
    "GB": ("BA",),
    "DE": ("LH",),
    "FR": ("AF",),
    "US": ("UA",),
    "SG": ("SQ",),
}
CONNECTORS = ("EK", "QR", "TK")


def _rng(*parts: object) -> random.Random:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def _encode_ref(data: dict[str, Any]) -> str:
    raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_ref(ref: str) -> dict[str, Any]:
    padded = ref + "=" * (-len(ref) % 4)
    data = json.loads(base64.urlsafe_b64decode(padded.encode()))
    if not isinstance(data, dict):
        raise ValueError("reference is not an object")
    return data


def _demand(days_out: int) -> float:
    if days_out < 7:
        return 1.6
    if days_out < 21:
        return 1.25
    if days_out < 60:
        return 1.05
    return 1.0


def _brand(carrier: Carrier, cabin: str, flexible: bool) -> str:
    if carrier.low_cost:
        return "Flexi" if flexible else "Saver"
    label = {
        "economy": "Economy",
        "premium_economy": "Premium",
        "business": "Business",
        "first": "First",
    }[cabin]
    return f"{label} {'Flex' if flexible else 'Classic'}"


class SandboxFlightSupplier:
    code = SANDBOX_CODE

    def __init__(
        self, lookup: AirportLookup, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self._lookup = lookup
        self._clock = clock

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        origin = self._require(request.origin)
        destination = self._require(request.destination)
        fetched_at = self._clock()
        offers = [
            self._build(request, carrier, via, variant, fetched_at=fetched_at)
            for carrier, via in self._itineraries(origin, destination)
            if via is None or request.max_connections >= 1
            for variant in range(VARIANTS)
        ]
        return offers

    async def price(self, supplier_ref: str) -> FlightOffer:
        try:
            data = _decode_ref(supplier_ref)
            request = FlightSearchRequest(
                origin=data["o"],
                destination=data["d"],
                departure_date=date.fromisoformat(data["dd"]),
                return_date=date.fromisoformat(data["rd"]) if data["rd"] else None,
                adults=data["a"],
                children_ages=data["ch"],
                cabin=data["cab"],
                max_connections=data["mc"],
            )
            carrier = CARRIERS[data["car"]]
            via, variant = data["via"], int(data["v"])
            if via not in (None, carrier.hub) or variant not in range(VARIANTS):
                raise ValueError("reference does not describe a sandbox itinerary")
        except (ValueError, KeyError, TypeError) as exc:
            raise SupplierError(
                "offer_unavailable", "This offer can't be found any more. Run the search again."
            ) from exc
        return self._build(request, carrier, via, variant, fetched_at=self._clock())

    def _require(self, code: str | None) -> AirportRecord:
        airport = self._lookup(code or "")
        if airport is None:
            raise SupplierError("invalid_request", f"Unknown airport code {code}.")
        return airport

    def _itineraries(
        self, origin: AirportRecord, destination: AirportRecord
    ) -> list[tuple[Carrier, str | None]]:
        km = great_circle_km(
            origin.latitude, origin.longitude, destination.latitude, destination.longitude
        )
        domestic = origin.country_code == destination.country_code
        home = HOME_CARRIERS.get(origin.country_code, ()) + HOME_CARRIERS.get(
            destination.country_code, ()
        )
        codes: list[str] = []
        for code in home:
            if code not in codes and (
                domestic or not CARRIERS[code].low_cost or km <= LOW_COST_RANGE_KM
            ):
                codes.append(code)
        if not domestic and km > LONG_HAUL_KM:
            codes += [c for c in CONNECTORS if c not in codes]
        if not codes:
            codes = ["ZZ"]
        endpoints = {origin.iata_code, destination.iata_code}
        itineraries: list[tuple[Carrier, str | None]] = []
        for code in codes[:MAX_CARRIERS]:
            carrier = CARRIERS[code]
            nonstop = (
                domestic
                or code == "ZZ"
                or carrier.hub in endpoints
                or (code in home and km <= NONSTOP_LIMIT_KM)
            )
            via = None if nonstop or self._lookup(carrier.hub) is None else carrier.hub
            itineraries.append((carrier, via))
        return itineraries

    def _slice(
        self,
        start: AirportRecord,
        end: AirportRecord,
        day: date,
        carrier: Carrier,
        via: str | None,
        rng: random.Random,
    ) -> tuple[Slice, float]:
        stops = [start, *([self._require(via)] if via else []), end]
        clock = datetime.combine(
            day, time(rng.choice(DEPARTURE_HOURS), rng.choice((0, 10, 20, 30, 40, 50)))
        )
        segments: list[Segment] = []
        distance = 0.0
        for a, b in zip(stops, stops[1:], strict=False):
            km = great_circle_km(a.latitude, a.longitude, b.latitude, b.longitude)
            distance += km
            minutes = round(km / CRUISE_KMH * 60) + GROUND_MINUTES
            arrive = clock + timedelta(minutes=minutes)
            segments.append(
                Segment(
                    origin=a.iata_code,
                    destination=b.iata_code,
                    departing_at=clock,
                    arriving_at=arrive,
                    marketing_carrier=carrier.code,
                    marketing_carrier_name=carrier.name,
                    flight_number=str(rng.randint(100, 2999)),
                    operating_carrier=carrier.code,
                    duration_minutes=minutes,
                )
            )
            clock = arrive + timedelta(minutes=rng.choice((70, 95, 120, 150)))
        duration = int((segments[-1].arriving_at - segments[0].departing_at).total_seconds() // 60)
        return Slice(
            origin=start.iata_code,
            destination=end.iata_code,
            duration_minutes=duration,
            segments=segments,
        ), distance

    def _build(
        self,
        request: FlightSearchRequest,
        carrier: Carrier,
        via: str | None,
        variant: int,
        *,
        fetched_at: datetime,
    ) -> FlightOffer:
        origin = self._require(request.origin)
        destination = self._require(request.destination)
        rng = _rng(
            "sandbox-offer",
            request.origin,
            request.destination,
            request.departure_date,
            request.return_date,
            request.cabin,
            carrier.code,
            via or "-",
            variant,
        )
        flexible = variant == 1
        brand = _brand(carrier, request.cabin, flexible)
        outbound, km = self._slice(origin, destination, request.departure_date, carrier, via, rng)
        slices = [outbound]
        if request.return_date is not None:
            inbound, km_back = self._slice(
                destination, origin, request.return_date, carrier, via, rng
            )
            slices.append(inbound)
            km += km_back
        slices = [s.model_copy(update={"fare_brand": brand}) for s in slices]

        days_out = (request.departure_date - fetched_at.date()).days
        per_adult_cents = (
            (4000 + 9 * km)
            * CABIN_MULTIPLIER[request.cabin]
            * _demand(days_out)
            * (0.85 if carrier.low_cost else 1.05)
            * (1.18 if flexible else 1.0)
            * rng.uniform(0.92, 1.1)
        )
        travellers = request.adults + sum(0.1 if age < 2 else 0.75 for age in request.children_ages)
        total_cents = per_adult_cents * travellers
        currency = "INR" if origin.country_code == "IN" else "USD"
        minor = (
            round(total_cents * SANDBOX_INR_PER_USD / 100) * 100
            if currency == "INR"
            else round(total_cents)
        )
        base_minor = round(minor / 1.18)

        def money(amount: float) -> Money:
            return Money(amount_minor=round(amount), currency=currency)

        ref = _encode_ref(
            {
                "o": request.origin,
                "d": request.destination,
                "dd": request.departure_date.isoformat(),
                "rd": request.return_date.isoformat() if request.return_date else None,
                "cab": request.cabin,
                "a": request.adults,
                "ch": request.children_ages,
                "mc": request.max_connections,
                "car": carrier.code,
                "via": via,
                "v": variant,
            }
        )
        return FlightOffer(
            id=offer_id(SANDBOX_CODE, ref),
            supplier=SANDBOX_CODE,
            supplier_ref=ref,
            provenance="SANDBOX",
            total=money(minor),
            base=money(base_minor),
            tax=money(minor - base_minor),
            owner_carrier=carrier.code,
            owner_name=carrier.name,
            cabin=request.cabin,
            passenger_count=request.passenger_count,
            slices=slices,
            baggage=Baggage(
                checked=0
                if carrier.low_cost and not flexible
                else (2 if request.cabin in ("business", "first") else 1),
                carry_on=1,
            ),
            conditions=FareConditions(
                refundable=flexible,
                refund_penalty=money(minor * 0.1) if flexible else None,
                changeable=True,
                change_penalty=None if flexible else money(minor * 0.05),
            ),
            fetched_at=fetched_at,
            expires_at=fetched_at + OFFER_TTL,
        )
