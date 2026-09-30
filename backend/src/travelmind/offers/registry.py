from typing import Literal

from travelmind.config import Settings
from travelmind.offers.schemas import SupplierStatusOut
from travelmind.offers.suppliers.base import AirportLookup, FlightSupplier
from travelmind.offers.suppliers.duffel import DuffelFlightSupplier
from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier


def flight_suppliers(settings: Settings, lookup: AirportLookup) -> list[FlightSupplier]:
    suppliers: list[FlightSupplier] = []
    if settings.sandbox_supplier_enabled:
        suppliers.append(SandboxFlightSupplier(lookup))
    if settings.duffel_token:
        suppliers.append(
            DuffelFlightSupplier(
                settings.duffel_token, supplier_timeout_ms=settings.duffel_supplier_timeout_ms
            )
        )
    return suppliers


def _mode(secret: str, test_prefix: str) -> Literal["live", "test"] | None:
    if not secret:
        return None
    return "test" if secret.startswith(test_prefix) else "live"


def supplier_statuses(settings: Settings) -> list[SupplierStatusOut]:
    """What is connected and in which mode. Never includes a key or any part of one."""
    return [
        SupplierStatusOut(
            code="duffel",
            name="Duffel",
            kind="flights",
            connected=bool(settings.duffel_token),
            mode=_mode(settings.duffel_token, "duffel_test_"),
            detail="Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN.",
        ),
        SupplierStatusOut(
            code="sandbox",
            name="Sandbox inventory",
            kind="flights",
            connected=settings.sandbox_supplier_enabled,
            mode="sandbox" if settings.sandbox_supplier_enabled else None,
            detail="Deterministic test flights for demos and development. Never bookable.",
        ),
        SupplierStatusOut(
            code="liteapi",
            name="LiteAPI",
            kind="hotels",
            connected=bool(settings.liteapi_key),
            mode=_mode(settings.liteapi_key, "sand_"),
            detail="Hotel rates worldwide. Set TM_LITEAPI_KEY.",
        ),
        SupplierStatusOut(
            code="google_tim",
            name="Google Travel Impact Model",
            kind="emissions",
            connected=bool(settings.google_tim_api_key),
            mode="live" if settings.google_tim_api_key else None,
            detail="Per-flight CO₂ estimates. Set TM_GOOGLE_TIM_API_KEY.",
        ),
        SupplierStatusOut(
            code="travelpayouts",
            name="Travelpayouts",
            kind="price_history",
            connected=bool(settings.travelpayouts_token),
            mode="live" if settings.travelpayouts_token else None,
            detail=(
                "Cached market prices that seed fare history (indications only). "
                "Set TM_TRAVELPAYOUTS_TOKEN."
            ),
        ),
        SupplierStatusOut(
            code="ecb",
            name="ECB reference rates",
            kind="exchange_rates",
            connected=settings.fx_enabled,
            mode="live" if settings.fx_enabled else None,
            detail="Daily euro reference rates for approximate converted prices.",
        ),
    ]
