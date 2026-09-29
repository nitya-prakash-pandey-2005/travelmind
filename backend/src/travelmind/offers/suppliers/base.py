from collections.abc import Callable
from typing import Literal, Protocol

from travelmind.offers.models import FlightOffer, FlightSearchRequest
from travelmind.reference.search import AirportRecord

ErrorCode = Literal[
    "not_configured",
    "auth",
    "rate_limited",
    "timeout",
    "unavailable",
    "invalid_request",
    "offer_expired",
    "offer_unavailable",
]
AirportLookup = Callable[[str], AirportRecord | None]

_SEPARATOR = "~"


class SupplierError(Exception):
    """A supplier problem with a message that is safe to show to users."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message


class FlightSupplier(Protocol):
    code: str

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]: ...

    async def price(self, supplier_ref: str) -> FlightOffer: ...


def offer_id(supplier: str, supplier_ref: str) -> str:
    return f"{supplier}{_SEPARATOR}{supplier_ref}"


def split_offer_id(value: str) -> tuple[str, str] | None:
    supplier, sep, ref = value.partition(_SEPARATOR)
    return (supplier, ref) if sep and supplier and ref else None
