from travelmind.config import Settings
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
