"""ECB euro reference rates, used only to show approximate converted prices ("≈ ₹").

Never used to price a booking. Any failure (feed down, malformed feed, Redis down, corrupt cache)
means "no rates" (`None`) or a fresh fetch — a rate is never guessed.
"""

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from xml.etree.ElementTree import ParseError

import httpx
import structlog
from defusedxml import ElementTree
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.offers.money import Money

ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
CACHE_KEY = "fx:ecb:daily"
CACHE_TTL_SECONDS = 12 * 3600
FAILURE_KEY = "fx:ecb:down"  # set after a failed fetch so we back off instead of retrying
FAILURE_TTL_SECONDS = 300
FETCH_TIMEOUT = httpx.Timeout(2.0, connect=1.0)
_MAX_RATE = Decimal("1e9")  # no real currency is near this; bounds later multiplication
_NS = "{http://www.ecb.int/vocabulary/2002-08-01/eurofxref}"
_CODE = re.compile(r"[A-Z]{3}")
log = structlog.get_logger()


@dataclass(frozen=True)
class FxRates:
    as_of: date
    rates: dict[str, Decimal]  # units of currency per 1 EUR; always includes EUR = 1

    def convert(self, money: Money, to_currency: str) -> Money | None:
        """Exact Decimal conversion via EUR, rounded half-up to the target's minor unit.

        Returns `money` unchanged for the same currency and `None` when either rate is unknown.
        """
        target = to_currency.strip().upper()
        if money.currency == target:
            return money
        source_rate, target_rate = self.rates.get(money.currency), self.rates.get(target)
        if source_rate is None or target_rate is None:
            return None
        return Money.from_decimal(money.to_decimal() * target_rate / source_rate, target)


def _validated(as_of: object, pairs: Iterable[tuple[object, object]]) -> FxRates:
    """Build FxRates, raising ValueError unless every code and rate is usable."""
    if not isinstance(as_of, str):
        raise ValueError("Missing rates date")
    rates = {"EUR": Decimal(1)}
    for currency, raw_rate in pairs:
        if not isinstance(currency, str) or not _CODE.fullmatch(currency):
            raise ValueError(f"Invalid currency code {currency!r}")
        if not isinstance(raw_rate, str):
            raise ValueError(f"Invalid rate for {currency}")
        try:
            rate = Decimal(raw_rate)
        except InvalidOperation as exc:
            raise ValueError(f"Invalid rate for {currency}: {raw_rate!r}") from exc
        if not rate.is_finite() or rate <= 0 or rate > _MAX_RATE:
            raise ValueError(f"Invalid rate for {currency}: {raw_rate!r}")
        if currency != "EUR":
            rates[currency] = rate
    if len(rates) == 1:
        raise ValueError("No rates in ECB response")
    return FxRates(as_of=date.fromisoformat(as_of), rates=rates)


def parse_ecb_xml(xml: str) -> FxRates:
    """Parse the ECB daily feed safely (no DTDs/entities). Raises ValueError if unusable."""
    try:
        root = ElementTree.fromstring(xml, forbid_dtd=True)
    except ParseError as exc:
        raise ValueError(f"Malformed ECB XML: {exc}") from exc
    day = next((c for c in root.iter(f"{_NS}Cube") if c.get("time")), None)
    if day is None:
        raise ValueError("No dated Cube in ECB response")
    pairs = [
        (cube.get("currency"), cube.get("rate"))
        for cube in day.iter(f"{_NS}Cube")
        if cube.get("currency") is not None or cube.get("rate") is not None
    ]
    return _validated(day.get("time"), pairs)


def display_currency_for(country_code: str) -> str:
    return "INR" if country_code.strip().upper() == "IN" else "USD"


def _dump(rates: FxRates) -> str:
    return json.dumps(
        {"as_of": rates.as_of.isoformat(), "rates": {k: str(v) for k, v in rates.rates.items()}}
    )


def _load(raw: bytes | str) -> FxRates:
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("rates"), dict):
        raise ValueError("Malformed cached FX rates")
    return _validated(data.get("as_of"), data["rates"].items())


async def get_fx_rates(
    redis: Redis, *, enabled: bool = True, url: str = ECB_DAILY_URL
) -> FxRates | None:
    """Today's ECB rates, cached in Redis for 12 h. `None` when disabled or unavailable.

    After a failed fetch, a marker makes callers skip the feed for FAILURE_TTL_SECONDS.
    """
    if not enabled:
        return None
    try:
        cached = await redis.get(CACHE_KEY)
        if cached:
            return _load(cached)
    except (RedisError, ValueError) as exc:
        log.warning("fx_cache_unavailable", error_type=type(exc).__name__)
    try:
        if await redis.exists(FAILURE_KEY):
            return None
    except RedisError as exc:
        log.warning("fx_cache_unavailable", error_type=type(exc).__name__)
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
            response = await client.get(url)
        response.raise_for_status()
        rates = parse_ecb_xml(response.text)
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("fx_rates_unavailable", error_type=type(exc).__name__)
        try:
            await redis.set(FAILURE_KEY, "1", ex=FAILURE_TTL_SECONDS)
        except RedisError as marker_exc:
            log.warning("fx_cache_unavailable", error_type=type(marker_exc).__name__)
        return None
    try:
        await redis.set(CACHE_KEY, _dump(rates), ex=CACHE_TTL_SECONDS)
    except RedisError as exc:
        log.warning("fx_cache_unavailable", error_type=type(exc).__name__)
    return rates
