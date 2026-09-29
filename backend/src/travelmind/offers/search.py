import asyncio
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

import structlog

from travelmind.offers.models import FlightOffer, FlightSearchRequest
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import FlightSupplier, SupplierError

log = structlog.get_logger()

SourceState = Literal["ok", "error", "timeout", "not_configured"]


@dataclass(frozen=True)
class SourceStatus:
    supplier: str
    status: SourceState
    offer_count: int = 0
    latency_ms: int = 0
    message: str | None = None


async def _run(
    supplier: FlightSupplier, request: FlightSearchRequest, timeout_s: float
) -> tuple[list[FlightOffer], SourceStatus]:
    started = time.monotonic()

    def elapsed() -> int:
        return round((time.monotonic() - started) * 1000)

    try:
        offers = await asyncio.wait_for(supplier.search(request), timeout=timeout_s)
    except TimeoutError:
        return [], SourceStatus(
            supplier.code, "timeout", 0, elapsed(), f"No answer within {timeout_s:g}s."
        )
    except SupplierError as exc:
        return [], SourceStatus(supplier.code, "error", 0, elapsed(), exc.message)
    except Exception:
        log.exception("supplier_failed", supplier=supplier.code)
        return [], SourceStatus(
            supplier.code, "error", 0, elapsed(), "This supplier failed unexpectedly."
        )
    return offers, SourceStatus(supplier.code, "ok", len(offers), elapsed(), None)


async def fan_out(
    suppliers: Sequence[FlightSupplier], request: FlightSearchRequest, timeout_s: float
) -> tuple[list[FlightOffer], list[SourceStatus]]:
    results = await asyncio.gather(*(_run(s, request, timeout_s) for s in suppliers))
    offers = [offer for batch, _ in results for offer in batch]
    return offers, [status for _, status in results]


def rank(
    offers: list[FlightOffer], display: Callable[[FlightOffer], Money | None]
) -> list[FlightOffer]:
    """Cheapest first by display price; unconvertible offers go last, grouped by currency."""

    def key(offer: FlightOffer) -> tuple[int, str, int, int, int]:
        shown = display(offer)
        duration = offer.total_duration_minutes or 10**6
        if shown is not None:
            return (0, "", shown.amount_minor, duration, offer.stops)
        return (1, offer.total.currency, offer.total.amount_minor, duration, offer.stops)

    return sorted(offers, key=key)
