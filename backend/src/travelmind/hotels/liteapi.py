"""LiteAPI v3 hotel rates. Reference: docs/research/2026-09-29-supplier-apis.md."""

import math
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from travelmind.hotels.models import HotelOffer, HotelSearchRequest
from travelmind.offers.models import Provenance
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError, offer_id

LITEAPI_BASE_URL = "https://api.liteapi.travel/v3.0"
NO_AVAILABILITY = 2001
# Failures from reading one malformed hotel (pydantic's ValidationError is a ValueError).
_MAPPING_ERRORS = (KeyError, TypeError, ValueError, ArithmeticError, AttributeError)
_REFUNDABLE = {"RFN": True, "NRFN": False}
log = structlog.get_logger()


def _price(room_type: object) -> Money | None:
    """A room type's offer total (all rooms, whole stay), or None if it isn't a usable price."""
    if not isinstance(room_type, dict):
        return None
    rate = room_type.get("offerRetailRate")
    if not isinstance(rate, dict):
        return None
    amount, currency = rate.get("amount"), rate.get("currency")
    if isinstance(amount, bool) or not isinstance(amount, int | float | str):
        return None
    if not isinstance(currency, str):
        return None
    try:
        money = Money.from_decimal(amount, currency)
    except (ArithmeticError, ValueError):
        return None
    return money if money.amount_minor > 0 else None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _text(value: object) -> str | None:
    return (value.strip() or None) if isinstance(value, str) else None


def _photo(value: object) -> str | None:
    """Only plain web links: the UI renders this, so never pass on e.g. javascript: URLs."""
    text = _text(value)
    return text if text and text.lower().startswith(("https://", "http://")) else None


def _free_cancellation_until(infos: object) -> str | None:
    """The earliest time a cancellation penalty applies, e.g. "2026-11-18 12:00:00 GMT"."""
    if not isinstance(infos, list):
        return None
    timed = [i for i in infos if isinstance(i, dict) and isinstance(i.get("cancelTime"), str)]
    if not timed:
        return None
    first = min(timed, key=lambda i: i["cancelTime"])
    zone = first.get("timezone") if isinstance(first.get("timezone"), str) else ""
    return f"{first['cancelTime']} {zone}".strip()


class LiteApiHotelSupplier:
    code = "liteapi"

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = LITEAPI_BASE_URL,
        http_timeout_s: float = 15.0,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._key = api_key
        self._base_url = base_url
        self._timeout = http_timeout_s
        self._clock = clock

    async def search(
        self,
        request: HotelSearchRequest,
        *,
        latitude: float,
        longitude: float,
        currency: str,
        guest_nationality: str = "IN",
    ) -> list[HotelOffer]:
        body = {
            "latitude": latitude,
            "longitude": longitude,
            "radius": request.radius_km * 1000,
            "checkin": request.checkin.isoformat(),
            "checkout": request.checkout.isoformat(),
            "occupancies": [
                {"adults": r.adults, "children": r.children_ages} for r in request.rooms
            ],
            "currency": currency,
            "guestNationality": guest_nationality,
            "timeout": 8,
            "maxRatesPerHotel": 1,
            "limit": 40,
            "includeHotelData": True,
        }
        payload = await self._post("/hotels/rates", body)
        error = payload.get("error")
        if error:
            code = error.get("code") if isinstance(error, dict) else None
            if code == NO_AVAILABILITY:
                return []
            log.warning("liteapi_error", code=code if isinstance(code, int | str) else None)
            raise SupplierError(
                "unavailable", "LiteAPI had a problem answering. Try again shortly."
            )
        raw_hotels = payload.get("data")
        if not isinstance(raw_hotels, list):
            log.warning("liteapi_unusable_response", data_type=type(raw_hotels).__name__)
            raise SupplierError("unavailable", "LiteAPI sent an unusable response.")
        # Sandbox keys never return bookable rooms, whatever the payload says.
        sandbox = bool(payload.get("sandbox")) or self._key.startswith("sand_")
        provenance: Provenance = "SANDBOX" if sandbox else "LIVE"
        details = payload.get("hotels")
        hotels = {
            h.get("id"): h
            for h in (details if isinstance(details, list) else [])
            if isinstance(h, dict)
        }
        fetched_at = self._clock()
        offers: list[HotelOffer] = []
        for item in raw_hotels:
            try:
                offers.append(self._map_hotel(item, hotels, provenance, request.nights, fetched_at))
            except _MAPPING_ERRORS as exc:
                ref = item.get("hotelId") if isinstance(item, dict) else None
                log.warning(
                    "liteapi_hotel_skipped",
                    hotel_id=ref if isinstance(ref, str) else None,
                    error=type(exc).__name__,
                )
        if raw_hotels and not offers:
            raise SupplierError(
                "unavailable", "LiteAPI sent hotels we couldn't read. Try again shortly."
            )
        offers.sort(key=lambda o: (o.total.currency, o.total.amount_minor))
        return offers

    def _map_hotel(
        self,
        item: Any,
        hotels: dict[Any, dict[str, Any]],
        provenance: Provenance,
        nights: int,
        fetched_at: datetime,
    ) -> HotelOffer:
        hotel_id = item["hotelId"]
        if not isinstance(hotel_id, str) or not hotel_id:
            raise TypeError("hotelId is not a string")
        room_types = item.get("roomTypes")
        if not isinstance(room_types, list):
            raise TypeError("roomTypes is not a list")
        priced = [(money, rt) for rt in room_types if (money := _price(rt)) is not None]
        if not priced:
            raise ValueError("no readable room price")
        total, best = min(priced, key=lambda pair: pair[0].amount_minor)
        rates = best.get("rates")
        rate = rates[0] if isinstance(rates, list) and rates and isinstance(rates[0], dict) else {}
        policy = rate.get("cancellationPolicies")
        policy = policy if isinstance(policy, dict) else {}
        tag = policy.get("refundableTag")
        refundable = _REFUNDABLE.get(tag) if isinstance(tag, str) else None
        deadline = _free_cancellation_until(policy.get("cancelPolicyInfos")) if refundable else None
        hotel = hotels.get(hotel_id, {})
        ref = best.get("offerId")
        return HotelOffer(
            id=offer_id(self.code, ref if isinstance(ref, str) and ref else hotel_id),
            supplier=self.code,
            provenance=provenance,
            hotel_id=hotel_id,
            name=_text(hotel.get("name")) or "Unnamed hotel",
            stars=_number(hotel.get("stars")),
            rating=_number(hotel.get("rating")),
            address=_text(hotel.get("address")),
            photo_url=_photo(hotel.get("main_photo")),
            room_name=_text(rate.get("name")),
            board=_text(rate.get("boardName")),
            total=total,
            refundable=refundable,
            free_cancellation_until=deadline,
            nights=nights,
            fetched_at=fetched_at,
        )

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "X-API-Key": self._key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout) as client:
                response = await client.post(path, json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise SupplierError("timeout", "LiteAPI didn't answer in time.") from exc
        except httpx.HTTPError as exc:
            log.warning("liteapi_unreachable", error=type(exc).__name__)
            raise SupplierError("unavailable", "Couldn't reach LiteAPI.") from exc
        if response.status_code >= 400:
            log.warning("liteapi_error", status=response.status_code)
        if response.status_code in (401, 403):
            raise SupplierError("auth", "LiteAPI rejected the key. Check TM_LITEAPI_KEY.")
        if response.status_code == 429:
            raise SupplierError(
                "rate_limited", "LiteAPI's rate limit was reached. Try again in a moment."
            )
        if response.status_code >= 400:
            raise SupplierError(
                "unavailable", "LiteAPI had a problem answering. Try again shortly."
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise SupplierError("unavailable", "LiteAPI sent an unreadable response.") from exc
        if not isinstance(payload, dict):
            raise SupplierError("unavailable", "LiteAPI sent an unusable response.")
        return payload
