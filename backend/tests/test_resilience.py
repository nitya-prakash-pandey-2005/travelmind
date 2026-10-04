"""Per-supplier guards: a concurrency limit and a circuit breaker for each outbound supplier, and
how every caller turns an open circuit into its usual "unavailable" result (never a 500).

Breaker timing runs on a fake clock; nothing here sleeps."""

import asyncio
import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from prometheus_client import REGISTRY
from redis.asyncio import Redis
from structlog.testing import capture_logs

from tests.helpers import signup
from tests.offers.offer_factory import make_offer
from travelmind import resilience
from travelmind.config import Settings, get_settings
from travelmind.offers.suppliers.base import SupplierError
from travelmind.resilience import CircuitOpen, SupplierGuard, guard_for

SEARCH = "/api/v1/flights/search"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


def make_guard(clock: FakeClock, **changes) -> SupplierGuard:
    options = {
        "max_concurrent": 10,
        "failure_threshold": 3,
        "reset_after_s": 30.0,
        "acquire_timeout_s": 0.0,
    } | changes
    return SupplierGuard("duffel", clock=clock, **options)


async def fail(guard: SupplierGuard, exc: BaseException | None = None) -> None:
    """One call whose body fails (a supplier error by default)."""
    with pytest.raises(type(exc) if exc else SupplierError):
        async with guard.call():
            raise exc or SupplierError("unavailable", "Duffel had a problem answering.")


async def succeed(guard: SupplierGuard) -> None:
    async with guard.call():
        pass


async def trip(name: str) -> None:
    """Open the process-wide guard for `name` with consecutive failures."""
    guard = guard_for(name)
    for _ in range(get_settings().supplier_breaker_threshold):
        await fail(guard)
    assert guard.state == "open"


def _count(supplier: str, outcome: str) -> float:
    value = REGISTRY.get_sample_value(
        "supplier_request_duration_seconds_count", {"supplier": supplier, "outcome": outcome}
    )
    return value or 0.0


def trip_day() -> str:
    return (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


# --- the guard ---------------------------------------------------------------------------------


def test_supplier_guard_defaults():
    settings = Settings(_env_file=None)
    assert settings.supplier_max_concurrent == 20
    assert settings.supplier_breaker_threshold == 5
    assert settings.supplier_breaker_reset_s == 30.0
    assert settings.supplier_acquire_timeout_s == 2.0


async def test_breaker_opens_after_threshold(clock):
    guard = make_guard(clock)
    await fail(guard)
    await fail(guard)
    assert guard.state == "closed"
    await fail(guard)
    assert guard.state == "open"


async def test_failures_must_be_consecutive(clock):
    guard = make_guard(clock)
    for _ in range(4):
        await fail(guard)
        await fail(guard)
        await succeed(guard)
    assert guard.state == "closed"


async def test_open_breaker_skips_the_supplier(clock):
    guard = make_guard(clock)
    for _ in range(3):
        await fail(guard)
    before = _count("duffel", "circuit_open")
    ran = False
    with pytest.raises(CircuitOpen) as refused:
        async with guard.call():
            ran = True
    assert not ran  # the body is never executed
    assert refused.value.supplier == "duffel" and refused.value.reason == "open"
    assert refused.value.message  # safe to show in the source list
    assert _count("duffel", "circuit_open") == before + 1
    clock.now += 29.9
    with pytest.raises(CircuitOpen):
        async with guard.call():
            pytest.fail("still open")


async def test_half_open_allows_one_trial_and_success_closes_it(clock):
    guard = make_guard(clock)
    for _ in range(3):
        await fail(guard)
    clock.now += 30.0
    assert guard.state == "half_open"
    async with guard.call():  # the one trial
        with pytest.raises(CircuitOpen):  # everyone else is still turned away meanwhile
            async with guard.call():
                pytest.fail("only one trial at a time")
    assert guard.state == "closed"
    await succeed(guard)
    await succeed(guard)


async def test_half_open_trial_failure_reopens_it(clock):
    guard = make_guard(clock)
    for _ in range(3):
        await fail(guard)
    clock.now += 30.0
    await fail(guard)  # the trial fails
    assert guard.state == "open"
    clock.now += 29.9  # a whole new cool-down
    with pytest.raises(CircuitOpen):
        async with guard.call():
            pytest.fail("reopened")
    clock.now += 0.1
    await succeed(guard)
    assert guard.state == "closed"


async def test_a_cancelled_trial_lets_the_next_call_try(clock):
    guard = make_guard(clock)
    for _ in range(3):
        await fail(guard)
    clock.now += 30.0
    await fail(guard, asyncio.CancelledError())  # no outcome: neither closes nor reopens
    assert guard.state == "half_open"
    await succeed(guard)
    assert guard.state == "closed"


async def test_timeouts_count_as_failures(clock):
    guard = make_guard(clock)
    await fail(guard, TimeoutError())
    await fail(guard, httpx.ConnectTimeout("slow"))
    await fail(guard, SupplierError("timeout", "Duffel didn't answer in time."))
    assert guard.state == "open"


async def test_answers_about_the_request_are_not_failures(clock):
    """The supplier answered, so it is healthy: a rejected search or a gone offer doesn't count."""
    guard = make_guard(clock)
    for code in ("invalid_request", "offer_expired", "offer_unavailable") * 2:
        await fail(guard, SupplierError(code, "about the request"))  # type: ignore[arg-type]
    assert guard.state == "closed"


async def test_concurrency_limit(clock):
    guard = make_guard(clock, max_concurrent=2)
    release = asyncio.Event()
    entered = [asyncio.Event(), asyncio.Event()]

    async def hold(inside: asyncio.Event) -> None:
        async with guard.call():
            inside.set()
            await release.wait()

    holders = [asyncio.create_task(hold(inside)) for inside in entered]
    for inside in entered:
        await inside.wait()
    before = _count("duffel", "circuit_open")
    with pytest.raises(CircuitOpen) as refused:  # the third waiter gets no slot in time
        async with guard.call():
            pytest.fail("over the limit")
    assert refused.value.reason == "busy"
    assert _count("duffel", "circuit_open") == before + 1
    assert guard.state == "closed"  # being busy is not the supplier failing
    release.set()
    await asyncio.gather(*holders)
    await succeed(guard)  # slots are handed back


async def test_a_waiter_gets_a_slot_freed_within_the_timeout(clock):
    guard = make_guard(clock, max_concurrent=1, acquire_timeout_s=5.0)
    release = asyncio.Event()
    entered = asyncio.Event()

    async def hold() -> None:
        async with guard.call():
            entered.set()
            await release.wait()

    holder = asyncio.create_task(hold())
    await entered.wait()
    waiter = asyncio.create_task(succeed(guard))
    await asyncio.sleep(0)
    assert not waiter.done()  # waiting for the one slot
    release.set()
    await asyncio.gather(holder, waiter)


def test_guard_for_uses_settings_and_is_per_process(monkeypatch):
    monkeypatch.setattr(get_settings(), "supplier_max_concurrent", 7)
    monkeypatch.setattr(get_settings(), "supplier_breaker_threshold", 2)
    guard = guard_for("liteapi")
    assert guard_for("liteapi") is guard
    assert guard.max_concurrent == 7 and guard.failure_threshold == 2
    assert guard_for("duffel") is not guard
    resilience.reset_guards()
    assert guard_for("liteapi") is not guard


def test_breaker_state_never_creates_a_guard():
    assert resilience.breaker_state("duffel") == "closed"
    assert "duffel" not in resilience._guards


# --- callers: an open circuit is the caller's usual "unavailable" result -----------------------


async def test_search_survives_open_duffel_breaker(client, airports, monkeypatch, respx_mock):
    from travelmind.offers.suppliers.duffel import DUFFEL_BASE_URL

    monkeypatch.setattr(get_settings(), "duffel_token", "duffel_test_abc")
    monkeypatch.setattr(get_settings(), "supplier_breaker_threshold", 3)
    route = respx_mock.post(f"{DUFFEL_BASE_URL}/air/offer_requests").mock(
        return_value=httpx.Response(500, json={"errors": [{"type": "api_error"}]})
    )
    await signup(client)
    for _ in range(3):
        r = await client.post(
            SEARCH, json={"origin": "DEL", "destination": "BOM", "departure_date": trip_day()}
        )
        assert r.status_code == 200
    assert route.call_count == 3
    assert guard_for("duffel").state == "open"

    r = await client.post(
        SEARCH, json={"origin": "DEL", "destination": "BOM", "departure_date": trip_day()}
    )
    assert r.status_code == 200
    body = r.json()
    sources = {s["supplier"]: s for s in body["sources"]}
    assert sources["sandbox"]["status"] == "ok" and body["offers"]  # sandbox results still come
    assert sources["duffel"]["status"] == "error"  # marked unavailable,
    assert sources["duffel"]["message"]
    assert route.call_count == 3  # without calling Duffel


async def test_supplier_status_shows_breaker(client, monkeypatch):
    await signup(client)
    statuses = {s["code"]: s for s in (await client.get("/api/v1/suppliers")).json()}
    assert {s["breaker"] for s in statuses.values()} == {"closed"}
    await trip("duffel")
    statuses = {s["code"]: s for s in (await client.get("/api/v1/suppliers")).json()}
    assert statuses["duffel"]["breaker"] == "open"
    assert statuses["liteapi"]["breaker"] == "closed"


async def test_reprice_with_an_open_breaker_is_a_price_check_failure(client, airports, monkeypatch):
    from tests.offers.test_search_api import StubSupplier, use_suppliers

    offer = make_offer(
        [("DEL", "BOM", "AI", "101", "2026-11-20T06:00")],
        offer_ref="live",
        supplier="duffel",
        provenance="LIVE",
    )
    priced = []

    class Duffel(StubSupplier):
        async def price(self, supplier_ref):  # type: ignore[no-untyped-def]
            priced.append(supplier_ref)
            return offer

    use_suppliers(monkeypatch, Duffel("duffel", [offer]))
    await signup(client)
    body = (
        await client.post(
            SEARCH, json={"origin": "DEL", "destination": "BOM", "departure_date": trip_day()}
        )
    ).json()
    offer_id = next(o["id"] for o in body["offers"] if o["supplier"] == "duffel")
    await trip("duffel")
    r = await client.post(f"/api/v1/flights/offers/{offer_id}/price")
    assert r.status_code == 502  # the existing "couldn't confirm the price" outcome
    assert r.json()["detail"]
    assert priced == []


async def test_hotel_search_survives_open_liteapi_breaker(
    client, airports, monkeypatch, respx_mock
):
    from travelmind.hotels.liteapi import LITEAPI_BASE_URL

    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    route = respx_mock.post(f"{LITEAPI_BASE_URL}/hotels/rates").mock(
        return_value=httpx.Response(200, json={"data": []})
    )
    await signup(client)
    await trip("liteapi")
    day = datetime.now(UTC).date()
    r = await client.post(
        "/api/v1/hotels/search",
        json={
            "destination": "BOM",
            "checkin": (day + timedelta(days=30)).isoformat(),
            "checkout": (day + timedelta(days=32)).isoformat(),
        },
    )
    assert r.status_code == 200
    [source] = r.json()["sources"]
    assert source["supplier"] == "liteapi" and source["status"] == "error"
    assert source["message"]
    assert route.call_count == 0


async def test_tim_with_an_open_breaker_leaves_offers_untouched(respx_mock):
    from travelmind.offers.carbon import TIM_BASE_URL, TimClient

    flights = respx_mock.post(f"{TIM_BASE_URL}/flights:computeFlightEmissions")
    typical = respx_mock.post(f"{TIM_BASE_URL}/flights:computeTypicalFlightEmissions")
    await trip("google_tim")
    offer = make_offer([("DEL", "BOM", "6E", "2045", "2026-11-20T06:10")], offer_ref="x")
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        [enriched] = await TimClient("key", redis).enrich([offer], "economy")
    finally:
        await redis.aclose()
    assert enriched.co2_kg_per_passenger == offer.co2_kg_per_passenger
    assert flights.call_count == 0 and typical.call_count == 0


async def test_fx_with_an_open_breaker_has_no_rates(respx_mock):
    from travelmind.offers.fx import ECB_DAILY_URL, FAILURE_KEY, get_fx_rates

    route = respx_mock.get(ECB_DAILY_URL)
    await trip("ecb")
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        assert await get_fx_rates(redis) is None
        assert not await redis.exists(FAILURE_KEY)  # skipped, not a failed fetch
    finally:
        await redis.aclose()
    assert route.call_count == 0


async def test_travelpayouts_with_an_open_breaker_adds_nothing(respx_mock):
    from tests.fareintel.test_travelpayouts import seed, tp_redis
    from travelmind.fareintel.travelpayouts import TP_PRICES_URL

    route = respx_mock.get(url__startswith=TP_PRICES_URL)
    await trip("travelpayouts")
    redis = tp_redis()
    try:
        assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert route.call_count == 0


# --- slots are never leaked or handed back twice -----------------------------------------------


async def hold(guard: SupplierGuard) -> tuple[asyncio.Task, asyncio.Event]:
    """A call holding a slot until the returned event is set."""
    release, entered = asyncio.Event(), asyncio.Event()

    async def body() -> None:
        async with guard.call():
            entered.set()
            await release.wait()

    task = asyncio.create_task(body())
    await entered.wait()
    return task, release


async def assert_one_free_slot(guard: SupplierGuard) -> None:
    """With max_concurrent=1: a call gets the slot (none leaked) and a second one meanwhile is
    busy (none handed back twice)."""
    holder, release = await hold(guard)
    with pytest.raises(CircuitOpen) as refused:
        async with guard.call():
            pytest.fail("two calls in one slot")
    assert refused.value.reason == "busy"
    release.set()
    await holder


async def test_the_slot_is_handed_back_when_the_body_raises(clock):
    guard = make_guard(clock, max_concurrent=1)
    await fail(guard, RuntimeError("boom"))
    await fail(guard)
    await assert_one_free_slot(guard)


async def test_the_slot_is_handed_back_when_the_holder_is_cancelled(clock):
    guard = make_guard(clock, max_concurrent=1)
    holder, _ = await hold(guard)
    holder.cancel()
    with pytest.raises(asyncio.CancelledError):
        await holder
    await assert_one_free_slot(guard)
    assert guard.state == "closed"  # a cancelled call has no outcome


@pytest.mark.parametrize("half_open", [False, True])
async def test_cancelling_a_call_waiting_for_a_slot_leaks_nothing(clock, half_open):
    guard = make_guard(clock, max_concurrent=1, acquire_timeout_s=5.0)
    holder, release = await hold(guard)
    if half_open:  # the waiter is the half-open trial
        for _ in range(3):
            guard._breaker.record_failure()
        clock.now += 30.0
    waiter = asyncio.create_task(succeed(guard))
    await asyncio.sleep(0)
    assert not waiter.done()  # waiting for the one slot
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    release.set()
    await holder
    if half_open:
        assert guard.state == "half_open"  # the trial is free again
        await succeed(guard)  # the next call is the trial
    assert guard.state == "closed"
    await assert_one_free_slot(guard)


async def test_a_trial_refused_as_busy_frees_the_trial(clock):
    guard = make_guard(clock, max_concurrent=1)
    holder, release = await hold(guard)  # admitted while closed
    for _ in range(3):
        guard._breaker.record_failure()
    clock.now += 30.0
    with pytest.raises(CircuitOpen) as refused:  # the trial gets no slot
        async with guard.call():
            pytest.fail("no free slot")
    assert refused.value.reason == "busy"
    assert guard.state == "half_open"
    release.set()
    await holder
    await succeed(guard)  # the next call is the trial, not refused as "open"
    assert guard.state == "closed"
    await assert_one_free_slot(guard)


# --- stale outcomes: a call admitted before an open/close can't move the breaker ---------------


def test_a_straggler_cannot_close_or_reopen_the_breaker(clock):
    breaker = resilience.CircuitBreaker(failures=3, cooldown_s=30.0, clock=clock)
    straggler = breaker.admit()
    assert straggler is not None
    for _ in range(3):
        breaker.record_failure(breaker.admit())
    assert breaker.state == "open"
    assert breaker.record_success(straggler) is False  # admitted before it opened: ignored
    assert breaker.state == "open"
    clock.now += 30.0
    trial = breaker.admit()
    assert trial is not None and trial != straggler
    assert breaker.record_failure(straggler) is False  # doesn't reopen it under the trial
    breaker.abandon(straggler)  # nor frees the trial
    assert breaker.state == "half_open" and breaker.admit() is None
    assert breaker.record_success(trial) is True
    assert breaker.state == "closed"
    for _ in range(3):
        breaker.record_failure(trial)  # admitted before the close: no longer counts
    assert breaker.state == "closed"


def test_outcomes_without_an_epoch_still_count(clock):
    breaker = resilience.CircuitBreaker(failures=2, cooldown_s=30.0, clock=clock)
    assert breaker.allow()
    breaker.record_failure()
    assert breaker.record_failure() is True
    assert breaker.state == "open"


async def test_a_call_in_flight_when_the_breaker_opens_does_not_close_it(clock):
    guard = make_guard(clock, max_concurrent=2)
    holder, release = await hold(guard)
    for _ in range(3):
        await fail(guard)
    assert guard.state == "open"
    release.set()
    await holder  # succeeds, but was admitted before the breaker opened
    assert guard.state == "open"
    with pytest.raises(CircuitOpen):
        async with guard.call():
            pytest.fail("still open")


async def test_a_straggler_failure_does_not_reopen_a_half_open_breaker(clock):
    guard = make_guard(clock, max_concurrent=2)
    straggler_go, straggler_in = asyncio.Event(), asyncio.Event()

    async def straggle() -> None:
        async with guard.call():
            straggler_in.set()
            await straggler_go.wait()
            raise SupplierError("unavailable", "late failure")

    straggler = asyncio.create_task(straggle())
    await straggler_in.wait()
    for _ in range(3):
        await fail(guard)
    clock.now += 30.0
    trial, release = await hold(guard)  # the half-open trial
    straggler_go.set()
    with pytest.raises(SupplierError):
        await straggler
    assert guard.state == "half_open"  # not reopened by a call from before
    release.set()
    await trial
    assert guard.state == "closed"


# --- a supplier rejecting our request (4xx) is not unwell --------------------------------------


async def _fx(redis: Redis) -> object:
    from travelmind.offers.fx import get_fx_rates

    return await get_fx_rates(redis)


async def _tim(redis: Redis) -> object:
    from travelmind.offers.carbon import TimClient

    offer = make_offer([("DEL", "BOM", "6E", "2045", "2026-11-20T06:10")], offer_ref="x")
    [enriched] = await TimClient("key", redis).enrich([offer], "economy")
    assert enriched.co2_kg_per_passenger == offer.co2_kg_per_passenger  # left as it was
    return None


async def _travelpayouts(redis: Redis) -> object:
    from tests.fareintel.test_travelpayouts import seed

    return await seed(redis)


def _feeds(respx_mock, status: int) -> list[tuple[str, Callable, str]]:
    from travelmind.fareintel.travelpayouts import TP_PRICES_URL
    from travelmind.offers.carbon import TIM_BASE_URL
    from travelmind.offers.fx import ECB_DAILY_URL

    answer = httpx.Response(status, json={"error": "nope"})
    respx_mock.get(ECB_DAILY_URL).mock(return_value=answer)
    respx_mock.post(url__startswith=TIM_BASE_URL).mock(return_value=answer)
    respx_mock.get(url__startswith=TP_PRICES_URL).mock(return_value=answer)
    return [
        ("ecb", _fx, "fx_rates_unavailable"),
        ("google_tim", _tim, "tim_unavailable"),
        ("travelpayouts", _travelpayouts, "travelpayouts_unavailable"),
    ]


async def _call_feed(feed: Callable, redis: Redis) -> tuple[object, list[dict]]:
    await redis.flushdb()  # no failure marker, back-off or claim left from the last call
    with capture_logs() as logs:
        result = await feed(redis)
    return result, logs


@pytest.mark.parametrize("status", [400, 404, 422])
async def test_feeds_rejecting_our_request_keep_the_breaker_closed(respx_mock, status):
    feeds = _feeds(respx_mock, status)
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        for name, feed, event in feeds:
            for _ in range(get_settings().supplier_breaker_threshold + 1):
                result, logs = await _call_feed(feed, redis)
                assert result in (None, 0)  # the usual degraded result
                assert any(e["event"] == event for e in logs), logs  # still logged
            assert guard_for(name).state == "closed", name
    finally:
        await redis.aclose()


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
async def test_feeds_failing_or_refusing_us_open_the_breaker(respx_mock, status):
    feeds = _feeds(respx_mock, status)
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        for name, feed, _ in feeds:
            for _ in range(get_settings().supplier_breaker_threshold):
                result, _logs = await _call_feed(feed, redis)
                assert result in (None, 0)
            assert guard_for(name).state == "open", name
    finally:
        await redis.aclose()
