import asyncio
import os
import time
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError

from travelmind.offers import fx
from travelmind.offers.fx import (
    CACHE_KEY,
    ECB_DAILY_URL,
    FAILURE_KEY,
    FAILURE_TTL_SECONDS,
    display_currency_for,
    get_fx_rates,
    parse_ecb_xml,
)
from travelmind.offers.money import Money

# Tests use respx's `respx_mock` pytest fixture with full URLs; they never reach the real ECB.
XML = (Path(__file__).parent / "fixtures" / "ecb_daily.xml").read_text(encoding="utf-8")


def test_parse_ecb_xml():
    rates = parse_ecb_xml(XML)
    assert rates.as_of == date(2026, 9, 28)
    assert rates.rates["EUR"] == Decimal(1)
    assert rates.rates["INR"] == Decimal("90.4000")


def test_convert_between_currencies():
    rates = parse_ecb_xml(XML)
    # 45.00 GBP → EUR 53.2544… → INR 4814.20
    assert rates.convert(Money(amount_minor=4500, currency="GBP"), "INR") == Money(
        amount_minor=481420, currency="INR"
    )
    assert rates.convert(Money(amount_minor=100, currency="INR"), "INR") == Money(
        amount_minor=100, currency="INR"
    )
    assert rates.convert(Money(amount_minor=100, currency="XYZ"), "INR") is None
    assert rates.convert(Money(amount_minor=100, currency="USD"), "JPY") == Money(
        amount_minor=148, currency="JPY"
    )


def test_convert_to_unknown_currency_and_lowercase_target():
    rates = parse_ecb_xml(XML)
    assert rates.convert(Money(amount_minor=100, currency="USD"), "XYZ") is None
    assert rates.convert(Money(amount_minor=100, currency="EUR"), "inr") == Money(
        amount_minor=9040, currency="INR"
    )


def test_display_currency():
    assert display_currency_for("IN") == "INR"
    assert display_currency_for("in") == "INR"
    assert display_currency_for("GB") == "USD"


@pytest.mark.parametrize(
    "xml",
    [
        "<html>maintenance</html>",
        # A dated Cube with no rates must not become "EUR only" rates.
        XML.replace('<Cube currency="USD" rate="1.0850"/>', "")
        .replace('<Cube currency="JPY" rate="160.12"/>', "")
        .replace('<Cube currency="GBP" rate="0.84500"/>', "")
        .replace('<Cube currency="INR" rate="90.4000"/>', ""),
        XML.replace('rate="90.4000"', 'rate="NaN"'),
        XML.replace('rate="90.4000"', 'rate="Infinity"'),
        XML.replace('rate="90.4000"', 'rate="0"'),
        XML.replace('rate="90.4000"', 'rate="-90.4"'),
        XML.replace('rate="90.4000"', 'rate="abc"'),
        XML.replace('currency="INR"', 'currency="rupees"'),
        XML.replace('time="2026-09-28"', 'time="yesterday"'),
        XML.replace('rate="90.4000"', 'rate="1E+999999"'),
        XML.replace('rate="90.4000"', 'rate="1000000001"'),
    ],
    ids=[
        "garbage",
        "no-rates",
        "nan",
        "infinity",
        "zero",
        "negative",
        "not-a-number",
        "bad-code",
        "bad-date",
        "absurd-exponent",
        "over-1e9",
    ],
)
def test_parse_rejects_unusable_feeds(xml):
    with pytest.raises(ValueError):
        parse_ecb_xml(xml)


def test_parse_refuses_entity_expansion():
    bomb = (
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">'
        '<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><x>&b;</x>'
    )
    with pytest.raises(ValueError):
        parse_ecb_xml(bomb)


async def _redis() -> Redis:
    return Redis.from_url(os.environ["TM_REDIS_URL"])


async def test_rates_are_fetched_once_then_cached(respx_mock):
    route = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=XML))
    redis = await _redis()
    try:
        first = await get_fx_rates(redis, enabled=True)
        second = await get_fx_rates(redis, enabled=True)
        ttl = await redis.ttl(CACHE_KEY)
    finally:
        await redis.aclose()
    assert first is not None and second is not None
    assert second.rates == first.rates
    assert second.as_of == date(2026, 9, 28)
    assert route.call_count == 1
    assert 0 < ttl <= 12 * 3600


async def test_failures_and_disabled_mean_no_rates(respx_mock):
    route = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(503))
    redis = await _redis()
    try:
        assert await get_fx_rates(redis, enabled=True) is None
        assert await get_fx_rates(redis, enabled=False) is None
        assert await redis.get(CACHE_KEY) is None
    finally:
        await redis.aclose()
    assert route.call_count == 1  # disabled never touches the network


async def test_network_errors_mean_no_rates(respx_mock):
    respx_mock.get(ECB_DAILY_URL).mock(side_effect=httpx.ConnectTimeout("slow"))
    redis = await _redis()
    try:
        assert await get_fx_rates(redis, enabled=True) is None
    finally:
        await redis.aclose()


async def test_garbage_xml_means_no_rates(respx_mock):
    respx_mock.get(ECB_DAILY_URL).mock(
        return_value=httpx.Response(200, text="<html>maintenance</html>")
    )
    redis = await _redis()
    try:
        assert await get_fx_rates(redis, enabled=True) is None
        assert await redis.get(CACHE_KEY) is None
    finally:
        await redis.aclose()


@pytest.mark.parametrize(
    "cached",
    [
        b"not json",
        b"[]",
        b'{"as_of": "2026-09-28"}',
        b'{"as_of": "2026-09-28", "rates": {"EUR": "1", "INR": "abc"}}',
        b'{"as_of": "2026-09-28", "rates": {"EUR": "1", "INR": "NaN"}}',
    ],
)
async def test_corrupt_cache_is_ignored_and_refetched(respx_mock, cached):
    route = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=XML))
    redis = await _redis()
    try:
        await redis.set(CACHE_KEY, cached)
        rates = await get_fx_rates(redis, enabled=True)
    finally:
        await redis.aclose()
    assert rates is not None
    assert rates.rates["INR"] == Decimal("90.4000")
    assert route.call_count == 1


class _BrokenRedis:
    async def get(self, key):
        raise RedisConnectionError("down")

    async def exists(self, *keys):
        raise RedisConnectionError("down")

    async def set(self, key, value, ex=None):
        raise RedisConnectionError("down")


async def test_redis_outage_still_returns_fresh_rates(respx_mock):
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=XML))
    rates = await get_fx_rates(_BrokenRedis(), enabled=True)  # type: ignore[arg-type]
    assert rates is not None
    assert rates.as_of == date(2026, 9, 28)


async def test_failed_fetch_backs_off_for_five_minutes(respx_mock):
    route = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(503))
    redis = await _redis()
    try:
        assert await get_fx_rates(redis, enabled=True) is None
        ttl = await redis.ttl(FAILURE_KEY)
        assert await get_fx_rates(redis, enabled=True) is None
    finally:
        await redis.aclose()
    assert FAILURE_TTL_SECONDS == 300
    assert 0 < ttl <= 300
    assert route.call_count == 1  # the second call never reached the feed


async def test_garbage_feed_also_backs_off(respx_mock):
    route = respx_mock.get(ECB_DAILY_URL).mock(
        return_value=httpx.Response(200, text="<html>maintenance</html>")
    )
    redis = await _redis()
    try:
        assert await get_fx_rates(redis, enabled=True) is None
        assert await get_fx_rates(redis, enabled=True) is None
        assert await redis.get(FAILURE_KEY) == b"1"
    finally:
        await redis.aclose()
    assert route.call_count == 1


async def test_cached_rates_win_over_the_failure_marker(respx_mock):
    route = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=XML))
    redis = await _redis()
    try:
        assert await get_fx_rates(redis, enabled=True) is not None
        await redis.set(FAILURE_KEY, "1", ex=FAILURE_TTL_SECONDS)
        assert await get_fx_rates(redis, enabled=True) is not None
    finally:
        await redis.aclose()
    assert route.call_count == 1


class _MarkerBrokenRedis:
    """Cache miss, but reading or writing the failure marker fails."""

    def __init__(self):
        self.set_calls = []

    async def get(self, key):
        return None

    async def exists(self, *keys):
        raise RedisConnectionError("down")

    async def set(self, key, value, ex=None):
        self.set_calls.append(key)
        raise RedisConnectionError("down")


async def test_marker_read_failure_falls_through_to_fetch(respx_mock):
    route = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=XML))
    rates = await get_fx_rates(_MarkerBrokenRedis(), enabled=True)  # type: ignore[arg-type]
    assert rates is not None
    assert route.call_count == 1


async def test_marker_write_failure_does_not_raise(respx_mock):
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(503))
    redis = _MarkerBrokenRedis()
    assert await get_fx_rates(redis, enabled=True) is None  # type: ignore[arg-type]
    assert redis.set_calls == [FAILURE_KEY]


async def test_fetch_uses_a_tight_timeout(respx_mock):
    route = respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=XML))
    redis = await _redis()
    try:
        await get_fx_rates(redis, enabled=True)
    finally:
        await redis.aclose()
    timeout = route.calls.last.request.extensions["timeout"]
    assert timeout == {"connect": 1.0, "read": 2.0, "write": 2.0, "pool": 2.0}


async def test_a_stalled_feed_is_cut_off_by_the_deadline(respx_mock, monkeypatch):
    async def stall(request):
        await asyncio.sleep(5)
        return httpx.Response(200, text=XML)

    assert fx.FETCH_DEADLINE_SECONDS == 3.0  # caps the whole fetch; httpx timeouts are per phase
    monkeypatch.setattr(fx, "FETCH_DEADLINE_SECONDS", 0.2)
    respx_mock.get(ECB_DAILY_URL).mock(side_effect=stall)
    redis = await _redis()
    try:
        started = time.monotonic()
        rates = await get_fx_rates(redis, enabled=True)
        elapsed = time.monotonic() - started
        backed_off = await redis.exists(FAILURE_KEY)
    finally:
        await redis.aclose()
    assert rates is None
    assert elapsed < 2
    assert backed_off
