"""Supplier keys and tokens never reach a log record, with the app's logging config in effect.

Each adapter makes one successful (mocked) call with `configure_logging("INFO")` applied and the
root logger capturing at DEBUG; no stdlib record (message or args) and nothing structlog prints may
contain the secret. The ECB feed has no credential, so its case puts a token in the feed URL: the
same shape as the old TIM `?key=` bug, which httpx's INFO request log used to print in full. The
Gemini case reads its key from TM_GOOGLE_API_KEY, as the agent does.
"""

import json
import logging
import os
from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import structlog
from redis.asyncio import Redis

from tests.offers.offer_factory import make_offer
from travelmind.agent.provider import Message, get_provider
from travelmind.config import Settings
from travelmind.db import get_sessionmaker
from travelmind.fareintel.travelpayouts import TP_PRICES_URL, seed_route
from travelmind.hotels.liteapi import LITEAPI_BASE_URL, LiteApiHotelSupplier
from travelmind.hotels.models import HotelSearchRequest, RoomRequest
from travelmind.observability import configure_logging
from travelmind.offers.carbon import TIM_BASE_URL, TimClient
from travelmind.offers.fx import ECB_DAILY_URL, get_fx_rates
from travelmind.offers.models import FlightSearchRequest
from travelmind.offers.suppliers.duffel import DUFFEL_BASE_URL, DuffelFlightSupplier

TESTS = Path(__file__).parent
TODAY = datetime.now(UTC).date()
SECRET = "sEcReT-9f3c1a"  # distinctive, so a hit can only be a leak


def _json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


async def _duffel(respx_mock) -> None:
    respx_mock.post(f"{DUFFEL_BASE_URL}/air/offer_requests").mock(
        return_value=httpx.Response(
            201, json=_json(TESTS / "offers" / "fixtures" / "duffel_offer_request.json")
        )
    )
    request = FlightSearchRequest(
        origin="LHR", destination="SYD", departure_date=TODAY + timedelta(days=50), adults=1
    )
    assert await DuffelFlightSupplier(f"duffel_test_{SECRET}").search(request)


async def _liteapi(respx_mock) -> None:
    respx_mock.post(f"{LITEAPI_BASE_URL}/hotels/rates").mock(
        return_value=httpx.Response(
            200, json=_json(TESTS / "hotels" / "fixtures" / "liteapi_rates.json")
        )
    )
    request = HotelSearchRequest(
        destination="BOM",
        checkin=TODAY + timedelta(days=30),
        checkout=TODAY + timedelta(days=32),
        rooms=[RoomRequest(adults=2)],
    )
    offers = await LiteApiHotelSupplier(f"sand_{SECRET}").search(
        request, latitude=19.0887, longitude=72.8679, currency="INR"
    )
    assert offers


async def _tim(respx_mock) -> None:
    respx_mock.post(f"{TIM_BASE_URL}/flights:computeFlightEmissions").mock(
        return_value=httpx.Response(
            200, json={"flightEmissions": [{"emissionsGramsPerPax": {"economy": 98_600}}]}
        )
    )
    offer = make_offer([("DEL", "BOM", "6E", "2045", "2026-11-20T06:10")])
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        [enriched] = await TimClient(SECRET, redis).enrich([offer], "economy")
    finally:
        await redis.aclose()
    assert enriched.co2_source == "google_tim"


async def _travelpayouts(respx_mock) -> None:
    depart = TODAY + timedelta(days=40)
    respx_mock.get(TP_PRICES_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "success": True,
                "currency": "inr",
                "data": [
                    {
                        "price": 4210,
                        "airline": "6E",
                        "departure_at": f"{depart.isoformat()}T06:10:00+05:30",
                        "transfers": 0,
                    }
                ],
            },
        )
    )
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        async with get_sessionmaker()() as db:
            added = await seed_route(
                db,
                redis,
                token=SECRET,
                origin="DEL",
                destination="BOM",
                departure_date=depart,
                currency="INR",
                market="in",
            )
            await db.commit()
    finally:
        await redis.aclose()
    assert added == 1


async def _ecb(respx_mock) -> None:
    xml = (TESTS / "offers" / "fixtures" / "ecb_daily.xml").read_text(encoding="utf-8")
    respx_mock.get(url__startswith=ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=xml))
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        rates = await get_fx_rates(redis, url=f"{ECB_DAILY_URL}?access_token={SECRET}")
    finally:
        await redis.aclose()
    assert rates is not None


async def _gemini(respx_mock) -> None:
    respx_mock.post(url__startswith="https://generativelanguage.googleapis.com/").mock(
        return_value=httpx.Response(
            200,
            json={
                "candidates": [{"content": {"role": "model", "parts": [{"text": "Hello."}]}}],
                "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2},
            },
        )
    )
    with pytest.MonkeyPatch.context() as patch:
        patch.delenv("GOOGLE_API_KEY", raising=False)
        patch.setenv("TM_GOOGLE_API_KEY", f"AIza{SECRET}")
        provider = get_provider(Settings(_env_file=None))
    generation = await provider.generate(
        system="You plan trips.", messages=[Message(role="user", text="hi")], tools=[], timeout_s=5
    )
    assert provider.name == "gemini" and generation.text == "Hello."


CALLS: dict[str, Callable[..., Awaitable[None]]] = {
    "duffel": _duffel,
    "liteapi": _liteapi,
    "tim": _tim,
    "travelpayouts": _travelpayouts,
    "ecb": _ecb,
    "gemini": _gemini,
}


@pytest.fixture
def app_logging() -> Iterator[None]:
    """The app's logging config for one test, then the previous levels and structlog config."""
    names = ("httpx", "httpcore")
    levels = {name: logging.getLogger(name).level for name in names}
    structlog_config = structlog.get_config()
    configure_logging("INFO")
    yield
    for name, level in levels.items():
        logging.getLogger(name).setLevel(level)
    structlog.configure(**structlog_config)


@pytest.mark.parametrize("adapter", list(CALLS))
async def test_a_successful_call_never_logs_the_secret(
    adapter, respx_mock, app_logging, caplog, capsys
):
    caplog.set_level(logging.DEBUG)
    await CALLS[adapter](respx_mock)
    for record in caplog.records:
        assert SECRET not in str(record.msg), record.name
        assert SECRET not in repr(record.args), record.name
        assert SECRET not in record.getMessage(), record.name
    printed = capsys.readouterr()
    assert SECRET not in printed.out and SECRET not in printed.err


@pytest.mark.parametrize("status", [400, 503])
async def test_a_failed_gemini_call_never_logs_the_secret(
    status, respx_mock, app_logging, caplog, capsys
):
    """A failed call logs `gemini_call_failed` (kind, type, status) and nothing else: not the key,
    and not Google's error text, which may echo the request or the key."""
    from travelmind.agent.provider import ProviderError

    caplog.set_level(logging.DEBUG)
    key = f"AIza{SECRET}"
    respx_mock.post(url__startswith="https://generativelanguage.googleapis.com/").mock(
        return_value=httpx.Response(
            status,
            json={
                "error": {
                    "code": status,
                    "message": f"API key not valid: {key}",
                    "status": "INVALID_ARGUMENT" if status == 400 else "UNAVAILABLE",
                    "details": [{"reason": "API_KEY_INVALID", "metadata": {"key": key}}],
                }
            },
        )
    )
    with pytest.MonkeyPatch.context() as patch:
        patch.delenv("GOOGLE_API_KEY", raising=False)
        patch.setenv("TM_GOOGLE_API_KEY", key)
        provider = get_provider(Settings(_env_file=None))
    with pytest.raises(ProviderError) as caught:
        await provider.generate(
            system="s", messages=[Message(role="user", text="hi")], tools=[], timeout_s=5
        )
    assert caught.value.kind == "unavailable"
    assert SECRET not in str(caught.value) and SECRET not in repr(caught.value)
    for record in caplog.records:
        assert SECRET not in record.getMessage(), record.name
        assert SECRET not in repr(record.args), record.name
    printed = capsys.readouterr()
    assert "gemini_call_failed" in printed.out
    assert f'"status": {status}' in printed.out
    assert SECRET not in printed.out and SECRET not in printed.err


def test_http_client_request_logs_are_off_at_info(app_logging) -> None:
    # Their INFO request lines carry full URLs; see configure_logging. Set on the loggers
    # themselves, so a DEBUG/INFO root (or a handler that captures everything) can't undo it.
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING
