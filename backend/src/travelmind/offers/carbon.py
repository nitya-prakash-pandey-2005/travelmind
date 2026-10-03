"""Per-passenger CO₂ from Google's Travel Impact Model (data: CC BY-SA 4.0 — attribute in the UI).

Enrichment is best-effort: any HTTP, Redis or parse failure, or running past `timeout_s`, leaves
the offers as they were. The API key travels in the `X-Goog-Api-Key` header, never the URL, and
HTTP errors are still logged by type and status only — never with the exception text.
"""

import asyncio
import json
import re
from typing import Any

import httpx
import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.http import get_http_client
from travelmind.offers.models import FlightOffer, Segment

TIM_BASE_URL = "https://travelimpactmodel.googleapis.com/v1"
CABIN_FIELD = {
    "economy": "economy",
    "premium_economy": "premiumEconomy",
    "business": "business",
    "first": "first",
}
FLIGHT_TTL_SECONDS = 24 * 3600
MARKET_TTL_SECONDS = 7 * 24 * 3600
BATCH = 1000
_NO_DATA = "none"
_FLIGHT_NUMBER = re.compile(r"[0-9]{1,4}")
_MAX_GRAMS = 10**9  # a tonne per passenger is already far beyond any real flight
log = structlog.get_logger()

Grams = dict[str, int]


class _Malformed(ValueError):
    """A TIM response or cache entry we can't trust."""


def _flight_ident(segment: Segment) -> tuple[str, int] | None:
    """The operating carrier and flight number TIM knows the flight by, if we can tell."""
    carrier = segment.operating_carrier or segment.marketing_carrier
    if segment.operating_carrier and segment.operating_flight_number:
        number = segment.operating_flight_number
    elif segment.operating_carrier in (None, "", segment.marketing_carrier):
        number = segment.flight_number
    else:
        return None  # another airline operates it under a number we don't have
    if not carrier or not _FLIGHT_NUMBER.fullmatch(number) or int(number) == 0:
        return None
    return carrier, int(number)


def _flight_key(segment: Segment) -> str | None:
    ident = _flight_ident(segment)
    if ident is None:
        return None
    carrier, number = ident
    return (
        f"{carrier}{number}:{segment.origin}{segment.destination}:"
        f"{segment.departing_at.date().isoformat()}"
    )


def _market_key(segment: Segment) -> str:
    return f"{segment.origin}{segment.destination}"


def _grams(value: object) -> Grams | None:
    """`emissionsGramsPerPax` → grams per cabin; `None` means "no data". Raises _Malformed."""
    if value is None or value == {}:
        return None
    if not isinstance(value, dict):
        raise _Malformed("emissionsGramsPerPax is not an object")
    grams: Grams = {}
    for cabin, amount in value.items():
        if (
            not isinstance(cabin, str)
            or not isinstance(amount, int)
            or isinstance(amount, bool)
            or not 0 <= amount <= _MAX_GRAMS
        ):
            raise _Malformed("unusable emissionsGramsPerPax value")
        grams[cabin] = amount
    return grams


def _kg(amounts: list[int | None]) -> int | None:
    """Total kg when every leg has a positive figure, else `None`."""
    if not amounts or not all(amounts):
        return None
    return round(sum(a for a in amounts if a) / 1000)


class TimClient:
    def __init__(
        self, api_key: str, redis: Redis, *, base_url: str = TIM_BASE_URL, timeout_s: float = 8.0
    ) -> None:
        self._api_key = api_key
        self._redis = redis
        self._base_url = base_url
        self._timeout_s = timeout_s

    async def enrich(self, offers: list[FlightOffer], cabin: str) -> list[FlightOffer]:
        """Offers with TIM CO₂ figures filled in. Never raises; takes at most ~`timeout_s`."""
        try:
            async with asyncio.timeout(self._timeout_s):
                return await self._enrich(offers, cabin)
        except TimeoutError:
            log.warning("tim_timeout", timeout_s=self._timeout_s)
        except Exception as exc:  # enrichment is optional: never fail a search over it
            log.warning("tim_enrich_failed", error_type=type(exc).__name__)
        return offers

    async def _enrich(self, offers: list[FlightOffer], cabin: str) -> list[FlightOffer]:
        field = CABIN_FIELD.get(cabin, "economy")
        candidates = {
            id(o) for o in offers if o.co2_kg_per_passenger is None or o.co2_source == "supplier"
        }
        if not candidates:
            return offers
        legs_of = {
            id(o): [s for sl in o.slices for s in sl.segments]
            for o in offers
            if id(o) in candidates
        }
        segments = {id(s): s for legs in legs_of.values() for s in legs}
        flights = await self._flight_emissions([s for s in segments.values() if _flight_key(s)])
        per_flight_kg = {
            oid: _kg([(flights.get(_flight_key(s) or "") or {}).get(field) for s in legs])
            for oid, legs in legs_of.items()
        }
        # Typical data only fills offers without a figure, and then covers every leg of the offer.
        needs_typical = [
            s
            for o in offers
            if id(o) in candidates and o.co2_source != "supplier" and per_flight_kg[id(o)] is None
            for s in legs_of[id(o)]
        ]
        markets = await self._typical_emissions(needs_typical) if needs_typical else {}

        enriched: list[FlightOffer] = []
        for offer in offers:
            if id(offer) not in candidates:
                enriched.append(offer)
                continue
            legs = legs_of[id(offer)]
            per_flight = per_flight_kg[id(offer)]
            if per_flight is not None:
                update = {"co2_kg_per_passenger": per_flight, "co2_source": "google_tim"}
                enriched.append(offer.model_copy(update=update))
                continue
            if offer.co2_source == "supplier":  # only per-flight data replaces a supplier figure
                enriched.append(offer)
                continue
            typical = _kg([(markets.get(_market_key(s)) or {}).get(field) for s in legs])
            if typical is not None:
                update = {"co2_kg_per_passenger": typical, "co2_source": "google_tim_typical"}
                enriched.append(offer.model_copy(update=update))
            else:
                enriched.append(offer)
        return enriched

    async def _cached(self, keys: list[str], prefix: str) -> dict[str, Grams | None]:
        """Cached results by key; a corrupt entry counts as missing so it is fetched again."""
        found: dict[str, Grams | None] = {}
        if not keys:
            return found
        try:
            values = await self._redis.mget([f"{prefix}{k}" for k in keys])
        except RedisError as exc:
            log.warning("tim_cache_unavailable", error_type=type(exc).__name__)
            return found
        for key, raw in zip(keys, values, strict=True):
            if raw is None:
                continue
            try:
                text = raw.decode() if isinstance(raw, bytes) else str(raw)
                found[key] = None if text == _NO_DATA else _grams(json.loads(text))
            except ValueError:  # includes _Malformed, JSONDecodeError and UnicodeDecodeError
                log.warning("tim_cache_corrupt", key=f"{prefix}{key}")
        return found

    async def _store(self, items: dict[str, Grams | None], prefix: str, ttl: int) -> None:
        if not items:
            return
        try:
            async with self._redis.pipeline(transaction=False) as pipe:
                for key, value in items.items():
                    pipe.set(
                        f"{prefix}{key}", _NO_DATA if value is None else json.dumps(value), ex=ttl
                    )
                await pipe.execute()
        except RedisError as exc:
            log.warning("tim_cache_unavailable", error_type=type(exc).__name__)

    async def _post(self, method: str, body: dict[str, Any]) -> dict[str, Any] | None:
        try:
            client = get_http_client("tim", timeout=httpx.Timeout(self._timeout_s))
            response = await client.post(
                f"{self._base_url}/flights:{method}",
                headers={"X-Goog-Api-Key": self._api_key},
                json=body,
                timeout=self._timeout_s,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            # Logged by status only: exception text carries request details we don't want in logs.
            log.warning("tim_unavailable", method=method, status=exc.response.status_code)
            return None
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("tim_unavailable", method=method, error_type=type(exc).__name__)
            return None
        if not isinstance(payload, dict):
            log.warning("tim_unavailable", method=method, error_type="unexpected response")
            return None
        return payload

    async def _flight_emissions(self, segments: list[Segment]) -> dict[str, Grams | None]:
        unique = {k: s for s in segments if (k := _flight_key(s))}
        results = await self._cached(list(unique), "tim:f:")
        missing = [k for k in unique if k not in results]
        for start in range(0, len(missing), BATCH):
            chunk = missing[start : start + BATCH]
            flights = []
            for key in chunk:
                seg = unique[key]
                ident = _flight_ident(seg)
                if ident is None:  # unreachable: keys only exist for identifiable flights
                    continue
                carrier, number = ident
                day = seg.departing_at.date()
                flights.append(
                    {
                        "origin": seg.origin,
                        "destination": seg.destination,
                        "operatingCarrierCode": carrier,
                        "flightNumber": number,
                        "departureDate": {"year": day.year, "month": day.month, "day": day.day},
                    }
                )
            payload = await self._post("computeFlightEmissions", {"flights": flights})
            if payload is None:
                continue
            try:
                fresh = self._parse_flights(chunk, payload)
            except _Malformed as exc:
                log.warning("tim_unavailable", method="computeFlightEmissions", error=str(exc))
                continue
            results |= fresh
            await self._store(fresh, "tim:f:", FLIGHT_TTL_SECONDS)
        return results

    @staticmethod
    def _parse_flights(chunk: list[str], payload: dict[str, Any]) -> dict[str, Grams | None]:
        items = payload.get("flightEmissions")
        # Results come back in request order, so a count mismatch makes every pairing a guess.
        if not isinstance(items, list) or len(items) != len(chunk):
            raise _Malformed("flightEmissions doesn't match the flights sent")
        fresh: dict[str, Grams | None] = {}
        for key, item in zip(chunk, items, strict=True):
            if not isinstance(item, dict):
                raise _Malformed("flightEmissions entry is not an object")
            fresh[key] = _grams(item.get("emissionsGramsPerPax"))
        return fresh

    async def _typical_emissions(self, segments: list[Segment]) -> dict[str, Grams | None]:
        unique = {_market_key(s): s for s in segments}
        results = await self._cached(list(unique), "tim:m:")
        missing = [k for k in unique if k not in results]
        for start in range(0, len(missing), BATCH):
            chunk = missing[start : start + BATCH]
            markets = [
                {"origin": unique[k].origin, "destination": unique[k].destination} for k in chunk
            ]
            payload = await self._post("computeTypicalFlightEmissions", {"markets": markets})
            if payload is None:
                continue
            try:
                fresh = self._parse_markets(chunk, payload)
            except _Malformed as exc:
                log.warning(
                    "tim_unavailable", method="computeTypicalFlightEmissions", error=str(exc)
                )
                continue
            results |= fresh
            await self._store(fresh, "tim:m:", MARKET_TTL_SECONDS)
        return results

    @staticmethod
    def _parse_markets(chunk: list[str], payload: dict[str, Any]) -> dict[str, Grams | None]:
        items = payload.get("typicalFlightEmissions", [])
        if not isinstance(items, list):
            raise _Malformed("typicalFlightEmissions is not a list")
        fresh: dict[str, Grams | None] = dict.fromkeys(chunk)  # unmentioned markets: no data
        for item in items:
            market = item.get("market") if isinstance(item, dict) else None
            if not isinstance(market, dict):
                raise _Malformed("typicalFlightEmissions entry has no market")
            key = f"{market.get('origin')}{market.get('destination')}"
            if key in fresh:
                fresh[key] = _grams(item.get("emissionsGramsPerPax"))
        return fresh
