"""Duffel Flights API v2 adapter. Reference: docs/research/2026-09-29-supplier-apis.md."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, cast, get_args

import httpx
import structlog

from travelmind.offers.models import (
    Baggage,
    Cabin,
    FareConditions,
    FlightOffer,
    FlightSearchRequest,
    Provenance,
    Segment,
    Slice,
)
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError, offer_id

DUFFEL_BASE_URL = "https://api.duffel.com"
DUFFEL_VERSION = "v2"
MAX_OFFERS = 60
_CABINS: frozenset[str] = frozenset(get_args(Cabin))
_OFFER_REF = re.compile(r"off_[A-Za-z0-9]+")
_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$")
# Failures from reading one malformed offer (pydantic's ValidationError is a ValueError,
# InvalidOperation an ArithmeticError; AttributeError covers a nested field of the wrong type).
_MAPPING_ERRORS = (KeyError, TypeError, ValueError, ArithmeticError, AttributeError)
log = structlog.get_logger()


def parse_iso_duration(value: str | None) -> int | None:
    """ISO 8601 duration ("PT02H26M", "P1DT1H5M") → whole minutes."""
    if not value:
        return None
    match = _DURATION.match(value)
    if not match or not any(match.groups()):
        return None  # no match, or a bare "P"/"PT" with no component
    days, hours, minutes = (int(g) if g else 0 for g in match.groups()[:3])
    return days * 1440 + hours * 60 + minutes


def _money(amount: str | None, currency: str | None) -> Money | None:
    if amount is None or currency is None:
        return None
    try:
        return Money.from_decimal(amount, currency)
    except (InvalidOperation, ValueError):
        return None


def _cabin(value: object) -> Cabin | None:
    """Duffel's cabin_class, or None for anything outside our Cabin values."""
    return cast(Cabin, value) if isinstance(value, str) and value in _CABINS else None


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


class DuffelFlightSupplier:
    code = "duffel"

    def __init__(
        self,
        token: str,
        *,
        supplier_timeout_ms: int = 12000,
        http_timeout_s: float = 30.0,
        base_url: str = DUFFEL_BASE_URL,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._token = token
        self._supplier_timeout_ms = supplier_timeout_ms
        self._http_timeout_s = http_timeout_s
        self._base_url = base_url
        self._clock = clock

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        slices = [
            {
                "origin": request.origin,
                "destination": request.destination,
                "departure_date": request.departure_date.isoformat(),
            }
        ]
        if request.return_date is not None:
            slices.append(
                {
                    "origin": request.destination,
                    "destination": request.origin,
                    "departure_date": request.return_date.isoformat(),
                }
            )
        passengers: list[dict[str, Any]] = [{"type": "adult"} for _ in range(request.adults)]
        passengers += [{"age": age} for age in request.children_ages]
        body = {
            "data": {
                "slices": slices,
                "passengers": passengers,
                "cabin_class": request.cabin,
                "max_connections": request.max_connections,
            }
        }
        params = {"return_offers": "true", "supplier_timeout": str(self._supplier_timeout_ms)}
        payload = await self._request("POST", "/air/offer_requests", params=params, json=body)
        data = payload.get("data") or {}
        live = bool(data.get("live_mode"))
        fetched_at = self._clock()
        raw_offers = data.get("offers") or []
        offers: list[FlightOffer] = []
        for raw in raw_offers:
            try:
                offers.append(self._map_offer(raw, live, fetched_at))
            except _MAPPING_ERRORS as exc:
                ref = raw.get("id") if isinstance(raw, dict) else None
                log.warning("duffel_offer_skipped", offer_id=ref, error=type(exc).__name__)
        if raw_offers and not offers:
            raise SupplierError(
                "unavailable", "Duffel sent offers we couldn't read. Try again shortly."
            )
        offers.sort(key=lambda o: (o.total.currency, o.total.amount_minor))
        return offers[:MAX_OFFERS]

    async def price(self, supplier_ref: str) -> FlightOffer:
        # The ref comes from a client-supplied offer id; never let it steer the request path.
        if not _OFFER_REF.fullmatch(supplier_ref):
            raise SupplierError(
                "offer_unavailable", "This offer is no longer available. Search again."
            )
        payload = await self._request(
            "GET", f"/air/offers/{supplier_ref}", params={"return_available_services": "false"}
        )
        raw = payload.get("data")
        try:
            if not isinstance(raw, dict):
                raise TypeError("offer payload is not an object")
            return self._map_offer(raw, bool(raw.get("live_mode")), self._clock())
        except _MAPPING_ERRORS as exc:
            log.warning("duffel_offer_unusable", error=type(exc).__name__)
            raise SupplierError("unavailable", "Duffel sent an unusable offer.") from exc

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Duffel-Version": DUFFEL_VERSION,
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "Content-Type": "application/json",
        }

    async def _request(
        self, method: str, path: str, *, params: dict[str, str], json: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url, timeout=self._http_timeout_s
            ) as client:
                response = await client.request(
                    method, path, params=params, json=json, headers=self._headers()
                )
        except httpx.TimeoutException as exc:
            raise SupplierError("timeout", "Duffel didn't answer in time.") from exc
        except httpx.HTTPError as exc:
            raise SupplierError("unavailable", "Couldn't reach Duffel.") from exc
        if response.status_code >= 400:
            raise self._error(response)
        try:
            body = response.json()
        except ValueError as exc:
            raise SupplierError("unavailable", "Duffel sent an unreadable response.") from exc
        return body if isinstance(body, dict) else {}

    @staticmethod
    def _error(response: httpx.Response) -> SupplierError:
        detail: dict[str, Any] = {}
        try:
            errors = response.json().get("errors") or []
            detail = errors[0] if errors and isinstance(errors[0], dict) else {}
        except (ValueError, AttributeError):
            detail = {}
        kind, code = detail.get("type"), detail.get("code")
        log.warning("duffel_error", status=response.status_code, type=kind, code=code)
        if response.status_code in (401, 403) or kind == "authentication_error":
            return SupplierError("auth", "Duffel rejected the access token. Check TM_DUFFEL_TOKEN.")
        if response.status_code == 429 or kind == "rate_limit_error":
            return SupplierError(
                "rate_limited", "Duffel's rate limit was reached. Try again in a minute."
            )
        if code == "offer_expired" or kind == "invalid_state_error":
            return SupplierError(
                "offer_expired", "This offer has expired. Search again for a fresh price."
            )
        if code in ("offer_no_longer_available", "not_found") or response.status_code == 404:
            return SupplierError(
                "offer_unavailable", "This offer is no longer available. Search again."
            )
        if kind == "validation_error":
            message = detail.get("message") or "Duffel couldn't process this search."
            return SupplierError(
                "invalid_request", f"Duffel couldn't process this search: {message}"
            )
        return SupplierError("unavailable", "Duffel had a problem answering. Try again shortly.")

    def _map_offer(self, raw: dict[str, Any], live: bool, fetched_at: datetime) -> FlightOffer:
        currency = raw["total_currency"]
        total = Money.from_decimal(raw["total_amount"], currency)
        passengers = raw.get("passengers") or []
        passenger_count = max(len(passengers), 1)
        slices = [self._map_slice(s) for s in raw.get("slices") or []]
        owner = raw.get("owner") or {}
        # Deliberate simplification: cabin and baggage come from segment 1's first passenger.
        raw_slices = raw.get("slices") or [{}]
        first_segment = (raw_slices[0].get("segments") or [{}])[0]
        segment_passenger = (first_segment.get("passengers") or [{}])[0]
        baggage = Baggage()
        if segment_passenger.get("baggages") is not None:
            counts = {"checked": 0, "carry_on": 0}
            for bag in segment_passenger["baggages"]:
                if bag.get("type") in counts:
                    counts[bag["type"]] += int(bag.get("quantity") or 0)
            baggage = Baggage(checked=counts["checked"], carry_on=counts["carry_on"])
        conditions = raw.get("conditions") or {}
        refund = conditions.get("refund_before_departure")
        change = conditions.get("change_before_departure")
        co2: int | None = None
        if raw.get("total_emissions_kg") is not None:
            try:
                # Duffel reports the whole offer; we store a per-passenger figure.
                co2 = round(Decimal(raw["total_emissions_kg"]) / passenger_count)
            except (ArithmeticError, ValueError):  # InvalidOperation, or overflow on Infinity
                co2 = None
        expires = raw.get("expires_at")
        provenance: Provenance = "LIVE" if live else "SANDBOX"
        return FlightOffer(
            id=offer_id(self.code, raw["id"]),
            supplier=self.code,
            supplier_ref=raw["id"],
            provenance=provenance,
            total=total,
            base=_money(raw.get("base_amount"), raw.get("base_currency")),
            tax=_money(raw.get("tax_amount"), raw.get("tax_currency")),
            owner_carrier=owner.get("iata_code") or "??",
            owner_name=owner.get("name"),
            cabin=_cabin(segment_passenger.get("cabin_class")),
            passenger_count=passenger_count,
            slices=slices,
            baggage=baggage,
            conditions=FareConditions(
                refundable=refund.get("allowed") if refund else None,
                refund_penalty=_money(refund.get("penalty_amount"), refund.get("penalty_currency"))
                if refund
                else None,
                changeable=change.get("allowed") if change else None,
                change_penalty=_money(change.get("penalty_amount"), change.get("penalty_currency"))
                if change
                else None,
            ),
            co2_kg_per_passenger=co2,
            co2_source="supplier" if co2 is not None else None,
            fetched_at=fetched_at,
            expires_at=datetime.fromisoformat(expires) if expires else None,
        )

    @staticmethod
    def _map_slice(raw: dict[str, Any]) -> Slice:
        segments = []
        for seg in raw.get("segments") or []:
            marketing = seg.get("marketing_carrier") or {}
            operating = seg.get("operating_carrier") or {}
            segments.append(
                Segment(
                    origin=seg["origin"]["iata_code"],
                    destination=seg["destination"]["iata_code"],
                    departing_at=_parse_time(seg["departing_at"]),
                    arriving_at=_parse_time(seg["arriving_at"]),
                    marketing_carrier=marketing.get("iata_code") or "??",
                    marketing_carrier_name=marketing.get("name"),
                    flight_number=seg.get("marketing_carrier_flight_number") or "",
                    operating_carrier=operating.get("iata_code"),
                    operating_flight_number=seg.get("operating_carrier_flight_number"),
                    duration_minutes=parse_iso_duration(seg.get("duration")),
                )
            )
        return Slice(
            origin=raw["origin"]["iata_code"],
            destination=raw["destination"]["iata_code"],
            duration_minutes=parse_iso_duration(raw.get("duration")),
            fare_brand=raw.get("fare_brand_name"),
            segments=segments,
        )
