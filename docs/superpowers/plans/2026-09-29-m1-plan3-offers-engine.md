# M1 · Plan 3 — Offers Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real, honestly-labelled flight and hotel offers inside Mission Control — a supplier-adapter layer (sandbox test inventory, Duffel flights, LiteAPI hotels), fan-out search with partial results, exact money, display-currency conversion, CO₂ per passenger, fare intelligence (typical price, book-now/wait signal), re-pricing, and telemetry-style offer cards.

**Architecture:** A new backend package `travelmind.offers` holds the canonical models (`Money`, `FlightOffer`, `FlightSearchRequest`), one adapter per supplier behind the `FlightSupplier` protocol, and a fan-out search service; `travelmind.fareintel` records fare snapshots and computes baselines; `travelmind.hotels` wraps LiteAPI. The API returns offers with provenance (`LIVE`/`CACHED`/`SANDBOX`), per-source status, a display-currency price and an insight. The frontend adds a Fare Scan panel, results with offer cards and a fare-insight gauge, a Hotel Scan panel, and a Supplier links page.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic, httpx, respx (tests), defusedxml, Redis; React 19 + TypeScript, TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-travelmind-saas-design.md` (§6 data sources & adapters, §7 fare intelligence, §8 agency workflow step 2, §10 offer cards, §11 quality)
**Supplier reference (read before touching an adapter):** `docs/research/2026-09-29-supplier-apis.md`

### Where this plan sits

| Plan | Scope | Status |
|---|---|---|
| 1 | Backend foundation | ✅ merged |
| 2 | Mission Control frontend | ✅ merged |
| **3 (this)** | Offers engine: suppliers, fare intelligence, fare & hotel scan UI | — |
| 4 | AI Copilot: agent + grounding guard + live run trace, quotes, evals | next, back-to-back |

## Global Constraints

- Money is exact: `Money(amount_minor: int, currency: str)` everywhere (paise, cents); never floats for amounts. Supplier decimal strings are parsed with `Decimal`.
- Every offer carries `provenance` ∈ {`LIVE`, `CACHED`, `SANDBOX`} and the UI always shows it. `SANDBOX` and Duffel **test-mode** offers are labelled as test inventory and are never presented as bookable live prices. `CACHED` (Travelpayouts) prices are indications only.
- Sandbox fares never influence a live/market baseline; baselines only compare like with like (same route, cabin, display currency, provenance family).
- Converted amounts (ECB rates) are for display and sorting only, always shown next to the original price and marked "≈". If rates are unavailable, nothing is converted — no invented numbers.
- Supplier credentials are platform-level settings from environment variables (`TM_DUFFEL_TOKEN`, `TM_LITEAPI_KEY`, `TM_GOOGLE_TIM_API_KEY`, `TM_TRAVELPAYOUTS_TOKEN`); empty means "not connected". Never logged, never returned by any endpoint.
- Tests never call real external APIs: HTTP is mocked with `respx`; the test environment forces all supplier keys empty and `TM_FX_ENABLED=false`.
- A slow or failing supplier never fails a search: results include per-source status (`ok` / `error` / `timeout` / `not_configured`) with a plain-language message.
- Tenant data (search log) uses RLS via `tenant_rls_statements`; market data (`fare_snapshots`) is global and append-only for the app role. Cached offers are keyed per agency.
- Backend rules from Plans 1–2: Python 3.12 via `uv run`, Postgres 5433, Redis 6380, `uv run python -m alembic`, `Annotated[...]` dependencies, plain-language errors, full suite green with `-W error`, ruff + mypy clean. Frontend rules from Plan 2: theme tokens only, reduced motion respected, keyboard-reachable, no fake data, `npm test` / typecheck / lint / build clean. Local dev ports: API 8010, web 5173.
- Commit messages are plain conventional commits with **no trailers or attribution lines of any kind**.

## Review Focus

1. **A supplier is slow, down or misconfigured** → the search still returns the other suppliers' offers plus a plain per-source status, never a 500 — pinned in Task 7 `a failing supplier doesn't sink the search` and `a slow supplier times out alone`.
2. **Test prices mistaken for bookable ones** → every flight/hotel offer shows its provenance badge, Duffel test mode maps to `SANDBOX`, and sandbox fares never shape a market baseline — pinned in Task 3 `test-mode offers are labelled SANDBOX`, Task 6 `sandbox fares never shape the market baseline`, Task 10 `offers show provenance, stops, CO₂ and converted prices`.
3. **Price moves or the offer expires between search and re-price** → the user sees "Price changed · now X (was Y)" or "expired — search again" — pinned in Task 7 `reprice reports a changed price` / `reprice of an expired offer`, Task 10 `verifying a price confirms it or shows the new one` / `an expired offer says so`.
4. **Mixed currencies** (Duffel GBP/USD next to INR sandbox) → sorting uses converted display amounts, originals stay visible, and with no rates nothing is converted — pinned in Task 4 conversion tests and Task 7 `mixed currencies sort by display price` / `without rates foreign prices are not converted`.
5. **Cross-tenant leakage** → an agency can't re-price another agency's cached offer, and fare results vanish on sign-out — pinned in Task 7 `offers are cached per agency` and Task 10 `fare results are cleared when the session resets`.

---

### Task 1: Money, offer models, request validation, supplier settings

**Files:**
- Create: `backend/src/travelmind/offers/__init__.py`, `backend/src/travelmind/offers/money.py`, `backend/src/travelmind/offers/models.py`
- Modify: `backend/src/travelmind/config.py`, `backend/.env.example`, `backend/tests/conftest.py`
- Test: `backend/tests/offers/__init__.py`, `backend/tests/offers/test_money_models.py`

**Interfaces:**
- Produces:
  - `Money(amount_minor: int, currency: str)` (frozen) with `Money.from_decimal(amount, currency)` and `.to_decimal()`; `exponent(currency) -> int`
  - Types `IataCode`, `Cabin = Literal["economy","premium_economy","business","first"]`, `Provenance = Literal["LIVE","CACHED","SANDBOX"]`, `Co2Source = Literal["google_tim","google_tim_typical","supplier"]`
  - `FlightSearchRequest(origin, destination, departure_date, return_date=None, adults=1, children_ages=[], cabin="economy", max_connections=1)` with `.passenger_count`
  - `Segment`, `Slice` (`.stops`), `Baggage(checked, carry_on)`, `FareConditions(refundable, refund_penalty, changeable, change_penalty)`, `FlightOffer(id, supplier, supplier_ref, provenance, total, base, tax, owner_carrier, owner_name, cabin, passenger_count, slices, baggage, conditions, co2_kg_per_passenger, co2_source, fetched_at, expires_at)` with `.stops` and `.total_duration_minutes`
  - Settings: `duffel_token`, `duffel_supplier_timeout_ms`, `liteapi_key`, `google_tim_api_key`, `travelpayouts_token`, `sandbox_supplier`, `sandbox_supplier_enabled` (property), `fx_enabled`, `search_timeout_seconds`, `search_max_per_minute`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/offers/__init__.py` (empty) and `backend/tests/offers/test_money_models.py`:

```python
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from travelmind.config import Settings
from travelmind.offers.models import FlightSearchRequest, Segment, Slice
from travelmind.offers.money import Money, exponent


def future(days: int) -> date:
    return datetime.now(UTC).date() + timedelta(days=days)


def test_money_from_decimal_uses_minor_units():
    assert Money.from_decimal("45.00", "gbp") == Money(amount_minor=4500, currency="GBP")
    assert Money.from_decimal(Decimal("4500.50"), "INR").amount_minor == 450050
    assert Money.from_decimal("1200", "JPY").amount_minor == 1200
    assert Money.from_decimal("1.234", "KWD").amount_minor == 1234
    assert Money.from_decimal(163.66, "USD").amount_minor == 16366


def test_money_rounds_half_up_and_round_trips():
    assert Money.from_decimal("10.005", "USD").amount_minor == 1001
    assert Money(amount_minor=450050, currency="INR").to_decimal() == Decimal("4500.50")
    assert exponent("usd") == 2


def test_money_is_immutable_and_validates_currency():
    money = Money(amount_minor=100, currency="USD")
    with pytest.raises(ValidationError):
        money.amount_minor = 5  # type: ignore[misc]
    with pytest.raises(ValidationError):
        Money(amount_minor=100, currency="dollars")


def test_search_request_normalises_codes():
    request = FlightSearchRequest(origin=" del", destination="bom ", departure_date=future(10))
    assert (request.origin, request.destination) == ("DEL", "BOM")
    assert request.passenger_count == 1


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"destination": "DEL"}, "must be different airports"),
        ({"departure_date": future(-1)}, "in the past"),
        ({"departure_date": future(400)}, "days ahead"),
        ({"return_date": future(5)}, "before the departure date"),
        ({"adults": 8, "children_ages": [5, 7]}, "at most 9 passengers"),
    ],
)
def test_search_request_rejects_impossible_trips(changes, message):
    fields = {"origin": "DEL", "destination": "BOM", "departure_date": future(10)} | changes
    with pytest.raises(ValidationError, match=message):
        FlightSearchRequest(**fields)


def test_search_request_bounds_passenger_fields():
    base = {"origin": "DEL", "destination": "BOM", "departure_date": future(10)}
    with pytest.raises(ValidationError):
        FlightSearchRequest(**base, adults=0)
    with pytest.raises(ValidationError):
        FlightSearchRequest(**base, children_ages=[18])
    with pytest.raises(ValidationError):
        FlightSearchRequest(**base, cabin="luxury")


def test_slice_counts_stops():
    leg = {
        "marketing_carrier": "EK",
        "flight_number": "511",
        "departing_at": datetime(2026, 11, 20, 4, 0),
        "arriving_at": datetime(2026, 11, 20, 6, 0),
    }
    one_stop = Slice(
        origin="DEL",
        destination="LHR",
        segments=[Segment(origin="DEL", destination="DXB", **leg), Segment(origin="DXB", destination="LHR", **leg)],
    )
    assert one_stop.stops == 1


def test_sandbox_supplier_defaults_on_except_in_production():
    assert Settings(environment="development").sandbox_supplier_enabled is True
    assert Settings(environment="production").sandbox_supplier_enabled is False
    assert Settings(environment="production", sandbox_supplier=True).sandbox_supplier_enabled is True
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run python -m pytest tests/offers -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'travelmind.offers'`.

- [ ] **Step 3: Implement money and models**

Create `backend/src/travelmind/offers/__init__.py` (empty).

Create `backend/src/travelmind/offers/money.py`:

```python
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints

# ISO 4217 currencies whose minor unit isn't 1/100.
_EXPONENTS = {"JPY": 0, "KRW": 0, "VND": 0, "IDR": 0, "CLP": 0, "ISK": 0, "KWD": 3, "BHD": 3, "OMR": 3, "JOD": 3, "TND": 3}


def _upper(value: object) -> object:
    return value.strip().upper() if isinstance(value, str) else value


CurrencyCode = Annotated[str, BeforeValidator(_upper), StringConstraints(pattern=r"^[A-Z]{3}$")]


def exponent(currency: str) -> int:
    return _EXPONENTS.get(currency.upper(), 2)


class Money(BaseModel):
    """Exact money: integer minor units (paise, cents) plus an ISO 4217 code. Never floats."""

    model_config = ConfigDict(frozen=True)

    amount_minor: int
    currency: CurrencyCode

    @classmethod
    def from_decimal(cls, amount: Decimal | str | int | float, currency: str) -> "Money":
        code = currency.strip().upper()
        scaled = Decimal(str(amount)) * (Decimal(10) ** exponent(code))
        return cls(amount_minor=int(scaled.quantize(Decimal(1), rounding=ROUND_HALF_UP)), currency=code)

    def to_decimal(self) -> Decimal:
        return Decimal(self.amount_minor) / (Decimal(10) ** exponent(self.currency))
```

Create `backend/src/travelmind/offers/models.py`:

```python
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

from travelmind.offers.money import Money

IataCode = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Z]{3}$")]
Cabin = Literal["economy", "premium_economy", "business", "first"]
Provenance = Literal["LIVE", "CACHED", "SANDBOX"]
Co2Source = Literal["google_tim", "google_tim_typical", "supplier"]

MAX_PASSENGERS = 9
MAX_DAYS_AHEAD = 360


class FlightSearchRequest(BaseModel):
    origin: IataCode
    destination: IataCode
    departure_date: date
    return_date: date | None = None
    adults: int = Field(default=1, ge=1, le=MAX_PASSENGERS)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=8)
    cabin: Cabin = "economy"
    max_connections: int = Field(default=1, ge=0, le=2)

    @model_validator(mode="after")
    def _check_trip(self) -> "FlightSearchRequest":
        today = datetime.now(UTC).date()
        if self.origin == self.destination:
            raise ValueError("Origin and destination must be different airports.")
        if self.departure_date < today:
            raise ValueError("The departure date is in the past.")
        if self.departure_date > today + timedelta(days=MAX_DAYS_AHEAD):
            raise ValueError(f"Airlines only sell about {MAX_DAYS_AHEAD} days ahead.")
        if self.return_date is not None and self.return_date < self.departure_date:
            raise ValueError("The return date is before the departure date.")
        if self.adults + len(self.children_ages) > MAX_PASSENGERS:
            raise ValueError(f"A search can include at most {MAX_PASSENGERS} passengers.")
        return self

    @property
    def passenger_count(self) -> int:
        return self.adults + len(self.children_ages)


class Segment(BaseModel):
    origin: str
    destination: str
    departing_at: datetime  # local airport time, no offset (as suppliers return it)
    arriving_at: datetime
    marketing_carrier: str
    marketing_carrier_name: str | None = None
    flight_number: str
    operating_carrier: str | None = None
    operating_flight_number: str | None = None
    duration_minutes: int | None = None


class Slice(BaseModel):
    origin: str
    destination: str
    duration_minutes: int | None = None
    fare_brand: str | None = None
    segments: list[Segment]

    @property
    def stops(self) -> int:
        return max(len(self.segments) - 1, 0)


class Baggage(BaseModel):
    checked: int | None = None
    carry_on: int | None = None


class FareConditions(BaseModel):
    refundable: bool | None = None
    refund_penalty: Money | None = None
    changeable: bool | None = None
    change_penalty: Money | None = None


class FlightOffer(BaseModel):
    id: str
    supplier: str
    supplier_ref: str
    provenance: Provenance
    total: Money
    base: Money | None = None
    tax: Money | None = None
    owner_carrier: str
    owner_name: str | None = None
    cabin: Cabin | None = None
    passenger_count: int
    slices: list[Slice]
    baggage: Baggage = Field(default_factory=Baggage)
    conditions: FareConditions = Field(default_factory=FareConditions)
    co2_kg_per_passenger: int | None = None
    co2_source: Co2Source | None = None
    fetched_at: datetime
    expires_at: datetime | None = None

    @property
    def stops(self) -> int:
        return max((s.stops for s in self.slices), default=0)

    @property
    def total_duration_minutes(self) -> int | None:
        durations = [s.duration_minutes for s in self.slices]
        if any(d is None for d in durations):
            return None
        return sum(d for d in durations if d is not None)
```

- [ ] **Step 4: Add supplier settings**

In `backend/src/travelmind/config.py`, add these fields to `Settings` after `signup_window_seconds` and the property at the end of the class:

```python
    # Suppliers & market data — an empty value means "not connected".
    duffel_token: str = ""
    duffel_supplier_timeout_ms: int = 12000
    liteapi_key: str = ""
    google_tim_api_key: str = ""
    travelpayouts_token: str = ""
    sandbox_supplier: bool | None = None  # None → on everywhere except production
    fx_enabled: bool = True
    search_timeout_seconds: float = 25.0
    search_max_per_minute: int = 30

    @property
    def sandbox_supplier_enabled(self) -> bool:
        if self.sandbox_supplier is not None:
            return self.sandbox_supplier
        return self.environment != "production"
```

Append to `backend/.env.example`:

```dotenv
# Suppliers (leave empty until you have keys; see docs/research/2026-09-29-supplier-apis.md)
TM_DUFFEL_TOKEN=
TM_LITEAPI_KEY=
TM_GOOGLE_TIM_API_KEY=
TM_TRAVELPAYOUTS_TOKEN=
# Sandbox test inventory: empty = on in development, off in production
TM_SANDBOX_SUPPLIER=
TM_FX_ENABLED=true
```

In `backend/tests/conftest.py`, after the `TM_REDIS_URL` line, isolate tests from any real keys in a developer's `.env`:

```python
# Tests never talk to real suppliers or FX feeds, whatever backend/.env contains.
for _key in ("TM_DUFFEL_TOKEN", "TM_LITEAPI_KEY", "TM_GOOGLE_TIM_API_KEY", "TM_TRAVELPAYOUTS_TOKEN"):
    os.environ[_key] = ""
os.environ["TM_FX_ENABLED"] = "false"
os.environ.pop("TM_SANDBOX_SUPPLIER", None)
```

(`TM_SANDBOX_SUPPLIER` must be *unset*, not empty: an empty string isn't a valid boolean.) If `.env.example`'s empty `TM_SANDBOX_SUPPLIER=` line makes pydantic-settings fail to parse when copied into `.env`, change `sandbox_supplier` to accept empty strings via a `BeforeValidator` that maps `""` to `None`, and add a test for it.

- [ ] **Step 5: Run the tests and all checks**

Run: `uv run python -m pytest -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass (98 existing + new).

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(offers): exact money, canonical flight offer models, trip validation, supplier settings"
```

---

### Task 2: Sandbox flight supplier (deterministic test inventory)

**Files:**
- Create: `backend/src/travelmind/reference/geo.py`, `backend/src/travelmind/offers/suppliers/__init__.py`, `backend/src/travelmind/offers/suppliers/base.py`, `backend/src/travelmind/offers/suppliers/sandbox.py`
- Test: `backend/tests/offers/airports.py`, `backend/tests/offers/test_sandbox.py`, `backend/tests/reference/test_geo.py`

**Interfaces:**
- Consumes: `FlightSearchRequest`, `FlightOffer` and friends, `Money` (Task 1); `AirportRecord` (`travelmind.reference.search`).
- Produces:
  - `great_circle_km(lat1, lon1, lat2, lon2) -> float`
  - `SupplierError(code, message)` with `code` ∈ `not_configured | auth | rate_limited | timeout | unavailable | invalid_request | offer_expired | offer_unavailable`; `FlightSupplier` protocol (`code: str`, `async search(request) -> list[FlightOffer]`, `async price(supplier_ref) -> FlightOffer`); `offer_id(supplier, ref) -> str`, `split_offer_id(offer_id) -> tuple[str, str] | None`; `AirportLookup = Callable[[str], AirportRecord | None]`
  - `SandboxFlightSupplier(lookup, clock=...)` with `code = "sandbox"`; offers are `provenance="SANDBOX"`, INR when the origin is in India else USD, whole rupees, expire after 30 minutes; `price(ref)` rebuilds the same offer deterministically.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/offers/airports.py`:

```python
from travelmind.reference.search import AirportRecord


def _airport(code: str, city: str, country: str, lat: float, lon: float) -> AirportRecord:
    return AirportRecord(code, f"{city} International Airport", city, country, country, "large_airport", True, lat, lon, None)


AIRPORTS = {
    a.iata_code: a
    for a in (
        _airport("DEL", "New Delhi", "IN", 28.5665, 77.103104),
        _airport("BOM", "Mumbai", "IN", 19.0887, 72.8679),
        _airport("LHR", "London", "GB", 51.4706, -0.461941),
        _airport("SYD", "Sydney", "AU", -33.9461, 151.177),
        _airport("DXB", "Dubai", "AE", 25.2528, 55.3644),
        _airport("DOH", "Doha", "QA", 25.2731, 51.6081),
        _airport("IST", "Istanbul", "TR", 41.2753, 28.7519),
        _airport("JFK", "New York", "US", 40.6398, -73.7789),
        _airport("GRU", "Sao Paulo", "BR", -23.4356, -46.4731),
        _airport("GIG", "Rio de Janeiro", "BR", -22.8099, -43.2505),
    )
}


def lookup(code: str) -> AirportRecord | None:
    return AIRPORTS.get(code.upper())
```

Create `backend/tests/reference/test_geo.py`:

```python
from travelmind.reference.geo import great_circle_km


def test_delhi_to_mumbai():
    assert round(great_circle_km(28.5665, 77.103104, 19.0887, 72.8679)) == 1138


def test_same_point_is_zero():
    assert great_circle_km(10.0, 20.0, 10.0, 20.0) == 0.0
```

Create `backend/tests/offers/test_sandbox.py`:

```python
from datetime import UTC, date, datetime, timedelta

import pytest

from tests.offers.airports import lookup
from travelmind.offers.models import FlightSearchRequest
from travelmind.offers.suppliers.base import SupplierError, split_offer_id
from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier


def future(days: int) -> date:
    return datetime.now(UTC).date() + timedelta(days=days)


def supplier() -> SandboxFlightSupplier:
    return SandboxFlightSupplier(lookup)


def request(**changes) -> FlightSearchRequest:
    fields = {"origin": "DEL", "destination": "BOM", "departure_date": future(30)} | changes
    return FlightSearchRequest(**fields)


async def test_same_search_gives_the_same_offers():
    first = await supplier().search(request())
    second = await supplier().search(request())
    assert [(o.id, o.total) for o in first] == [(o.id, o.total) for o in second]
    assert len(first) >= 4


async def test_indian_domestic_route():
    offers = await supplier().search(request())
    assert {o.owner_carrier for o in offers} <= {"AI", "6E", "QP"}
    for offer in offers:
        assert offer.provenance == "SANDBOX"
        assert offer.supplier == "sandbox"
        assert offer.total.currency == "INR"
        assert offer.total.amount_minor % 100 == 0  # whole rupees
        assert offer.stops == 0
        assert offer.expires_at == offer.fetched_at + timedelta(minutes=30)
        assert split_offer_id(offer.id) == ("sandbox", offer.supplier_ref)
        assert offer.base is not None and offer.tax is not None
        assert offer.base.amount_minor + offer.tax.amount_minor == offer.total.amount_minor


async def test_long_haul_offers_connections_through_hubs():
    offers = await supplier().search(request(origin="LHR", destination="SYD"))
    vias = {o.slices[0].segments[0].destination for o in offers if o.stops == 1}
    assert vias & {"DXB", "DOH", "IST"}
    assert all(o.total.currency == "USD" for o in offers)


async def test_nonstop_only_search_drops_connections():
    offers = await supplier().search(request(origin="LHR", destination="SYD", max_connections=0))
    assert offers and all(o.stops == 0 for o in offers)


async def test_routes_without_known_carriers_use_sandbox_air():
    offers = await supplier().search(request(origin="GRU", destination="GIG"))
    assert {o.owner_carrier for o in offers} == {"ZZ"}
    assert offers[0].owner_name == "Sandbox Air"


async def test_business_costs_more_than_economy():
    economy = {o.owner_carrier: o.total.amount_minor for o in await supplier().search(request()) if "Flex" not in (o.slices[0].fare_brand or "")}
    business = {o.owner_carrier: o.total.amount_minor for o in await supplier().search(request(cabin="business")) if "Flex" not in (o.slices[0].fare_brand or "")}
    assert all(business[c] > economy[c] for c in economy)


async def test_round_trip_has_a_return_slice():
    offers = await supplier().search(request(return_date=future(37)))
    back = offers[0].slices[1]
    assert (back.origin, back.destination) == ("BOM", "DEL")
    assert back.segments[0].departing_at.date() == future(37)


async def test_passengers_scale_the_price():
    one = (await supplier().search(request()))[0].total.amount_minor
    two = (await supplier().search(request(adults=2)))[0].total.amount_minor
    with_infant = (await supplier().search(request(adults=2, children_ages=[1])))[0].total.amount_minor
    assert two == pytest.approx(one * 2, rel=0.01)
    assert two < with_infant < two * 1.2


async def test_last_minute_is_pricier_than_booking_ahead():
    near = {o.owner_carrier: o.total.amount_minor for o in await supplier().search(request(departure_date=future(3)))}
    far = {o.owner_carrier: o.total.amount_minor for o in await supplier().search(request(departure_date=future(90)))}
    assert sum(near.values()) > sum(far.values())


async def test_price_rebuilds_the_same_offer():
    offer = (await supplier().search(request()))[0]
    repriced = await supplier().price(offer.supplier_ref)
    assert repriced.id == offer.id
    assert repriced.total == offer.total


async def test_price_of_garbage_reference_is_unavailable():
    with pytest.raises(SupplierError) as err:
        await supplier().price("not-a-real-reference")
    assert err.value.code == "offer_unavailable"


async def test_unknown_airport_is_an_invalid_request():
    with pytest.raises(SupplierError) as err:
        await supplier().search(request(origin="XXX"))
    assert err.value.code == "invalid_request"
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run python -m pytest tests/offers/test_sandbox.py tests/reference/test_geo.py -q`
Expected: FAIL — missing modules.

- [ ] **Step 3: Implement geo helper and supplier base**

Create `backend/src/travelmind/reference/geo.py`:

```python
import math

EARTH_RADIUS_KM = 6371.0


def great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in kilometres."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    h = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))
```

Create `backend/src/travelmind/offers/suppliers/__init__.py` (empty) and `backend/src/travelmind/offers/suppliers/base.py`:

```python
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
```

- [ ] **Step 4: Implement the sandbox supplier**

Create `backend/src/travelmind/offers/suppliers/sandbox.py`:

```python
"""Deterministic test inventory for demos, tests and offline development.

Every offer is labelled SANDBOX. Schedules are synthetic and times ignore time zones;
prices follow a simple distance/cabin/demand curve converted at a fixed rate. Nothing here
is bookable and the UI says so.
"""

import base64
import hashlib
import json
import random
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from travelmind.offers.models import Baggage, FareConditions, FlightOffer, FlightSearchRequest, Segment, Slice
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import AirportLookup, SupplierError, offer_id
from travelmind.reference.geo import great_circle_km
from travelmind.reference.search import AirportRecord

SANDBOX_CODE = "sandbox"
OFFER_TTL = timedelta(minutes=30)
CRUISE_KMH = 800
GROUND_MINUTES = 35
LONG_HAUL_KM = 2500
NONSTOP_LIMIT_KM = 9000
LOW_COST_RANGE_KM = 3500
MAX_CARRIERS = 5
VARIANTS = 2  # a saver and a flexible fare per carrier
SANDBOX_INR_PER_USD = 83.5  # fixed on purpose: sandbox prices are illustrative, never quoted
DEPARTURE_HOURS = (5, 6, 7, 8, 9, 11, 13, 15, 17, 19, 21, 23)
CABIN_MULTIPLIER = {"economy": 1.0, "premium_economy": 1.7, "business": 3.4, "first": 5.5}


@dataclass(frozen=True)
class Carrier:
    code: str
    name: str
    hub: str
    low_cost: bool = False


CARRIERS: dict[str, Carrier] = {
    c.code: c
    for c in (
        Carrier("6E", "IndiGo", "DEL", low_cost=True),
        Carrier("QP", "Akasa Air", "BOM", low_cost=True),
        Carrier("AI", "Air India", "DEL"),
        Carrier("EK", "Emirates", "DXB"),
        Carrier("EY", "Etihad Airways", "AUH"),
        Carrier("QR", "Qatar Airways", "DOH"),
        Carrier("TK", "Turkish Airlines", "IST"),
        Carrier("BA", "British Airways", "LHR"),
        Carrier("LH", "Lufthansa", "FRA"),
        Carrier("AF", "Air France", "CDG"),
        Carrier("UA", "United Airlines", "EWR"),
        Carrier("SQ", "Singapore Airlines", "SIN"),
        Carrier("ZZ", "Sandbox Air", ""),
    )
}
HOME_CARRIERS: dict[str, tuple[str, ...]] = {
    "IN": ("AI", "6E", "QP"),
    "AE": ("EK", "EY"),
    "QA": ("QR",),
    "TR": ("TK",),
    "GB": ("BA",),
    "DE": ("LH",),
    "FR": ("AF",),
    "US": ("UA",),
    "SG": ("SQ",),
}
CONNECTORS = ("EK", "QR", "TK")


def _rng(*parts: object) -> random.Random:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def _encode_ref(data: dict[str, Any]) -> str:
    raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_ref(ref: str) -> dict[str, Any]:
    padded = ref + "=" * (-len(ref) % 4)
    data = json.loads(base64.urlsafe_b64decode(padded.encode()))
    if not isinstance(data, dict):
        raise ValueError("reference is not an object")
    return data


def _demand(days_out: int) -> float:
    if days_out < 7:
        return 1.6
    if days_out < 21:
        return 1.25
    if days_out < 60:
        return 1.05
    return 1.0


def _brand(carrier: Carrier, cabin: str, flexible: bool) -> str:
    if carrier.low_cost:
        return "Flexi" if flexible else "Saver"
    label = {"economy": "Economy", "premium_economy": "Premium", "business": "Business", "first": "First"}[cabin]
    return f"{label} {'Flex' if flexible else 'Classic'}"


class SandboxFlightSupplier:
    code = SANDBOX_CODE

    def __init__(self, lookup: AirportLookup, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._lookup = lookup
        self._clock = clock

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        origin = self._require(request.origin)
        destination = self._require(request.destination)
        fetched_at = self._clock()
        offers = [
            self._build(request, carrier, via, variant, fetched_at=fetched_at)
            for carrier, via in self._itineraries(origin, destination)
            if via is None or request.max_connections >= 1
            for variant in range(VARIANTS)
        ]
        return offers

    async def price(self, supplier_ref: str) -> FlightOffer:
        try:
            data = _decode_ref(supplier_ref)
            request = FlightSearchRequest(
                origin=data["o"],
                destination=data["d"],
                departure_date=date.fromisoformat(data["dd"]),
                return_date=date.fromisoformat(data["rd"]) if data["rd"] else None,
                adults=data["a"],
                children_ages=data["ch"],
                cabin=data["cab"],
                max_connections=data["mc"],
            )
            carrier = CARRIERS[data["car"]]
            via, variant = data["via"], int(data["v"])
        except (ValueError, KeyError, TypeError) as exc:
            raise SupplierError("offer_unavailable", "This offer can't be found any more. Run the search again.") from exc
        return self._build(request, carrier, via, variant, fetched_at=self._clock())

    def _require(self, code: str | None) -> AirportRecord:
        airport = self._lookup(code or "")
        if airport is None:
            raise SupplierError("invalid_request", f"Unknown airport code {code}.")
        return airport

    def _itineraries(self, origin: AirportRecord, destination: AirportRecord) -> list[tuple[Carrier, str | None]]:
        km = great_circle_km(origin.latitude, origin.longitude, destination.latitude, destination.longitude)
        domestic = origin.country_code == destination.country_code
        home = HOME_CARRIERS.get(origin.country_code, ()) + HOME_CARRIERS.get(destination.country_code, ())
        codes: list[str] = []
        for code in home:
            if code not in codes and (domestic or not CARRIERS[code].low_cost or km <= LOW_COST_RANGE_KM):
                codes.append(code)
        if not domestic and km > LONG_HAUL_KM:
            codes += [c for c in CONNECTORS if c not in codes]
        if not codes:
            codes = ["ZZ"]
        endpoints = {origin.iata_code, destination.iata_code}
        itineraries: list[tuple[Carrier, str | None]] = []
        for code in codes[:MAX_CARRIERS]:
            carrier = CARRIERS[code]
            nonstop = domestic or code == "ZZ" or carrier.hub in endpoints or (code in home and km <= NONSTOP_LIMIT_KM)
            via = None if nonstop or self._lookup(carrier.hub) is None else carrier.hub
            itineraries.append((carrier, via))
        return itineraries

    def _slice(
        self, start: AirportRecord, end: AirportRecord, day: date, carrier: Carrier, via: str | None, rng: random.Random
    ) -> tuple[Slice, float]:
        stops = [start, *([self._require(via)] if via else []), end]
        clock = datetime.combine(day, time(rng.choice(DEPARTURE_HOURS), rng.choice((0, 10, 20, 30, 40, 50))))
        segments: list[Segment] = []
        distance = 0.0
        for a, b in zip(stops, stops[1:], strict=False):
            km = great_circle_km(a.latitude, a.longitude, b.latitude, b.longitude)
            distance += km
            minutes = round(km / CRUISE_KMH * 60) + GROUND_MINUTES
            arrive = clock + timedelta(minutes=minutes)
            segments.append(
                Segment(
                    origin=a.iata_code,
                    destination=b.iata_code,
                    departing_at=clock,
                    arriving_at=arrive,
                    marketing_carrier=carrier.code,
                    marketing_carrier_name=carrier.name,
                    flight_number=str(rng.randint(100, 2999)),
                    operating_carrier=carrier.code,
                    duration_minutes=minutes,
                )
            )
            clock = arrive + timedelta(minutes=rng.choice((70, 95, 120, 150)))
        duration = int((segments[-1].arriving_at - segments[0].departing_at).total_seconds() // 60)
        return Slice(origin=start.iata_code, destination=end.iata_code, duration_minutes=duration, segments=segments), distance

    def _build(
        self, request: FlightSearchRequest, carrier: Carrier, via: str | None, variant: int, *, fetched_at: datetime
    ) -> FlightOffer:
        origin = self._require(request.origin)
        destination = self._require(request.destination)
        rng = _rng(
            "sandbox-offer",
            request.origin,
            request.destination,
            request.departure_date,
            request.return_date,
            request.cabin,
            carrier.code,
            via or "-",
            variant,
        )
        flexible = variant == 1
        brand = _brand(carrier, request.cabin, flexible)
        outbound, km = self._slice(origin, destination, request.departure_date, carrier, via, rng)
        slices = [outbound]
        if request.return_date is not None:
            inbound, km_back = self._slice(destination, origin, request.return_date, carrier, via, rng)
            slices.append(inbound)
            km += km_back
        slices = [s.model_copy(update={"fare_brand": brand}) for s in slices]

        days_out = (request.departure_date - fetched_at.date()).days
        per_adult_cents = (
            (4000 + 9 * km)
            * CABIN_MULTIPLIER[request.cabin]
            * _demand(days_out)
            * (0.85 if carrier.low_cost else 1.05)
            * (1.18 if flexible else 1.0)
            * rng.uniform(0.92, 1.1)
        )
        travellers = request.adults + sum(0.1 if age < 2 else 0.75 for age in request.children_ages)
        total_cents = per_adult_cents * travellers
        currency = "INR" if origin.country_code == "IN" else "USD"
        minor = round(total_cents * SANDBOX_INR_PER_USD / 100) * 100 if currency == "INR" else round(total_cents)
        base_minor = round(minor / 1.18)

        def money(amount: float) -> Money:
            return Money(amount_minor=round(amount), currency=currency)

        ref = _encode_ref(
            {
                "o": request.origin,
                "d": request.destination,
                "dd": request.departure_date.isoformat(),
                "rd": request.return_date.isoformat() if request.return_date else None,
                "cab": request.cabin,
                "a": request.adults,
                "ch": request.children_ages,
                "mc": request.max_connections,
                "car": carrier.code,
                "via": via,
                "v": variant,
            }
        )
        return FlightOffer(
            id=offer_id(SANDBOX_CODE, ref),
            supplier=SANDBOX_CODE,
            supplier_ref=ref,
            provenance="SANDBOX",
            total=money(minor),
            base=money(base_minor),
            tax=money(minor - base_minor),
            owner_carrier=carrier.code,
            owner_name=carrier.name,
            cabin=request.cabin,
            passenger_count=request.passenger_count,
            slices=slices,
            baggage=Baggage(
                checked=0 if carrier.low_cost and not flexible else (2 if request.cabin in ("business", "first") else 1),
                carry_on=1,
            ),
            conditions=FareConditions(
                refundable=flexible,
                refund_penalty=money(minor * 0.1) if flexible else None,
                changeable=True,
                change_penalty=None if flexible else money(minor * 0.05),
            ),
            fetched_at=fetched_at,
            expires_at=fetched_at + OFFER_TTL,
        )
```

- [ ] **Step 5: Run the tests and checks**

Run: `uv run python -m pytest tests/offers tests/reference -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass. (`test_passengers_scale_the_price` uses 1% tolerance because of whole-rupee rounding.)

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(offers): supplier protocol and deterministic sandbox flight inventory"
```

---

### Task 3: Duffel flight supplier

**Files:**
- Create: `backend/src/travelmind/offers/suppliers/duffel.py`, `backend/tests/offers/fixtures/duffel_offer_request.json`, `backend/tests/offers/fixtures/duffel_offer.json`
- Modify: `backend/pyproject.toml` (dev dependency `respx`)
- Test: `backend/tests/offers/test_duffel.py`

**Interfaces:**
- Consumes: `FlightSupplier` protocol, `SupplierError`, `offer_id`, models, `Money` (Tasks 1–2). Reference: `docs/research/2026-09-29-supplier-apis.md` (Duffel section).
- Produces: `DuffelFlightSupplier(token, *, supplier_timeout_ms=12000, http_timeout_s=30.0, base_url=DUFFEL_BASE_URL)` with `code = "duffel"`; `parse_iso_duration(value) -> int | None`. `live_mode=false` offers are `provenance="SANDBOX"`; live ones `LIVE`. `co2_kg_per_passenger` = `total_emissions_kg / passenger count` with `co2_source="supplier"`.

- [ ] **Step 1: Add respx and the fixtures**

```bash
cd /d/travel-rag-agent/backend
uv add --dev respx
```

Create `backend/tests/offers/fixtures/duffel_offer_request.json`:

```json
{
  "data": {
    "id": "orq_0000AUTEST",
    "live_mode": false,
    "offers": [
      {
        "id": "off_0000CONNECT",
        "live_mode": false,
        "total_amount": "612.40",
        "total_currency": "GBP",
        "base_amount": "480.00",
        "base_currency": "GBP",
        "tax_amount": "132.40",
        "tax_currency": "GBP",
        "total_emissions_kg": null,
        "expires_at": "2026-11-01T10:42:14.545Z",
        "owner": { "name": "Emirates", "iata_code": "EK" },
        "conditions": {
          "refund_before_departure": null,
          "change_before_departure": { "allowed": true, "penalty_amount": "75.00", "penalty_currency": "GBP" }
        },
        "passengers": [{ "id": "pas_1", "type": "adult" }, { "id": "pas_2", "age": 8 }],
        "slices": [
          {
            "fare_brand_name": "Saver",
            "duration": "P1DT1H5M",
            "origin": { "iata_code": "LHR" },
            "destination": { "iata_code": "SYD" },
            "segments": [
              {
                "origin": { "iata_code": "LHR" },
                "destination": { "iata_code": "DXB" },
                "departing_at": "2026-11-20T08:30:00",
                "arriving_at": "2026-11-20T19:25:00",
                "duration": "PT6H55M",
                "marketing_carrier": { "iata_code": "EK", "name": "Emirates" },
                "marketing_carrier_flight_number": "2",
                "operating_carrier": { "iata_code": "EK", "name": "Emirates" },
                "operating_carrier_flight_number": "2",
                "passengers": [
                  { "passenger_id": "pas_1", "cabin_class": "economy", "baggages": [{ "type": "checked", "quantity": 2 }, { "type": "carry_on", "quantity": 1 }] }
                ]
              },
              {
                "origin": { "iata_code": "DXB" },
                "destination": { "iata_code": "SYD" },
                "departing_at": "2026-11-20T21:45:00",
                "arriving_at": "2026-11-21T18:00:00",
                "duration": "PT14H15M",
                "marketing_carrier": { "iata_code": "EK", "name": "Emirates" },
                "marketing_carrier_flight_number": "414",
                "operating_carrier": { "iata_code": "EK", "name": "Emirates" },
                "operating_carrier_flight_number": "414",
                "passengers": [
                  { "passenger_id": "pas_1", "cabin_class": "economy", "baggages": [{ "type": "checked", "quantity": 2 }, { "type": "carry_on", "quantity": 1 }] }
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "off_0000NONSTOP",
        "live_mode": false,
        "total_amount": "1045.00",
        "total_currency": "GBP",
        "base_amount": "880.00",
        "base_currency": "GBP",
        "tax_amount": null,
        "tax_currency": null,
        "total_emissions_kg": "1840",
        "expires_at": "2026-11-01T10:42:14.545Z",
        "owner": { "name": "British Airways", "iata_code": "BA" },
        "conditions": {
          "refund_before_departure": { "allowed": true, "penalty_amount": "150.00", "penalty_currency": "GBP" },
          "change_before_departure": { "allowed": true, "penalty_amount": null, "penalty_currency": null }
        },
        "passengers": [{ "id": "pas_1", "type": "adult" }, { "id": "pas_2", "age": 8 }],
        "slices": [
          {
            "fare_brand_name": "Economy Flex",
            "duration": "PT22H5M",
            "origin": { "iata_code": "LHR" },
            "destination": { "iata_code": "SYD" },
            "segments": [
              {
                "origin": { "iata_code": "LHR" },
                "destination": { "iata_code": "SYD" },
                "departing_at": "2026-11-20T11:00:00",
                "arriving_at": "2026-11-21T19:05:00",
                "duration": "PT22H5M",
                "marketing_carrier": { "iata_code": "BA", "name": "British Airways" },
                "marketing_carrier_flight_number": "15",
                "operating_carrier": { "iata_code": "QF", "name": "Qantas" },
                "operating_carrier_flight_number": "2",
                "passengers": [
                  { "passenger_id": "pas_1", "cabin_class": "economy", "baggages": [{ "type": "checked", "quantity": 1 }] }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Create `backend/tests/offers/fixtures/duffel_offer.json` (the connecting offer re-priced upwards):

```json
{
  "data": {
    "id": "off_0000CONNECT",
    "live_mode": false,
    "total_amount": "640.10",
    "total_currency": "GBP",
    "base_amount": "500.00",
    "base_currency": "GBP",
    "tax_amount": "140.10",
    "tax_currency": "GBP",
    "total_emissions_kg": null,
    "expires_at": "2026-11-01T11:12:00Z",
    "owner": { "name": "Emirates", "iata_code": "EK" },
    "conditions": {},
    "passengers": [{ "id": "pas_1", "type": "adult" }, { "id": "pas_2", "age": 8 }],
    "slices": [
      {
        "fare_brand_name": "Saver",
        "duration": "P1DT1H5M",
        "origin": { "iata_code": "LHR" },
        "destination": { "iata_code": "SYD" },
        "segments": [
          {
            "origin": { "iata_code": "LHR" },
            "destination": { "iata_code": "SYD" },
            "departing_at": "2026-11-20T08:30:00",
            "arriving_at": "2026-11-21T18:00:00",
            "duration": "P1DT1H5M",
            "marketing_carrier": { "iata_code": "EK", "name": "Emirates" },
            "marketing_carrier_flight_number": "2"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/offers/test_duffel.py`:

```python
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from travelmind.offers.models import FlightSearchRequest
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError
from travelmind.offers.suppliers.duffel import DUFFEL_BASE_URL, DuffelFlightSupplier, parse_iso_duration

FIXTURES = Path(__file__).parent / "fixtures"
BASE = DUFFEL_BASE_URL  # tests use respx's `respx_mock` pytest fixture with full URLs


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def request() -> FlightSearchRequest:
    return FlightSearchRequest(
        origin="LHR",
        destination="SYD",
        departure_date=datetime.now(UTC).date() + timedelta(days=50),
        adults=1,
        children_ages=[8],
    )


def supplier() -> DuffelFlightSupplier:
    return DuffelFlightSupplier("duffel_test_abc", supplier_timeout_ms=9000)


def test_parse_iso_duration():
    assert parse_iso_duration("PT02H26M") == 146
    assert parse_iso_duration("P1DT1H5M") == 1505
    assert parse_iso_duration("PT45M") == 45
    assert parse_iso_duration(None) is None
    assert parse_iso_duration("garbage") is None


async def test_search_sends_the_documented_request(respx_mock):
    route = respx_mock.post(f"{BASE}/air/offer_requests").mock(return_value=httpx.Response(201, json=fixture("duffel_offer_request.json")))
    await supplier().search(request())
    sent = route.calls.last.request
    assert sent.headers["Authorization"] == "Bearer duffel_test_abc"
    assert sent.headers["Duffel-Version"] == "v2"
    assert sent.url.params["return_offers"] == "true"
    assert sent.url.params["supplier_timeout"] == "9000"
    body = json.loads(sent.content)["data"]
    assert body["slices"] == [{"origin": "LHR", "destination": "SYD", "departure_date": request().departure_date.isoformat()}]
    assert body["passengers"] == [{"type": "adult"}, {"age": 8}]
    assert body["cabin_class"] == "economy"
    assert body["max_connections"] == 1


async def test_offers_are_mapped_exactly(respx_mock):
    respx_mock.post(f"{BASE}/air/offer_requests").mock(return_value=httpx.Response(201, json=fixture("duffel_offer_request.json")))
    offers = await supplier().search(request())
    assert [o.supplier_ref for o in offers] == ["off_0000CONNECT", "off_0000NONSTOP"]  # cheapest first

    connect, nonstop = offers
    assert connect.id == "duffel~off_0000CONNECT"
    assert connect.total == Money(amount_minor=61240, currency="GBP")
    assert connect.tax == Money(amount_minor=13240, currency="GBP")
    assert connect.owner_carrier == "EK"
    assert connect.stops == 1
    assert connect.slices[0].duration_minutes == 1505
    assert connect.slices[0].segments[1].flight_number == "414"
    assert connect.slices[0].segments[0].departing_at == datetime(2026, 11, 20, 8, 30)
    assert (connect.baggage.checked, connect.baggage.carry_on) == (2, 1)
    assert connect.conditions.refundable is None
    assert connect.conditions.changeable is True
    assert connect.conditions.change_penalty == Money(amount_minor=7500, currency="GBP")
    assert connect.co2_kg_per_passenger is None
    assert connect.expires_at == datetime(2026, 11, 1, 10, 42, 14, 545000, tzinfo=UTC)
    assert connect.passenger_count == 2

    assert nonstop.tax is None
    assert nonstop.conditions.refundable is True
    assert nonstop.conditions.refund_penalty == Money(amount_minor=15000, currency="GBP")
    assert nonstop.conditions.change_penalty is None
    assert nonstop.slices[0].segments[0].operating_carrier == "QF"
    assert (nonstop.co2_kg_per_passenger, nonstop.co2_source) == (920, "supplier")


async def test_test_mode_offers_are_labelled_sandbox(respx_mock):
    respx_mock.post(f"{BASE}/air/offer_requests").mock(return_value=httpx.Response(201, json=fixture("duffel_offer_request.json")))
    assert {o.provenance for o in await supplier().search(request())} == {"SANDBOX"}


async def test_live_mode_offers_are_labelled_live(respx_mock):
    payload = fixture("duffel_offer_request.json")
    payload["data"]["live_mode"] = True
    for offer in payload["data"]["offers"]:
        offer["live_mode"] = True
    respx_mock.post(f"{BASE}/air/offer_requests").mock(return_value=httpx.Response(201, json=payload))
    assert {o.provenance for o in await supplier().search(request())} == {"LIVE"}


async def test_price_fetches_the_current_offer(respx_mock):
    route = respx_mock.get(f"{BASE}/air/offers/off_0000CONNECT").mock(return_value=httpx.Response(200, json=fixture("duffel_offer.json")))
    offer = await supplier().price("off_0000CONNECT")
    assert route.calls.last.request.url.params["return_available_services"] == "false"
    assert offer.total == Money(amount_minor=64010, currency="GBP")


def _error(status: int, type_: str, code: str) -> httpx.Response:
    return httpx.Response(status, json={"errors": [{"type": type_, "code": code, "title": "x", "message": "Upstream detail"}], "meta": {"status": status}})


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (_error(401, "authentication_error", "expired_access_token"), "auth"),
        (_error(429, "rate_limit_error", "rate_limit_exceeded"), "rate_limited"),
        (_error(422, "invalid_state_error", "offer_expired"), "offer_expired"),
        (_error(422, "airline_error", "offer_no_longer_available"), "offer_unavailable"),
        (_error(404, "invalid_request_error", "not_found"), "offer_unavailable"),
        (_error(422, "validation_error", "validation_required"), "invalid_request"),
        (_error(502, "airline_error", "airline_unknown"), "unavailable"),
        (httpx.Response(500, text="<html>oops</html>"), "unavailable"),
    ],
)
async def test_errors_become_supplier_errors(respx_mock, response, code):
    respx_mock.get(f"{BASE}/air/offers/off_x").mock(return_value=response)
    with pytest.raises(SupplierError) as err:
        await supplier().price("off_x")
    assert err.value.code == code
    assert "Upstream detail" not in err.value.message or code == "invalid_request"


async def test_timeouts_and_network_failures(respx_mock):
    respx_mock.post(f"{BASE}/air/offer_requests").mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(SupplierError) as err:
        await supplier().search(request())
    assert err.value.code == "timeout"

    respx_mock.post(f"{BASE}/air/offer_requests").mock(side_effect=httpx.ConnectError("down"))
    with pytest.raises(SupplierError) as err:
        await supplier().search(request())
    assert err.value.code == "unavailable"
```

- [ ] **Step 3: Run to verify they fail**

Run: `uv run python -m pytest tests/offers/test_duffel.py -q`
Expected: FAIL — `ModuleNotFoundError: ...suppliers.duffel`.

- [ ] **Step 4: Implement the Duffel supplier**

Create `backend/src/travelmind/offers/suppliers/duffel.py`:

```python
"""Duffel Flights API v2 adapter. Reference: docs/research/2026-09-29-supplier-apis.md."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
import structlog

from travelmind.offers.models import Baggage, FareConditions, FlightOffer, FlightSearchRequest, Provenance, Segment, Slice
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError, offer_id

DUFFEL_BASE_URL = "https://api.duffel.com"
DUFFEL_VERSION = "v2"
MAX_OFFERS = 60
_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+(?:\.\d+)?S)?)?$")
log = structlog.get_logger()


def parse_iso_duration(value: str | None) -> int | None:
    """ISO 8601 duration ("PT02H26M", "P1DT1H5M") → whole minutes."""
    if not value:
        return None
    match = _DURATION.match(value)
    if not match:
        return None
    days, hours, minutes = (int(g) if g else 0 for g in match.groups())
    return days * 1440 + hours * 60 + minutes


def _money(amount: str | None, currency: str | None) -> Money | None:
    if amount is None or currency is None:
        return None
    try:
        return Money.from_decimal(amount, currency)
    except (InvalidOperation, ValueError):
        return None


def _parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value)


class DuffelFlightSupplier:
    code = "duffel"

    def __init__(
        self,
        token: str,
        *,
        supplier_timeout_ms: int = 12000,
        http_timeout_s: float = 30.0,
        base_url: str = DUFFEL_BASE_URL,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._token = token
        self._supplier_timeout_ms = supplier_timeout_ms
        self._http_timeout_s = http_timeout_s
        self._base_url = base_url
        self._clock = clock

    async def search(self, request: FlightSearchRequest) -> list[FlightOffer]:
        slices = [{"origin": request.origin, "destination": request.destination, "departure_date": request.departure_date.isoformat()}]
        if request.return_date is not None:
            slices.append(
                {"origin": request.destination, "destination": request.origin, "departure_date": request.return_date.isoformat()}
            )
        passengers: list[dict[str, Any]] = [{"type": "adult"} for _ in range(request.adults)]
        passengers += [{"age": age} for age in request.children_ages]
        body = {
            "data": {
                "slices": slices,
                "passengers": passengers,
                "cabin_class": request.cabin,
                "max_connections": request.max_connections,
            }
        }
        params = {"return_offers": "true", "supplier_timeout": str(self._supplier_timeout_ms)}
        payload = await self._request("POST", "/air/offer_requests", params=params, json=body)
        data = payload.get("data") or {}
        live = bool(data.get("live_mode"))
        fetched_at = self._clock()
        offers = [self._map_offer(raw, live, fetched_at) for raw in data.get("offers") or []]
        offers.sort(key=lambda o: (o.total.currency, o.total.amount_minor))
        return offers[:MAX_OFFERS]

    async def price(self, supplier_ref: str) -> FlightOffer:
        payload = await self._request("GET", f"/air/offers/{supplier_ref}", params={"return_available_services": "false"})
        raw = payload.get("data") or {}
        return self._map_offer(raw, bool(raw.get("live_mode")), self._clock())

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Duffel-Version": DUFFEL_VERSION,
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "Content-Type": "application/json",
        }

    async def _request(
        self, method: str, path: str, *, params: dict[str, str], json: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(base_url=self._base_url, timeout=self._http_timeout_s) as client:
                response = await client.request(method, path, params=params, json=json, headers=self._headers())
        except httpx.TimeoutException as exc:
            raise SupplierError("timeout", "Duffel didn't answer in time.") from exc
        except httpx.HTTPError as exc:
            raise SupplierError("unavailable", "Couldn't reach Duffel.") from exc
        if response.status_code >= 400:
            raise self._error(response)
        try:
            body = response.json()
        except ValueError as exc:
            raise SupplierError("unavailable", "Duffel sent an unreadable response.") from exc
        return body if isinstance(body, dict) else {}

    @staticmethod
    def _error(response: httpx.Response) -> SupplierError:
        detail: dict[str, Any] = {}
        try:
            errors = response.json().get("errors") or []
            detail = errors[0] if errors else {}
        except (ValueError, AttributeError):
            detail = {}
        kind, code = detail.get("type"), detail.get("code")
        log.warning("duffel_error", status=response.status_code, type=kind, code=code)
        if response.status_code in (401, 403) or kind == "authentication_error":
            return SupplierError("auth", "Duffel rejected the access token. Check TM_DUFFEL_TOKEN.")
        if response.status_code == 429 or kind == "rate_limit_error":
            return SupplierError("rate_limited", "Duffel's rate limit was reached. Try again in a minute.")
        if code == "offer_expired" or kind == "invalid_state_error":
            return SupplierError("offer_expired", "This offer has expired. Search again for a fresh price.")
        if code in ("offer_no_longer_available", "not_found") or response.status_code == 404:
            return SupplierError("offer_unavailable", "This offer is no longer available. Search again.")
        if kind == "validation_error":
            message = detail.get("message") or "Duffel couldn't process this search."
            return SupplierError("invalid_request", f"Duffel couldn't process this search: {message}")
        return SupplierError("unavailable", "Duffel had a problem answering. Try again shortly.")

    def _map_offer(self, raw: dict[str, Any], live: bool, fetched_at: datetime) -> FlightOffer:
        currency = raw["total_currency"]
        total = Money.from_decimal(raw["total_amount"], currency)
        passengers = raw.get("passengers") or []
        passenger_count = max(len(passengers), 1)
        slices = [self._map_slice(s) for s in raw.get("slices") or []]
        owner = raw.get("owner") or {}
        first_segment = (raw.get("slices") or [{}])[0].get("segments", [{}])[0] if raw.get("slices") else {}
        segment_passenger = (first_segment.get("passengers") or [{}])[0] if first_segment else {}
        baggage = Baggage()
        if segment_passenger.get("baggages") is not None:
            counts = {"checked": 0, "carry_on": 0}
            for bag in segment_passenger["baggages"]:
                if bag.get("type") in counts:
                    counts[bag["type"]] += int(bag.get("quantity") or 0)
            baggage = Baggage(checked=counts["checked"], carry_on=counts["carry_on"])
        conditions = raw.get("conditions") or {}
        refund = conditions.get("refund_before_departure")
        change = conditions.get("change_before_departure")
        co2: int | None = None
        if raw.get("total_emissions_kg") is not None:
            try:
                # Duffel reports the whole offer; we store a per-passenger figure.
                co2 = round(Decimal(raw["total_emissions_kg"]) / passenger_count)
            except (InvalidOperation, ValueError):
                co2 = None
        expires = raw.get("expires_at")
        provenance: Provenance = "LIVE" if live else "SANDBOX"
        return FlightOffer(
            id=offer_id(self.code, raw["id"]),
            supplier=self.code,
            supplier_ref=raw["id"],
            provenance=provenance,
            total=total,
            base=_money(raw.get("base_amount"), raw.get("base_currency")),
            tax=_money(raw.get("tax_amount"), raw.get("tax_currency")),
            owner_carrier=owner.get("iata_code") or "??",
            owner_name=owner.get("name"),
            cabin=segment_passenger.get("cabin_class"),
            passenger_count=passenger_count,
            slices=slices,
            baggage=baggage,
            conditions=FareConditions(
                refundable=refund.get("allowed") if refund else None,
                refund_penalty=_money(refund.get("penalty_amount"), refund.get("penalty_currency")) if refund else None,
                changeable=change.get("allowed") if change else None,
                change_penalty=_money(change.get("penalty_amount"), change.get("penalty_currency")) if change else None,
            ),
            co2_kg_per_passenger=co2,
            co2_source="supplier" if co2 is not None else None,
            fetched_at=fetched_at,
            expires_at=datetime.fromisoformat(expires) if expires else None,
        )

    @staticmethod
    def _map_slice(raw: dict[str, Any]) -> Slice:
        segments = []
        for seg in raw.get("segments") or []:
            marketing = seg.get("marketing_carrier") or {}
            operating = seg.get("operating_carrier") or {}
            segments.append(
                Segment(
                    origin=seg["origin"]["iata_code"],
                    destination=seg["destination"]["iata_code"],
                    departing_at=_parse_time(seg["departing_at"]),
                    arriving_at=_parse_time(seg["arriving_at"]),
                    marketing_carrier=marketing.get("iata_code") or "??",
                    marketing_carrier_name=marketing.get("name"),
                    flight_number=seg.get("marketing_carrier_flight_number") or "",
                    operating_carrier=operating.get("iata_code"),
                    operating_flight_number=seg.get("operating_carrier_flight_number"),
                    duration_minutes=parse_iso_duration(seg.get("duration")),
                )
            )
        return Slice(
            origin=raw["origin"]["iata_code"],
            destination=raw["destination"]["iata_code"],
            duration_minutes=parse_iso_duration(raw.get("duration")),
            fare_brand=raw.get("fare_brand_name"),
            segments=segments,
        )
```

(`cabin=segment_passenger.get("cabin_class")` may be a value outside `Cabin`; if Duffel ever returns something else, map unknown values to `None` before constructing the model and add a test.)

- [ ] **Step 5: Run the tests and checks**

Run: `uv run python -m pytest tests/offers -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(offers): Duffel flight supplier with exact mapping, test-mode labelling and error handling"
```

---

### Task 4: Display-currency conversion (ECB reference rates)

**Files:**
- Create: `backend/src/travelmind/offers/fx.py`, `backend/tests/offers/fixtures/ecb_daily.xml`
- Modify: `backend/pyproject.toml` (dependency `defusedxml`)
- Test: `backend/tests/offers/test_fx.py`

**Interfaces:**
- Consumes: `Money` (Task 1); Redis client.
- Produces: `ECB_DAILY_URL`; `FxRates(as_of: date, rates: dict[str, Decimal])` (EUR-based, `EUR=1`) with `.convert(money, to_currency) -> Money | None` (same currency passes through; unknown currency → `None`); `parse_ecb_xml(xml: str) -> FxRates`; `async get_fx_rates(redis, *, enabled=True, url=ECB_DAILY_URL) -> FxRates | None` (Redis-cached 12 h under `fx:ecb:daily`; any failure → `None`); `display_currency_for(country_code: str) -> str` (`"INR"` for `IN`, else `"USD"`).

- [ ] **Step 1: Add the dependency and fixture**

```bash
cd /d/travel-rag-agent/backend
uv add defusedxml
uv add --dev types-defusedxml
```

(If `types-defusedxml` doesn't exist, skip it and add `defusedxml.*` to mypy's `ignore_missing_imports` — it is already global.)

Create `backend/tests/offers/fixtures/ecb_daily.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time="2026-09-28">
      <Cube currency="USD" rate="1.0850"/>
      <Cube currency="JPY" rate="160.12"/>
      <Cube currency="GBP" rate="0.84500"/>
      <Cube currency="INR" rate="90.4000"/>
    </Cube>
  </Cube>
</gesmes:Envelope>
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/offers/test_fx.py`:

```python
import os
from datetime import date
from decimal import Decimal
from pathlib import Path

import httpx
import respx
from redis.asyncio import Redis

from travelmind.offers.fx import ECB_DAILY_URL, display_currency_for, get_fx_rates, parse_ecb_xml
from travelmind.offers.money import Money

XML = (Path(__file__).parent / "fixtures" / "ecb_daily.xml").read_text(encoding="utf-8")


def test_parse_ecb_xml():
    rates = parse_ecb_xml(XML)
    assert rates.as_of == date(2026, 9, 28)
    assert rates.rates["EUR"] == Decimal(1)
    assert rates.rates["INR"] == Decimal("90.4000")


def test_convert_between_currencies():
    rates = parse_ecb_xml(XML)
    # 45.00 GBP → EUR 53.2544… → INR 4814.20
    assert rates.convert(Money(amount_minor=4500, currency="GBP"), "INR") == Money(amount_minor=481420, currency="INR")
    assert rates.convert(Money(amount_minor=100, currency="INR"), "INR") == Money(amount_minor=100, currency="INR")
    assert rates.convert(Money(amount_minor=100, currency="XYZ"), "INR") is None
    assert rates.convert(Money(amount_minor=100, currency="USD"), "JPY") == Money(amount_minor=148, currency="JPY")


def test_display_currency():
    assert display_currency_for("IN") == "INR"
    assert display_currency_for("GB") == "USD"


async def _redis() -> Redis:
    return Redis.from_url(os.environ["TM_REDIS_URL"])


@respx.mock
async def test_rates_are_fetched_once_then_cached():
    route = respx.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=XML))
    redis = await _redis()
    try:
        first = await get_fx_rates(redis)
        second = await get_fx_rates(redis)
    finally:
        await redis.aclose()
    assert first is not None and second is not None
    assert second.rates == first.rates
    assert route.call_count == 1


@respx.mock
async def test_failures_and_disabled_mean_no_rates():
    respx.get(ECB_DAILY_URL).mock(return_value=httpx.Response(503))
    redis = await _redis()
    try:
        assert await get_fx_rates(redis) is None
        assert await get_fx_rates(redis, enabled=False) is None
    finally:
        await redis.aclose()


@respx.mock
async def test_garbage_xml_means_no_rates():
    respx.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text="<html>maintenance</html>"))
    redis = await _redis()
    try:
        assert await get_fx_rates(redis) is None
    finally:
        await redis.aclose()
```

- [ ] **Step 3: Run to verify they fail**

Run: `uv run python -m pytest tests/offers/test_fx.py -q`
Expected: FAIL — missing module.

- [ ] **Step 4: Implement**

Create `backend/src/travelmind/offers/fx.py`:

```python
"""ECB euro reference rates, used only to show approximate converted prices ("≈ ₹")."""

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

import httpx
import structlog
from defusedxml import ElementTree
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.offers.money import Money

ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
CACHE_KEY = "fx:ecb:daily"
CACHE_TTL_SECONDS = 12 * 3600
_NS = "{http://www.ecb.int/vocabulary/2002-08-01/eurofxref}"
log = structlog.get_logger()


@dataclass(frozen=True)
class FxRates:
    as_of: date
    rates: dict[str, Decimal]  # units of currency per 1 EUR

    def convert(self, money: Money, to_currency: str) -> Money | None:
        target = to_currency.upper()
        if money.currency == target:
            return money
        source_rate, target_rate = self.rates.get(money.currency), self.rates.get(target)
        if not source_rate or not target_rate:
            return None
        return Money.from_decimal(money.to_decimal() / source_rate * target_rate, target)


def parse_ecb_xml(xml: str) -> FxRates:
    root = ElementTree.fromstring(xml)
    day = next((c for c in root.iter(f"{_NS}Cube") if c.get("time")), None)
    if day is None:
        raise ValueError("No dated Cube in ECB response")
    rates = {"EUR": Decimal(1)}
    for cube in day.iter(f"{_NS}Cube"):
        currency, rate = cube.get("currency"), cube.get("rate")
        if currency and rate:
            rates[currency] = Decimal(rate)
    return FxRates(as_of=date.fromisoformat(day.get("time") or ""), rates=rates)


def display_currency_for(country_code: str) -> str:
    return "INR" if country_code.upper() == "IN" else "USD"


def _dump(rates: FxRates) -> str:
    return json.dumps({"as_of": rates.as_of.isoformat(), "rates": {k: str(v) for k, v in rates.rates.items()}})


def _load(raw: bytes | str) -> FxRates:
    data = json.loads(raw)
    return FxRates(as_of=date.fromisoformat(data["as_of"]), rates={k: Decimal(v) for k, v in data["rates"].items()})


async def get_fx_rates(redis: Redis, *, enabled: bool = True, url: str = ECB_DAILY_URL) -> FxRates | None:
    if not enabled:
        return None
    try:
        cached = await redis.get(CACHE_KEY)
        if cached:
            return _load(cached)
    except (RedisError, ValueError, KeyError) as exc:
        log.warning("fx_cache_unavailable", error=str(exc))
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
        response.raise_for_status()
        rates = parse_ecb_xml(response.text)
    except (httpx.HTTPError, ValueError, InvalidOperation, ElementTree.ParseError) as exc:
        log.warning("fx_rates_unavailable", error=str(exc))
        return None
    try:
        await redis.set(CACHE_KEY, _dump(rates), ex=CACHE_TTL_SECONDS)
    except RedisError as exc:
        log.warning("fx_cache_unavailable", error=str(exc))
    return rates
```

(If `defusedxml.ElementTree.ParseError` isn't exported in the installed version, catch `xml.etree.ElementTree.ParseError` instead.)

- [ ] **Step 5: Run the tests and checks**

Run: `uv run python -m pytest tests/offers -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(offers): ECB reference rates for approximate display-currency conversion"
```

---

### Task 5: CO₂ per passenger (Google Travel Impact Model)

**Files:**
- Create: `backend/src/travelmind/offers/carbon.py`
- Test: `backend/tests/offers/offer_factory.py`, `backend/tests/offers/test_carbon.py`

**Interfaces:**
- Consumes: `FlightOffer`, `Segment`, `Slice` (Task 1). Reference: research doc, Google TIM section.
- Produces: `TimClient(api_key, redis, *, base_url=TIM_BASE_URL, timeout_s=8.0)` with `async enrich(offers, cabin) -> list[FlightOffer]`. Per-flight TIM data (every segment known) → `co2_source="google_tim"` and replaces a supplier figure; otherwise route-typical per segment → `"google_tim_typical"` (only for offers with no figure); otherwise unchanged. Results cached in Redis (`tim:f:*` 1 day, `tim:m:*` 7 days, including "no data" markers). Any HTTP failure → offers unchanged, nothing cached.
- Test helper `make_offer(segments=[(origin, destination, carrier, flight_number, iso_departure)], **overrides) -> FlightOffer`.

- [ ] **Step 1: Write the test helper and failing tests**

Create `backend/tests/offers/offer_factory.py`:

```python
from datetime import UTC, datetime, timedelta

from travelmind.offers.models import FlightOffer, Segment, Slice
from travelmind.offers.money import Money


def make_offer(
    segments: list[tuple[str, str, str, str, str]],
    *,
    offer_ref: str = "ref-1",
    supplier: str = "stub",
    total_minor: int = 500000,
    currency: str = "INR",
    provenance: str = "SANDBOX",
    **overrides: object,
) -> FlightOffer:
    legs = []
    for origin, destination, carrier, number, departing in segments:
        start = datetime.fromisoformat(departing)
        legs.append(
            Segment(
                origin=origin,
                destination=destination,
                departing_at=start,
                arriving_at=start + timedelta(hours=2),
                marketing_carrier=carrier,
                flight_number=number,
                operating_carrier=carrier,
                duration_minutes=120,
            )
        )
    fields: dict[str, object] = {
        "id": f"{supplier}~{offer_ref}",
        "supplier": supplier,
        "supplier_ref": offer_ref,
        "provenance": provenance,
        "total": Money(amount_minor=total_minor, currency=currency),
        "owner_carrier": segments[0][2],
        "passenger_count": 1,
        "slices": [Slice(origin=segments[0][0], destination=segments[-1][1], duration_minutes=120 * len(legs), segments=legs)],
        "fetched_at": datetime.now(UTC),
    } | overrides
    return FlightOffer.model_validate(fields)
```

Create `backend/tests/offers/test_carbon.py`:

```python
import json
import os

import httpx
from redis.asyncio import Redis

from tests.offers.offer_factory import make_offer
from travelmind.offers.carbon import TIM_BASE_URL, TimClient

FLIGHTS = f"{TIM_BASE_URL}/flights:computeFlightEmissions"
TYPICAL = f"{TIM_BASE_URL}/flights:computeTypicalFlightEmissions"


def grams(economy: int) -> dict:
    return {"economy": economy, "premiumEconomy": economy * 2, "business": economy * 3, "first": economy * 4}


def known_connection():
    return make_offer(
        [("LHR", "DXB", "EK", "2", "2026-11-20T08:30"), ("DXB", "SYD", "EK", "414", "2026-11-20T21:45")],
        offer_ref="known",
    )


def synthetic_nonstop():
    return make_offer([("DEL", "BOM", "6E", "2045", "2026-11-20T06:10")], offer_ref="synthetic")


async def redis_client() -> Redis:
    return Redis.from_url(os.environ["TM_REDIS_URL"])


async def test_known_flights_use_per_flight_emissions(respx_mock):
    route = respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(200, json={"flightEmissions": [{"emissionsGramsPerPax": grams(410_000)}, {"emissionsGramsPerPax": grams(820_000)}]})
    )
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([known_connection()], "economy")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (1230, "google_tim")
    sent = route.calls.last.request
    assert sent.url.params["key"] == "tim-key"
    body = json.loads(sent.content)["flights"]
    assert body[0] == {
        "origin": "LHR",
        "destination": "DXB",
        "operatingCarrierCode": "EK",
        "flightNumber": 2,
        "departureDate": {"year": 2026, "month": 11, "day": 20},
    }


async def test_unknown_flights_fall_back_to_route_typical(respx_mock):
    respx_mock.post(FLIGHTS).mock(return_value=httpx.Response(200, json={"flightEmissions": [{"flight": {}}]}))
    respx_mock.post(TYPICAL).mock(
        return_value=httpx.Response(
            200,
            json={"typicalFlightEmissions": [{"market": {"origin": "DEL", "destination": "BOM"}, "emissionsGramsPerPax": grams(98_600)}]},
        )
    )
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([synthetic_nonstop()], "business")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (296, "google_tim_typical")


async def test_supplier_figures_are_kept_unless_flight_data_exists(respx_mock):
    respx_mock.post(FLIGHTS).mock(return_value=httpx.Response(200, json={"flightEmissions": [{"flight": {}}]}))
    respx_mock.post(TYPICAL).mock(
        return_value=httpx.Response(200, json={"typicalFlightEmissions": [{"market": {"origin": "DEL", "destination": "BOM"}, "emissionsGramsPerPax": grams(98_600)}]})
    )
    supplied = synthetic_nonstop().model_copy(update={"co2_kg_per_passenger": 105, "co2_source": "supplier"})
    redis = await redis_client()
    try:
        [offer] = await TimClient("tim-key", redis).enrich([supplied], "economy")
    finally:
        await redis.aclose()
    assert (offer.co2_kg_per_passenger, offer.co2_source) == (105, "supplier")


async def test_results_are_cached(respx_mock):
    route = respx_mock.post(FLIGHTS).mock(
        return_value=httpx.Response(200, json={"flightEmissions": [{"emissionsGramsPerPax": grams(410_000)}, {"emissionsGramsPerPax": grams(820_000)}]})
    )
    redis = await redis_client()
    try:
        client = TimClient("tim-key", redis)
        await client.enrich([known_connection()], "economy")
        [offer] = await client.enrich([known_connection()], "economy")
    finally:
        await redis.aclose()
    assert route.call_count == 1
    assert offer.co2_source == "google_tim"


async def test_api_failures_leave_offers_untouched(respx_mock):
    respx_mock.post(FLIGHTS).mock(return_value=httpx.Response(403, json={"error": {"code": 403, "message": "API key not valid"}}))
    respx_mock.post(TYPICAL).mock(return_value=httpx.Response(503))
    redis = await redis_client()
    try:
        [offer] = await TimClient("bad-key", redis).enrich([synthetic_nonstop()], "economy")
    finally:
        await redis.aclose()
    assert offer.co2_kg_per_passenger is None and offer.co2_source is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run python -m pytest tests/offers/test_carbon.py -q`
Expected: FAIL — missing module.

- [ ] **Step 3: Implement**

Create `backend/src/travelmind/offers/carbon.py`:

```python
"""Per-passenger CO₂ from Google's Travel Impact Model (data: CC BY-SA 4.0 — attribute in the UI)."""

import json
from typing import Any

import httpx
import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.offers.models import FlightOffer, Segment

TIM_BASE_URL = "https://travelimpactmodel.googleapis.com/v1"
CABIN_FIELD = {"economy": "economy", "premium_economy": "premiumEconomy", "business": "business", "first": "first"}
FLIGHT_TTL_SECONDS = 24 * 3600
MARKET_TTL_SECONDS = 7 * 24 * 3600
BATCH = 1000
_NO_DATA = "none"
log = structlog.get_logger()

Grams = dict[str, int]


def _flight_key(segment: Segment) -> str | None:
    carrier = segment.operating_carrier or segment.marketing_carrier
    number = segment.operating_flight_number if segment.operating_carrier and segment.operating_flight_number else segment.flight_number
    if not carrier or not number or not number.isdigit():
        return None
    return f"{carrier}{int(number)}:{segment.origin}{segment.destination}:{segment.departing_at.date().isoformat()}"


def _market_key(segment: Segment) -> str:
    return f"{segment.origin}{segment.destination}"


class TimClient:
    def __init__(self, api_key: str, redis: Redis, *, base_url: str = TIM_BASE_URL, timeout_s: float = 8.0) -> None:
        self._api_key = api_key
        self._redis = redis
        self._base_url = base_url
        self._timeout_s = timeout_s

    async def enrich(self, offers: list[FlightOffer], cabin: str) -> list[FlightOffer]:
        field = CABIN_FIELD.get(cabin, "economy")
        candidates = [o for o in offers if o.co2_kg_per_passenger is None or o.co2_source == "supplier"]
        if not candidates:
            return offers
        segments = {id(s): s for o in candidates for sl in o.slices for s in sl.segments}
        flights = await self._flight_emissions([s for s in segments.values() if _flight_key(s)])
        needs_typical = [s for s in segments.values() if not (flights.get(_flight_key(s) or "") or {}).get(field)]
        markets = await self._typical_emissions(needs_typical) if needs_typical else {}

        enriched: list[FlightOffer] = []
        for offer in offers:
            if offer not in candidates:
                enriched.append(offer)
                continue
            legs = [s for sl in offer.slices for s in sl.segments]
            per_flight = [(flights.get(_flight_key(s) or "") or {}).get(field) for s in legs]
            if legs and all(per_flight):
                kg = round(sum(g for g in per_flight if g) / 1000)
                enriched.append(offer.model_copy(update={"co2_kg_per_passenger": kg, "co2_source": "google_tim"}))
                continue
            if offer.co2_source == "supplier":
                enriched.append(offer)
                continue
            typical = [(markets.get(_market_key(s)) or {}).get(field) for s in legs]
            if legs and all(typical):
                kg = round(sum(g for g in typical if g) / 1000)
                enriched.append(offer.model_copy(update={"co2_kg_per_passenger": kg, "co2_source": "google_tim_typical"}))
            else:
                enriched.append(offer)
        return enriched

    async def _cached(self, keys: list[str], prefix: str) -> dict[str, Grams | None]:
        found: dict[str, Grams | None] = {}
        if not keys:
            return found
        try:
            values = await self._redis.mget([f"{prefix}{k}" for k in keys])
        except RedisError as exc:
            log.warning("tim_cache_unavailable", error=str(exc))
            return found
        for key, raw in zip(keys, values, strict=True):
            if raw is not None:
                text = raw.decode() if isinstance(raw, bytes) else str(raw)
                found[key] = None if text == _NO_DATA else json.loads(text)
        return found

    async def _store(self, items: dict[str, Grams | None], prefix: str, ttl: int) -> None:
        if not items:
            return
        try:
            async with self._redis.pipeline(transaction=False) as pipe:
                for key, value in items.items():
                    pipe.set(f"{prefix}{key}", _NO_DATA if value is None else json.dumps(value), ex=ttl)
                await pipe.execute()
        except RedisError as exc:
            log.warning("tim_cache_unavailable", error=str(exc))

    async def _post(self, method: str, body: dict[str, Any]) -> dict[str, Any] | None:
        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                response = await client.post(f"{self._base_url}/flights:{method}", params={"key": self._api_key}, json=body)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("tim_unavailable", method=method, error=str(exc))
            return None
        return payload if isinstance(payload, dict) else None

    async def _flight_emissions(self, segments: list[Segment]) -> dict[str, Grams | None]:
        unique = {k: s for s in segments if (k := _flight_key(s))}
        results = await self._cached(list(unique), "tim:f:")
        missing = [k for k in unique if k not in results]
        for start in range(0, len(missing), BATCH):
            chunk = missing[start : start + BATCH]
            flights = []
            for key in chunk:
                seg = unique[key]
                number = seg.operating_flight_number if seg.operating_carrier and seg.operating_flight_number else seg.flight_number
                day = seg.departing_at.date()
                flights.append(
                    {
                        "origin": seg.origin,
                        "destination": seg.destination,
                        "operatingCarrierCode": seg.operating_carrier or seg.marketing_carrier,
                        "flightNumber": int(number),
                        "departureDate": {"year": day.year, "month": day.month, "day": day.day},
                    }
                )
            payload = await self._post("computeFlightEmissions", {"flights": flights})
            if payload is None:
                continue
            fresh: dict[str, Grams | None] = {}
            for key, item in zip(chunk, payload.get("flightEmissions") or [], strict=False):
                fresh[key] = item.get("emissionsGramsPerPax") or None
            results |= fresh
            await self._store(fresh, "tim:f:", FLIGHT_TTL_SECONDS)
        return results

    async def _typical_emissions(self, segments: list[Segment]) -> dict[str, Grams | None]:
        unique = {_market_key(s): s for s in segments}
        results = await self._cached(list(unique), "tim:m:")
        missing = [k for k in unique if k not in results]
        for start in range(0, len(missing), BATCH):
            chunk = missing[start : start + BATCH]
            markets = [{"origin": unique[k].origin, "destination": unique[k].destination} for k in chunk]
            payload = await self._post("computeTypicalFlightEmissions", {"markets": markets})
            if payload is None:
                continue
            fresh: dict[str, Grams | None] = {k: None for k in chunk}
            for item in payload.get("typicalFlightEmissions") or []:
                market = item.get("market") or {}
                key = f"{market.get('origin')}{market.get('destination')}"
                if key in fresh:
                    fresh[key] = item.get("emissionsGramsPerPax") or None
            results |= fresh
            await self._store(fresh, "tim:m:", MARKET_TTL_SECONDS)
        return results
```

- [ ] **Step 4: Run the tests and checks**

Run: `uv run python -m pytest tests/offers -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(offers): per-passenger CO2 from Google Travel Impact Model with route-typical fallback"
```

---

### Task 6: Search log, fare snapshots and fare intelligence

**Files:**
- Create: `backend/migrations/versions/0003_offers.py`, `backend/src/travelmind/offers/db_models.py`, `backend/src/travelmind/fareintel/__init__.py`, `backend/src/travelmind/fareintel/models.py`, `backend/src/travelmind/fareintel/service.py`, `backend/src/travelmind/fareintel/travelpayouts.py`
- Modify: `backend/migrations/env.py` (register the new models)
- Test: `backend/tests/fareintel/__init__.py`, `backend/tests/fareintel/test_baseline.py`, `backend/tests/fareintel/test_travelpayouts.py`

**Interfaces:**
- Consumes: `Base`, `utcnow`, `tenant_rls_statements` (Plan 1); `Money` (Task 1).
- Produces:
  - Tables: `flight_searches` (tenant, RLS) and `fare_snapshots` (global market data; app role may only INSERT/SELECT).
  - `FlightSearchLog(id, agency_id, user_id, origin, destination, departure_date, return_date, adults, children, cabin, offer_count, display_currency, cheapest_minor, created_at)`; `FareSnapshot(id, observed_at, origin, destination, departure_date, days_to_departure, cabin, carrier, stops, total_minor, currency, provenance, source)`
  - `fareintel.service`: `MIN_SAMPLES = 8`, `WINDOW_DAYS = 45`, `DTD_TOLERANCE = 10`, `Family = Literal["market","sandbox"]`, `PROVENANCES: dict[Family, tuple[str, ...]]`, `Baseline(family, currency, sample_size, p25_minor, median_minor, p75_minor, window_days)`, `Insight(signal: Literal["good","typical","high"], delta_pct: float, message: str)`, `async compute_baseline(db, *, origin, destination, cabin, currency, days_to_departure, family) -> Baseline | None`, `assess(price_minor, baseline, days_to_departure) -> Insight`
  - `fareintel.travelpayouts`: `TP_PRICES_URL`, `async seed_route(db, redis, *, token, origin, destination, departure_date, currency, market) -> int` (adds `CACHED` economy snapshots once per route/month/currency per 24 h; failures add nothing)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/fareintel/__init__.py` (empty) and `backend/tests/fareintel/test_baseline.py`:

```python
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import update
from sqlalchemy.exc import DBAPIError

from travelmind.db import get_sessionmaker
from travelmind.fareintel.models import FareSnapshot
from travelmind.fareintel.service import Baseline, assess, compute_baseline

TODAY = datetime.now(UTC).date()


async def add(totals: list[int], *, provenance: str = "LIVE", days_to_departure: int = 30, age_days: int = 0,
              currency: str = "INR", cabin: str = "economy") -> None:
    async with get_sessionmaker()() as db:
        db.add_all(
            FareSnapshot(
                observed_at=datetime.now(UTC) - timedelta(days=age_days),
                origin="DEL",
                destination="BOM",
                departure_date=TODAY + timedelta(days=days_to_departure),
                days_to_departure=days_to_departure,
                cabin=cabin,
                carrier="AI",
                stops=0,
                total_minor=t,
                currency=currency,
                provenance=provenance,
                source="test",
            )
            for t in totals
        )
        await db.commit()


async def baseline(**changes) -> Baseline | None:
    fields = {"origin": "DEL", "destination": "BOM", "cabin": "economy", "currency": "INR", "days_to_departure": 30, "family": "market"} | changes
    async with get_sessionmaker()() as db:
        return await compute_baseline(db, **fields)


async def test_no_baseline_until_enough_fares_are_seen():
    await add([1000 * i for i in range(1, 8)])
    assert await baseline() is None


async def test_percentiles_of_matching_fares():
    await add([1000 * i for i in range(1, 11)])
    result = await baseline()
    assert result is not None
    assert (result.sample_size, result.p25_minor, result.median_minor, result.p75_minor) == (10, 3250, 5500, 7750)


async def test_sandbox_fares_never_shape_the_market_baseline():
    await add([1000] * 10, provenance="SANDBOX")
    assert await baseline(family="market") is None
    sandbox = await baseline(family="sandbox")
    assert sandbox is not None and sandbox.median_minor == 1000


async def test_cached_prices_count_as_market_data():
    await add([2000] * 5, provenance="LIVE")
    await add([4000] * 5, provenance="CACHED")
    result = await baseline()
    assert result is not None and result.sample_size == 10


async def test_old_or_far_off_observations_are_ignored():
    await add([1000] * 10, age_days=60)
    await add([1000] * 10, days_to_departure=90)
    await add([1000] * 10, currency="USD")
    await add([1000] * 10, cabin="business")
    assert await baseline() is None


def test_assess_signals():
    base = Baseline(family="market", currency="INR", sample_size=20, p25_minor=4000, median_minor=5000, p75_minor=6000)
    good = assess(3800, base, 30)
    assert good.signal == "good" and good.delta_pct == -24.0 and "Good time to book" in good.message
    assert assess(5100, base, 30).signal == "typical"
    high_far = assess(6500, base, 45)
    assert high_far.signal == "high" and "consider waiting" in high_far.message
    high_near = assess(6500, base, 10)
    assert high_near.signal == "high" and "rarely fall" in high_near.message


async def test_snapshots_are_append_only_for_the_app():
    await add([1000])
    async with get_sessionmaker()() as db:
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(update(FareSnapshot).values(total_minor=1))
```

Create `backend/tests/fareintel/test_travelpayouts.py`:

```python
import os
from datetime import UTC, datetime, timedelta

import httpx
from redis.asyncio import Redis
from sqlalchemy import func, select

from travelmind.db import get_sessionmaker
from travelmind.fareintel.models import FareSnapshot
from travelmind.fareintel.travelpayouts import TP_PRICES_URL, seed_route

DEPART = datetime.now(UTC).date() + timedelta(days=40)


def payload() -> dict:
    day = DEPART.isoformat()
    past = (datetime.now(UTC).date() - timedelta(days=2)).isoformat()
    return {
        "success": True,
        "currency": "inr",
        "data": [
            {"price": 4210, "airline": "6E", "flight_number": "2045", "departure_at": f"{day}T06:10:00+05:30", "transfers": 0},
            {"price": 5120, "airline": "AI", "flight_number": "865", "departure_at": f"{day}T09:00:00+05:30", "transfers": 0},
            {"price": 3999, "airline": "QP", "flight_number": "1101", "departure_at": f"{past}T09:00:00+05:30", "transfers": 0},
            {"price": "n/a", "airline": "SG", "departure_at": f"{day}T11:00:00+05:30"},
        ],
    }


async def seed(redis: Redis) -> int:
    async with get_sessionmaker()() as db:
        added = await seed_route(
            db, redis, token="tp-token", origin="DEL", destination="BOM", departure_date=DEPART, currency="INR", market="in"
        )
        await db.commit()
        return added


async def count() -> int:
    async with get_sessionmaker()() as db:
        return await db.scalar(select(func.count()).select_from(FareSnapshot).where(FareSnapshot.provenance == "CACHED")) or 0


async def test_seeds_cached_fares_once_per_day(respx_mock):
    route = respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(200, json=payload()))
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        assert await seed(redis) == 2  # past departure and non-numeric price are skipped
        assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert await count() == 2
    assert route.call_count == 1
    sent = route.calls.last.request
    assert sent.headers["X-Access-Token"] == "tp-token"
    assert sent.url.params["currency"] == "inr"
    assert sent.url.params["market"] == "in"
    assert sent.url.params["departure_at"] == DEPART.strftime("%Y-%m")


async def test_failures_add_nothing(respx_mock):
    respx_mock.get(TP_PRICES_URL).mock(return_value=httpx.Response(500))
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        assert await seed(redis) == 0
    finally:
        await redis.aclose()
    assert await count() == 0
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run python -m pytest tests/fareintel -q`
Expected: FAIL — missing modules.

- [ ] **Step 3: Migration and models**

Create `backend/migrations/versions/0003_offers.py`:

```python
"""flight search log (tenant) and fare snapshots (global market data)

Revision ID: 0003_offers
Revises: 0002_reference
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from travelmind.db import tenant_rls_statements

revision: str = "0003_offers"
down_revision: str | None = "0002_reference"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "flight_searches",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("origin", sa.String(3), nullable=False),
        sa.Column("destination", sa.String(3), nullable=False),
        sa.Column("departure_date", sa.Date, nullable=False),
        sa.Column("return_date", sa.Date, nullable=True),
        sa.Column("adults", sa.SmallInteger, nullable=False),
        sa.Column("children", sa.SmallInteger, nullable=False),
        sa.Column("cabin", sa.String(20), nullable=False),
        sa.Column("offer_count", sa.Integer, nullable=False),
        sa.Column("display_currency", sa.String(3), nullable=False),
        sa.Column("cheapest_minor", sa.BigInteger, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_flight_searches_agency_created", "flight_searches", ["agency_id", "created_at"])
    for statement in tenant_rls_statements("flight_searches"):
        op.execute(statement)

    op.create_table(
        "fare_snapshots",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("origin", sa.String(3), nullable=False),
        sa.Column("destination", sa.String(3), nullable=False),
        sa.Column("departure_date", sa.Date, nullable=False),
        sa.Column("days_to_departure", sa.Integer, nullable=False),
        sa.Column("cabin", sa.String(20), nullable=False),
        sa.Column("carrier", sa.String(3), nullable=True),
        sa.Column("stops", sa.SmallInteger, nullable=True),
        sa.Column("total_minor", sa.BigInteger, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("provenance", sa.String(10), nullable=False),
        sa.Column("source", sa.String(30), nullable=False),
        sa.CheckConstraint("provenance IN ('LIVE', 'CACHED', 'SANDBOX')", name="ck_fare_snapshots_provenance"),
    )
    op.create_index(
        "ix_fare_snapshots_route", "fare_snapshots", ["origin", "destination", "cabin", "currency", "observed_at"]
    )
    # Market data is append-only for the application.
    op.execute("REVOKE UPDATE, DELETE ON fare_snapshots FROM travelmind_app")


def downgrade() -> None:
    op.drop_table("fare_snapshots")
    op.drop_table("flight_searches")
```

Create `backend/src/travelmind/offers/db_models.py`:

```python
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base, utcnow


class FlightSearchLog(Base):
    """One row per flight search an agency runs (tenant data, RLS)."""

    __tablename__ = "flight_searches"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    origin: Mapped[str] = mapped_column(String(3))
    destination: Mapped[str] = mapped_column(String(3))
    departure_date: Mapped[date] = mapped_column(Date)
    return_date: Mapped[date | None] = mapped_column(Date)
    adults: Mapped[int] = mapped_column(SmallInteger)
    children: Mapped[int] = mapped_column(SmallInteger)
    cabin: Mapped[str] = mapped_column(String(20))
    offer_count: Mapped[int]
    display_currency: Mapped[str] = mapped_column(String(3))
    cheapest_minor: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
```

Create `backend/src/travelmind/fareintel/__init__.py` (empty) and `backend/src/travelmind/fareintel/models.py`:

```python
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Identity, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base, utcnow


class FareSnapshot(Base):
    """A fare observed in the market (global, append-only). Amounts are in `currency` minor units."""

    __tablename__ = "fare_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    origin: Mapped[str] = mapped_column(String(3))
    destination: Mapped[str] = mapped_column(String(3))
    departure_date: Mapped[date] = mapped_column(Date)
    days_to_departure: Mapped[int]
    cabin: Mapped[str] = mapped_column(String(20))
    carrier: Mapped[str | None] = mapped_column(String(3))
    stops: Mapped[int | None] = mapped_column(SmallInteger)
    total_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    provenance: Mapped[str] = mapped_column(String(10))
    source: Mapped[str] = mapped_column(String(30))
```

In `backend/migrations/env.py`, register the models next to the other model imports:

```python
import travelmind.fareintel.models  # noqa: F401
import travelmind.offers.db_models  # noqa: F401
```

- [ ] **Step 4: Baseline service and Travelpayouts seeding**

Create `backend/src/travelmind/fareintel/service.py`:

```python
"""Typical fares for a route and booking window, and what a price means against them."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

MIN_SAMPLES = 8
WINDOW_DAYS = 45
DTD_TOLERANCE = 10
WAIT_THRESHOLD_DAYS = 21

Family = Literal["market", "sandbox"]
PROVENANCES: dict[Family, tuple[str, ...]] = {"market": ("LIVE", "CACHED"), "sandbox": ("SANDBOX",)}

_BASELINE_SQL = text(
    """
    SELECT count(*) AS n,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY total_minor) AS p25,
           percentile_cont(0.50) WITHIN GROUP (ORDER BY total_minor) AS p50,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY total_minor) AS p75
    FROM fare_snapshots
    WHERE origin = :origin AND destination = :destination AND cabin = :cabin AND currency = :currency
      AND provenance = ANY(:provenances)
      AND observed_at >= now() - make_interval(days => :window)
      AND abs(days_to_departure - :dtd) <= :tolerance
    """
)


@dataclass(frozen=True)
class Baseline:
    family: Family
    currency: str
    sample_size: int
    p25_minor: int
    median_minor: int
    p75_minor: int
    window_days: int = WINDOW_DAYS


@dataclass(frozen=True)
class Insight:
    signal: Literal["good", "typical", "high"]
    delta_pct: float
    message: str


async def compute_baseline(
    db: AsyncSession,
    *,
    origin: str,
    destination: str,
    cabin: str,
    currency: str,
    days_to_departure: int,
    family: Family,
) -> Baseline | None:
    row = (
        await db.execute(
            _BASELINE_SQL,
            {
                "origin": origin,
                "destination": destination,
                "cabin": cabin,
                "currency": currency,
                "provenances": list(PROVENANCES[family]),
                "window": WINDOW_DAYS,
                "dtd": days_to_departure,
                "tolerance": DTD_TOLERANCE,
            },
        )
    ).one()
    if row.n < MIN_SAMPLES:
        return None
    return Baseline(
        family=family,
        currency=currency,
        sample_size=int(row.n),
        p25_minor=round(row.p25),
        median_minor=round(row.p50),
        p75_minor=round(row.p75),
    )


def assess(price_minor: int, baseline: Baseline, days_to_departure: int) -> Insight:
    delta = round((price_minor - baseline.median_minor) / baseline.median_minor * 100, 1)
    seen = f"the median of {baseline.sample_size} fares seen for this route"
    if price_minor <= baseline.p25_minor:
        return Insight("good", delta, f"{abs(delta):.0f}% under {seen}. Good time to book.")
    if price_minor >= baseline.p75_minor:
        if days_to_departure > WAIT_THRESHOLD_DAYS:
            return Insight("high", delta, f"{delta:.0f}% over {seen}. Prices this far out often dip — consider waiting.")
        return Insight("high", delta, f"{delta:.0f}% over {seen}, but departure is close — prices rarely fall now.")
    return Insight("typical", delta, f"Around the typical price for this route and booking window ({delta:+.0f}%).")
```

Create `backend/src/travelmind/fareintel/travelpayouts.py`:

```python
"""Seed fare history with Travelpayouts cached prices (indications only — never bookable)."""

from datetime import UTC, date, datetime

import httpx
import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.fareintel.models import FareSnapshot
from travelmind.offers.money import Money

TP_PRICES_URL = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"
SEED_TTL_SECONDS = 24 * 3600
log = structlog.get_logger()


async def seed_route(
    db: AsyncSession,
    redis: Redis,
    *,
    token: str,
    origin: str,
    destination: str,
    departure_date: date,
    currency: str,
    market: str,
) -> int:
    month = departure_date.strftime("%Y-%m")
    key = f"tp:seed:{origin}{destination}:{month}:{currency}"
    try:
        if await redis.exists(key):
            return 0
    except RedisError as exc:
        log.warning("travelpayouts_cache_unavailable", error=str(exc))
        return 0
    params = {
        "origin": origin,
        "destination": destination,
        "departure_at": month,
        "one_way": "true",
        "currency": currency.lower(),
        "market": market,
        "limit": "100",
        "sorting": "price",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(TP_PRICES_URL, params=params, headers={"X-Access-Token": token})
        response.raise_for_status()
        items = response.json().get("data") or []
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        log.warning("travelpayouts_unavailable", error=str(exc))
        return 0

    today = datetime.now(UTC).date()
    rows: list[FareSnapshot] = []
    for item in items:
        price, departing = item.get("price"), item.get("departure_at")
        if not isinstance(price, int | float) or isinstance(price, bool) or not isinstance(departing, str):
            continue
        try:
            day = datetime.fromisoformat(departing).date()
        except ValueError:
            continue
        days_out = (day - today).days
        if days_out < 0:
            continue
        rows.append(
            FareSnapshot(
                origin=origin,
                destination=destination,
                departure_date=day,
                days_to_departure=days_out,
                cabin="economy",
                carrier=(item.get("airline") or None),
                stops=item.get("transfers") if isinstance(item.get("transfers"), int) else None,
                total_minor=Money.from_decimal(price, currency).amount_minor,
                currency=currency,
                provenance="CACHED",
                source="travelpayouts",
            )
        )
    db.add_all(rows)
    await db.flush()
    try:
        await redis.set(key, "1", ex=SEED_TTL_SECONDS)
    except RedisError as exc:
        log.warning("travelpayouts_cache_unavailable", error=str(exc))
    return len(rows)
```

- [ ] **Step 5: Run the tests and checks**

Run: `uv run python -m pytest -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass, including the Plan 1 architecture tests (the catalog guard now also checks `flight_searches`). Then migrate the dev DB: `uv run python -m alembic upgrade head`.

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(fareintel): search log, append-only fare snapshots, route baselines and Travelpayouts seeding"
```

---

### Task 7: Flight search, re-price and supplier status API

**Files:**
- Create: `backend/src/travelmind/offers/registry.py`, `backend/src/travelmind/offers/search.py`, `backend/src/travelmind/offers/cache.py`, `backend/src/travelmind/offers/router.py`
- Modify: `backend/src/travelmind/main.py` (include `flights_router`, `suppliers_router`), `backend/src/travelmind/offers/models.py` (computed fields), `backend/tests/conftest.py` (`airports` fixture)
- Test: `backend/tests/offers/test_search_api.py`

**Interfaces:**
- Consumes: everything from Tasks 1–6; `get_airport_index` (Plan 1); `AuthedUser`, `DbSession`, `RedisClient`, `LoginRateLimiter`, `bind_tenant` (tenant already bound by `AuthedUser`).
- Produces:
  - `flight_suppliers(settings, lookup) -> list[FlightSupplier]` (sandbox when enabled, Duffel when `duffel_token` set)
  - `SourceStatus(supplier, status, offer_count=0, latency_ms=0, message=None)`, `async fan_out(suppliers, request, timeout_s) -> tuple[list[FlightOffer], list[SourceStatus]]`, `rank(offers, display) -> list[FlightOffer]`
  - `async remember_offers(redis, agency_id, offers)`, `async recall_offer(redis, agency_id, offer_id) -> FlightOffer | None`
  - HTTP (all require sign-in):
    - `POST /api/v1/flights/search` body `FlightSearchRequest` → `{search_id, display_currency, fx_as_of, baseline, sources: [{supplier, status, offer_count, latency_ms, message}], offers: [FlightOffer + stops + total_duration_minutes + display_total + insight]}`; 422 unknown airport; 429 rate limit; 503 no suppliers
    - `POST /api/v1/flights/offers/{offer_id}/price` → `{offer, price_changed, previous_total}`; 404 not in this agency's cache; 410 expired/unavailable; 409 supplier gone; 502 other supplier errors
    - `GET /api/v1/suppliers` → `[{code, name, kind, connected, mode, detail}]` (never secrets)

- [ ] **Step 1: Make stop counts and durations part of the JSON**

The frontend needs `stops` and `total_duration_minutes`. In `backend/src/travelmind/offers/models.py`, import `computed_field` from pydantic and turn the three properties into computed fields:

```python
    @computed_field  # type: ignore[prop-decorator]
    @property
    def stops(self) -> int:
        ...
```

Apply that decorator to `Slice.stops`, `FlightOffer.stops` and `FlightOffer.total_duration_minutes` (bodies unchanged). Run `uv run python -m pytest tests/offers -q` — still green.

- [ ] **Step 2: Test fixtures and failing tests**

Append an `airports` fixture to the bottom of `backend/tests/conftest.py` (shared by `tests/offers` and, in Task 8, `tests/hotels`):

```python
@pytest.fixture
async def airports():
    """Load the reference fixture airports (DEL, BOM, GOI, GOX, GOA, GRU, …) and a fresh index."""
    from tests.reference.data import fixture_text
    from travelmind.reference.importer import load_reference_data, parse_airports, parse_countries
    from travelmind.reference.service import reset_airport_index

    reset_airport_index()
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    try:
        await load_reference_data(
            engine, parse_countries(fixture_text("countries.csv")), parse_airports(fixture_text("airports.csv"))
        )
    finally:
        await engine.dispose()
    yield
    reset_airport_index()
```

(Imports are local because this conftest sets environment variables before importing application code.)

Create `backend/tests/offers/test_search_api.py`:

```python
import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from tests.helpers import exec_as_tenant, make_client, signup
from tests.offers.offer_factory import make_offer
from travelmind.config import get_settings
from travelmind.offers import router as offers_router
from travelmind.offers.fx import ECB_DAILY_URL
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError
from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier

SEARCH = "/api/v1/flights/search"
ECB_XML = (Path(__file__).parent / "fixtures" / "ecb_daily.xml").read_text(encoding="utf-8")


def trip(**changes) -> dict:
    day = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
    return {"origin": "DEL", "destination": "BOM", "departure_date": day} | changes


class StubSupplier:
    def __init__(self, code: str, offers=None, *, error: SupplierError | None = None, delay: float = 0, price=None):
        self.code = code
        self._offers = offers or []
        self._error = error
        self._delay = delay
        self._price = price

    async def search(self, request):
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._error:
            raise self._error
        return self._offers

    async def price(self, supplier_ref):
        if isinstance(self._price, SupplierError):
            raise self._price
        return self._price


def use_suppliers(monkeypatch, *extra):
    def factory(settings, lookup):
        return [SandboxFlightSupplier(lookup), *extra]

    monkeypatch.setattr(offers_router, "flight_suppliers", factory)


async def test_search_requires_sign_in(client, airports):
    assert (await client.post(SEARCH, json=trip())).status_code == 401


async def test_sandbox_search_returns_labelled_sorted_offers(client, airports):
    await signup(client)
    r = await client.post(SEARCH, json=trip())
    assert r.status_code == 200
    body = r.json()
    assert body["display_currency"] == "INR"
    assert body["sources"] == [
        {"supplier": "sandbox", "status": "ok", "offer_count": len(body["offers"]), "latency_ms": body["sources"][0]["latency_ms"], "message": None}
    ]
    prices = [o["display_total"]["amount_minor"] for o in body["offers"]]
    assert prices == sorted(prices)
    first = body["offers"][0]
    assert first["provenance"] == "SANDBOX"
    assert first["display_total"] == first["total"]
    assert first["stops"] == 0 and first["total_duration_minutes"] > 0
    assert body["baseline"] is None and first["insight"] is None


async def test_repeat_searches_build_a_baseline(client, airports):
    await signup(client)
    for _ in range(2):
        await client.post(SEARCH, json=trip())
    body = (await client.post(SEARCH, json=trip())).json()
    assert body["baseline"]["family"] == "sandbox"
    assert body["baseline"]["sample_size"] >= 8
    assert body["offers"][0]["insight"]["signal"] in {"good", "typical", "high"}


async def test_round_trips_are_not_compared_with_one_way_history(client, airports):
    await signup(client)
    for _ in range(3):
        await client.post(SEARCH, json=trip())
    back = (datetime.now(UTC).date() + timedelta(days=35)).isoformat()
    body = (await client.post(SEARCH, json=trip(return_date=back))).json()
    assert body["baseline"] is None


async def test_searches_are_logged_for_the_agency_only(client, app, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    await client.post(SEARCH, json=trip())
    async with make_client(app) as other:
        other_agency = (await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")).json()["agency"]["id"]
    assert await exec_as_tenant(agency, "SELECT origin, destination FROM flight_searches") == [("DEL", "BOM")]
    assert await exec_as_tenant(other_agency, "SELECT count(*) FROM flight_searches") == [(0,)]


async def test_unknown_airports_and_impossible_trips(client, airports):
    await signup(client)
    unknown = await client.post(SEARCH, json=trip(origin="XXX"))
    assert unknown.status_code == 422 and unknown.json()["detail"] == "Unknown airport code XXX."
    same = await client.post(SEARCH, json=trip(destination="DEL"))
    assert same.status_code == 422
    assert "must be different airports" in same.json()["errors"][0]["message"]


async def test_searches_are_rate_limited_per_agency(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_max_per_minute", 2)
    await signup(client)
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    blocked = await client.post(SEARCH, json=trip())
    assert blocked.status_code == 429
    assert "Too many searches" in blocked.json()["detail"]


async def test_a_failing_supplier_doesnt_sink_the_search(client, airports, monkeypatch):
    use_suppliers(monkeypatch, StubSupplier("broken", error=SupplierError("unavailable", "Broken Air is down.")))
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    statuses = {s["supplier"]: s for s in body["sources"]}
    assert statuses["sandbox"]["status"] == "ok"
    assert statuses["broken"] == {**statuses["broken"], "status": "error", "offer_count": 0, "message": "Broken Air is down."}
    assert body["offers"]


async def test_a_slow_supplier_times_out_alone(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "search_timeout_seconds", 0.3)
    use_suppliers(monkeypatch, StubSupplier("slow", delay=5))
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    slow = next(s for s in body["sources"] if s["supplier"] == "slow")
    assert slow["status"] == "timeout" and "0.3" in slow["message"]
    assert body["offers"]


async def test_no_suppliers_is_a_plain_503(client, airports, monkeypatch):
    monkeypatch.setattr(offers_router, "flight_suppliers", lambda settings, lookup: [])
    await signup(client)
    r = await client.post(SEARCH, json=trip())
    assert r.status_code == 503
    assert "No flight suppliers are connected" in r.json()["detail"]


async def test_mixed_currencies_sort_by_display_price(client, airports, monkeypatch, respx_mock):
    respx_mock.get(ECB_DAILY_URL).mock(return_value=httpx.Response(200, text=ECB_XML))
    monkeypatch.setattr(get_settings(), "fx_enabled", True)
    cheap_usd = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="usd", total_minor=1000, currency="USD")
    monkeypatch.setattr(offers_router, "flight_suppliers", lambda settings, lookup: [SandboxFlightSupplier(lookup), StubSupplier("stub", [cheap_usd])])
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    first = body["offers"][0]
    assert first["id"] == "stub~usd"
    assert first["total"] == {"amount_minor": 1000, "currency": "USD"}
    assert first["display_total"] == {"amount_minor": 83318, "currency": "INR"}  # 10.00 USD → €9.2166 → ₹833.18
    assert body["fx_as_of"] == "2026-09-28"


async def test_without_rates_foreign_prices_are_not_converted(client, airports, monkeypatch):
    usd = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="usd", total_minor=1000, currency="USD")
    use_suppliers(monkeypatch, StubSupplier("stub", [usd]))
    await signup(client)
    body = (await client.post(SEARCH, json=trip())).json()
    foreign = next(o for o in body["offers"] if o["id"] == "stub~usd")
    assert foreign["display_total"] is None
    assert body["offers"][-1]["id"] == "stub~usd"  # unconverted prices sort after comparable ones


async def test_reprice_confirms_an_unchanged_price(client, airports):
    await signup(client)
    offer = (await client.post(SEARCH, json=trip())).json()["offers"][0]
    r = await client.post(f"/api/v1/flights/offers/{offer['id']}/price")
    assert r.status_code == 200
    assert r.json()["price_changed"] is False
    assert r.json()["offer"]["total"] == offer["total"]


async def test_reprice_reports_a_changed_price(client, airports, monkeypatch):
    original = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="moving", total_minor=500000)
    moved = original.model_copy(update={"total": Money(amount_minor=530000, currency="INR")})
    use_suppliers(monkeypatch, StubSupplier("stub", [original], price=moved))
    await signup(client)
    await client.post(SEARCH, json=trip())
    body = (await client.post("/api/v1/flights/offers/stub~moving/price")).json()
    assert body["price_changed"] is True
    assert body["previous_total"] == {"amount_minor": 500000, "currency": "INR"}
    assert body["offer"]["total"] == {"amount_minor": 530000, "currency": "INR"}


async def test_reprice_of_an_expired_offer(client, airports, monkeypatch):
    offer = make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref="old")
    use_suppliers(monkeypatch, StubSupplier("stub", [offer], price=SupplierError("offer_expired", "This offer has expired. Search again for a fresh price.")))
    await signup(client)
    await client.post(SEARCH, json=trip())
    r = await client.post("/api/v1/flights/offers/stub~old/price")
    assert r.status_code == 410
    assert r.json()["detail"] == "This offer has expired. Search again for a fresh price."


async def test_offers_are_cached_per_agency(client, app, airports):
    await signup(client)
    offer_id = (await client.post(SEARCH, json=trip())).json()["offers"][0]["id"]
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        r = await other.post(f"/api/v1/flights/offers/{offer_id}/price")
    assert r.status_code == 404
    assert r.json()["detail"] == "This offer is no longer available. Run the search again."


async def test_supplier_status_never_exposes_secrets(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "duffel_token", "duffel_test_supersecret")
    await signup(client)
    r = await client.get("/api/v1/suppliers")
    assert r.status_code == 200
    statuses = {s["code"]: s for s in r.json()}
    assert statuses["duffel"]["connected"] is True and statuses["duffel"]["mode"] == "test"
    assert statuses["sandbox"]["connected"] is True
    assert statuses["liteapi"]["connected"] is False
    assert "supersecret" not in r.text


@pytest.mark.parametrize("path", ["/api/v1/suppliers"])
async def test_supplier_status_requires_sign_in(client, path):
    assert (await client.get(path)).status_code == 401
```

- [ ] **Step 3: Run to verify they fail**

Run: `uv run python -m pytest tests/offers/test_search_api.py -q`
Expected: FAIL — 404s (routes don't exist) / import errors.

- [ ] **Step 4: Registry, fan-out and offer cache**

Create `backend/src/travelmind/offers/registry.py`:

```python
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
            DuffelFlightSupplier(settings.duffel_token, supplier_timeout_ms=settings.duffel_supplier_timeout_ms)
        )
    return suppliers
```

Create `backend/src/travelmind/offers/search.py`:

```python
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


async def _run(supplier: FlightSupplier, request: FlightSearchRequest, timeout_s: float) -> tuple[list[FlightOffer], SourceStatus]:
    started = time.monotonic()

    def elapsed() -> int:
        return round((time.monotonic() - started) * 1000)

    try:
        offers = await asyncio.wait_for(supplier.search(request), timeout=timeout_s)
    except TimeoutError:
        return [], SourceStatus(supplier.code, "timeout", 0, elapsed(), f"No answer within {timeout_s:g}s.")
    except SupplierError as exc:
        return [], SourceStatus(supplier.code, "error", 0, elapsed(), exc.message)
    except Exception:
        log.exception("supplier_failed", supplier=supplier.code)
        return [], SourceStatus(supplier.code, "error", 0, elapsed(), "This supplier failed unexpectedly.")
    return offers, SourceStatus(supplier.code, "ok", len(offers), elapsed(), None)


async def fan_out(
    suppliers: Sequence[FlightSupplier], request: FlightSearchRequest, timeout_s: float
) -> tuple[list[FlightOffer], list[SourceStatus]]:
    results = await asyncio.gather(*(_run(s, request, timeout_s) for s in suppliers))
    offers = [offer for batch, _ in results for offer in batch]
    return offers, [status for _, status in results]


def rank(offers: list[FlightOffer], display: Callable[[FlightOffer], Money | None]) -> list[FlightOffer]:
    """Cheapest first by display price; offers that can't be converted go last, grouped by currency."""

    def key(offer: FlightOffer) -> tuple[int, str, int, int, int]:
        shown = display(offer)
        duration = offer.total_duration_minutes or 10**6
        if shown is not None:
            return (0, "", shown.amount_minor, duration, offer.stops)
        return (1, offer.total.currency, offer.total.amount_minor, duration, offer.stops)

    return sorted(offers, key=key)
```

Create `backend/src/travelmind/offers/cache.py`:

```python
"""Recently returned offers, kept per agency so re-pricing never crosses tenants."""

from collections.abc import Iterable
from datetime import UTC, datetime
from uuid import UUID

import structlog
from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.offers.models import FlightOffer

DEFAULT_TTL_SECONDS = 1800
MAX_TTL_SECONDS = 7200
MIN_TTL_SECONDS = 60
log = structlog.get_logger()


def _key(agency_id: UUID, offer_id: str) -> str:
    return f"offer:{agency_id}:{offer_id}"


def _ttl(offer: FlightOffer) -> int:
    if offer.expires_at is None:
        return DEFAULT_TTL_SECONDS
    seconds = int((offer.expires_at - datetime.now(UTC)).total_seconds())
    return max(MIN_TTL_SECONDS, min(MAX_TTL_SECONDS, seconds))


async def remember_offers(redis: Redis, agency_id: UUID, offers: Iterable[FlightOffer]) -> None:
    try:
        async with redis.pipeline(transaction=False) as pipe:
            for offer in offers:
                pipe.set(_key(agency_id, offer.id), offer.model_dump_json(), ex=_ttl(offer))
            await pipe.execute()
    except RedisError as exc:
        log.warning("offer_cache_unavailable", error=str(exc))


async def recall_offer(redis: Redis, agency_id: UUID, offer_id: str) -> FlightOffer | None:
    try:
        raw = await redis.get(_key(agency_id, offer_id))
    except RedisError as exc:
        log.warning("offer_cache_unavailable", error=str(exc))
        return None
    if raw is None:
        return None
    try:
        return FlightOffer.model_validate_json(raw)
    except ValidationError:
        return None
```

(`model_validate_json` ignores the computed `stops`/`total_duration_minutes` keys in the stored JSON because models ignore extra fields by default.)

- [ ] **Step 5: The router**

Create `backend/src/travelmind/offers/router.py`:

```python
from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel

from travelmind.cache import RedisClient
from travelmind.config import Settings, get_settings
from travelmind.db import DbSession
from travelmind.fareintel.models import FareSnapshot
from travelmind.fareintel.service import PROVENANCES, Baseline, Family, Insight, assess, compute_baseline
from travelmind.fareintel.travelpayouts import seed_route
from travelmind.identity.deps import AuthedUser
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.offers.cache import recall_offer, remember_offers
from travelmind.offers.carbon import TimClient
from travelmind.offers.db_models import FlightSearchLog
from travelmind.offers.fx import FxRates, display_currency_for, get_fx_rates
from travelmind.offers.models import FlightOffer, FlightSearchRequest
from travelmind.offers.money import Money
from travelmind.offers.registry import flight_suppliers
from travelmind.offers.search import fan_out, rank
from travelmind.offers.suppliers.base import SupplierError
from travelmind.reference.service import get_airport_index

log = structlog.get_logger()
flights_router = APIRouter(prefix="/api/v1/flights", tags=["flights"])
suppliers_router = APIRouter(prefix="/api/v1/suppliers", tags=["suppliers"])


class InsightOut(BaseModel):
    signal: Literal["good", "typical", "high"]
    delta_pct: float
    message: str


class BaselineOut(BaseModel):
    family: Family
    currency: str
    sample_size: int
    p25_minor: int
    median_minor: int
    p75_minor: int
    window_days: int


class OfferView(FlightOffer):
    display_total: Money | None = None
    insight: InsightOut | None = None


class SourceStatusOut(BaseModel):
    supplier: str
    status: str
    offer_count: int
    latency_ms: int
    message: str | None


class FlightSearchResponse(BaseModel):
    search_id: UUID
    display_currency: str
    fx_as_of: date | None
    baseline: BaselineOut | None
    sources: list[SourceStatusOut]
    offers: list[OfferView]


class RepriceResponse(BaseModel):
    offer: OfferView
    price_changed: bool
    previous_total: Money


class SupplierStatusOut(BaseModel):
    code: str
    name: str
    kind: Literal["flights", "hotels", "emissions", "price_history", "exchange_rates"]
    connected: bool
    mode: Literal["live", "test", "sandbox"] | None
    detail: str


def _display(offer: FlightOffer, currency: str, fx: FxRates | None) -> Money | None:
    if offer.total.currency == currency:
        return offer.total
    return fx.convert(offer.total, currency) if fx else None


def _view(offer: FlightOffer, shown: Money | None, insight: Insight | None) -> OfferView:
    return OfferView.model_validate(
        offer.model_dump()
        | {
            "display_total": shown,
            "insight": InsightOut(signal=insight.signal, delta_pct=insight.delta_pct, message=insight.message) if insight else None,
        }
    )


@flights_router.post("/search")
async def search_flights_route(
    body: FlightSearchRequest, current: AuthedUser, db: DbSession, redis: RedisClient
) -> FlightSearchResponse:
    settings = get_settings()
    limiter = LoginRateLimiter(redis, settings.search_max_per_minute, 60)
    if not await limiter.hit(f"rl:search:{current.agency_id}"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many searches in a minute. Please wait a moment and try again."
        )
    index = await get_airport_index(db)
    for code in (body.origin, body.destination):
        if index.get(code) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown airport code {code}.")
    origin = index.get(body.origin)
    if origin is None:  # unreachable; narrows the type
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown airport code {body.origin}.")
    suppliers = flight_suppliers(settings, index.get)
    if not suppliers:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No flight suppliers are connected yet. Add a supplier key or enable the sandbox.",
        )

    offers, sources = await fan_out(suppliers, body, settings.search_timeout_seconds)
    if settings.google_tim_api_key and offers:
        offers = await TimClient(settings.google_tim_api_key, redis).enrich(offers, body.cabin)

    currency = display_currency_for(origin.country_code)
    fx = await get_fx_rates(redis, enabled=settings.fx_enabled)
    one_way = body.return_date is None
    days_out = (body.departure_date - datetime.now(UTC).date()).days
    family: Family = "market" if any(o.provenance == "LIVE" for o in offers) else "sandbox"

    if one_way and family == "market" and settings.travelpayouts_token and body.cabin == "economy":
        try:
            await seed_route(
                db,
                redis,
                token=settings.travelpayouts_token,
                origin=body.origin,
                destination=body.destination,
                departure_date=body.departure_date,
                currency=currency,
                market=origin.country_code.lower(),
            )
        except Exception:
            log.exception("travelpayouts_seed_failed")

    baseline: Baseline | None = None
    if one_way:
        baseline = await compute_baseline(
            db,
            origin=body.origin,
            destination=body.destination,
            cabin=body.cabin,
            currency=currency,
            days_to_departure=days_out,
            family=family,
        )

    ranked = rank(offers, lambda o: _display(o, currency, fx))
    views: list[OfferView] = []
    for offer in ranked:
        shown = _display(offer, currency, fx)
        comparable = baseline is not None and shown is not None and offer.provenance in PROVENANCES[family]
        insight = assess(shown.amount_minor, baseline, days_out) if comparable and shown and baseline else None
        views.append(_view(offer, shown, insight))

    if one_way:
        db.add_all(
            FareSnapshot(
                origin=body.origin,
                destination=body.destination,
                departure_date=body.departure_date,
                days_to_departure=days_out,
                cabin=body.cabin,
                carrier=v.owner_carrier[:3],
                stops=v.stops,
                total_minor=v.display_total.amount_minor,
                currency=currency,
                provenance=v.provenance,
                source=v.supplier[:30],
            )
            for v in views
            if v.display_total is not None
        )
    cheapest = next((v.display_total.amount_minor for v in views if v.display_total), None)
    log_row = FlightSearchLog(
        agency_id=current.agency_id,
        user_id=current.id,
        origin=body.origin,
        destination=body.destination,
        departure_date=body.departure_date,
        return_date=body.return_date,
        adults=body.adults,
        children=len(body.children_ages),
        cabin=body.cabin,
        offer_count=len(views),
        display_currency=currency,
        cheapest_minor=cheapest,
    )
    db.add(log_row)
    await db.commit()
    await remember_offers(redis, current.agency_id, offers)

    return FlightSearchResponse(
        search_id=log_row.id,
        display_currency=currency,
        fx_as_of=fx.as_of if fx else None,
        baseline=BaselineOut(**baseline.__dict__) if baseline else None,
        sources=[SourceStatusOut(**s.__dict__) for s in sources],
        offers=views,
    )


@flights_router.post("/offers/{offer_id}/price")
async def reprice_offer_route(
    offer_id: Annotated[str, Path(max_length=1000)], current: AuthedUser, db: DbSession, redis: RedisClient
) -> RepriceResponse:
    cached = await recall_offer(redis, current.agency_id, offer_id)
    if cached is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This offer is no longer available. Run the search again.")
    settings = get_settings()
    index = await get_airport_index(db)
    supplier = next((s for s in flight_suppliers(settings, index.get) if s.code == cached.supplier), None)
    if supplier is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "The supplier for this offer is no longer connected.")
    try:
        fresh = await supplier.price(cached.supplier_ref)
    except SupplierError as exc:
        gone = exc.code in ("offer_expired", "offer_unavailable")
        raise HTTPException(status.HTTP_410_GONE if gone else status.HTTP_502_BAD_GATEWAY, exc.message) from None
    if fresh.co2_kg_per_passenger is None and cached.co2_kg_per_passenger is not None:
        fresh = fresh.model_copy(update={"co2_kg_per_passenger": cached.co2_kg_per_passenger, "co2_source": cached.co2_source})
    origin = index.get(fresh.slices[0].origin) if fresh.slices else None
    currency = display_currency_for(origin.country_code) if origin else fresh.total.currency
    fx = await get_fx_rates(redis, enabled=settings.fx_enabled)
    await remember_offers(redis, current.agency_id, [fresh])
    return RepriceResponse(
        offer=_view(fresh, _display(fresh, currency, fx), None),
        price_changed=fresh.total != cached.total,
        previous_total=cached.total,
    )


def supplier_statuses(settings: Settings) -> list[SupplierStatusOut]:
    duffel_mode = ("test" if settings.duffel_token.startswith("duffel_test_") else "live") if settings.duffel_token else None
    lite_mode = ("test" if settings.liteapi_key.startswith("sand_") else "live") if settings.liteapi_key else None
    return [
        SupplierStatusOut(code="duffel", name="Duffel", kind="flights", connected=bool(settings.duffel_token), mode=duffel_mode,
                          detail="Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN."),
        SupplierStatusOut(code="sandbox", name="Sandbox inventory", kind="flights", connected=settings.sandbox_supplier_enabled,
                          mode="sandbox" if settings.sandbox_supplier_enabled else None,
                          detail="Deterministic test flights for demos and development. Never bookable."),
        SupplierStatusOut(code="liteapi", name="LiteAPI", kind="hotels", connected=bool(settings.liteapi_key), mode=lite_mode,
                          detail="Hotel rates worldwide. Set TM_LITEAPI_KEY."),
        SupplierStatusOut(code="google_tim", name="Google Travel Impact Model", kind="emissions",
                          connected=bool(settings.google_tim_api_key), mode="live" if settings.google_tim_api_key else None,
                          detail="Per-flight CO₂ estimates. Set TM_GOOGLE_TIM_API_KEY."),
        SupplierStatusOut(code="travelpayouts", name="Travelpayouts", kind="price_history",
                          connected=bool(settings.travelpayouts_token), mode="live" if settings.travelpayouts_token else None,
                          detail="Cached market prices that seed fare history (indications only). Set TM_TRAVELPAYOUTS_TOKEN."),
        SupplierStatusOut(code="ecb", name="ECB reference rates", kind="exchange_rates", connected=settings.fx_enabled,
                          mode="live" if settings.fx_enabled else None,
                          detail="Daily euro reference rates for approximate converted prices."),
    ]


@suppliers_router.get("")
async def list_suppliers_route(_current: AuthedUser) -> list[SupplierStatusOut]:
    return supplier_statuses(get_settings())
```

(Run `uv run ruff format .` afterwards — the long `SupplierStatusOut(...)` lines will be reflowed.)

In `backend/src/travelmind/main.py`, import `flights_router, suppliers_router` from `travelmind.offers.router` and include both after `reference_router`.

- [ ] **Step 6: Run the tests and checks**

Run: `uv run python -m pytest -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass.

- [ ] **Step 7: Smoke-test against the dev database**

Start the API on 8011 (`uv run python -m uvicorn travelmind.main:create_app --factory --port 8011`), sign up a throwaway user with curl, run `POST /api/v1/flights/search` DEL→BOM 30 days out and LHR→JFK, then re-price the first offer. Record trimmed responses in the report and stop the server.

- [ ] **Step 8: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(offers): fan-out flight search with partial results, display currency, insights, re-pricing and supplier status"
```

---

### Task 8: Hotel search (LiteAPI)

**Files:**
- Create: `backend/src/travelmind/hotels/__init__.py`, `backend/src/travelmind/hotels/models.py`, `backend/src/travelmind/hotels/liteapi.py`, `backend/src/travelmind/hotels/router.py`, `backend/tests/hotels/fixtures/liteapi_rates.json`
- Modify: `backend/src/travelmind/main.py` (include `hotels_router`)
- Test: `backend/tests/hotels/__init__.py`, `backend/tests/hotels/test_liteapi.py`, `backend/tests/hotels/test_hotels_api.py`

**Interfaces:**
- Consumes: `Money`, `IataCode`, `Provenance`, `SupplierError`, `display_currency_for`, `get_fx_rates`, `SourceStatusOut` (Tasks 1–7); airport index.
- Produces:
  - `RoomRequest(adults=2, children_ages=[])`, `HotelSearchRequest(destination, checkin, checkout, rooms=[RoomRequest()], radius_km=15)` (checkin today..+360 days, checkout after checkin, ≤ 30 nights) with `.nights`
  - `HotelOffer(id, supplier, provenance, hotel_id, name, stars, rating, address, photo_url, room_name, board, total, refundable, free_cancellation_until, nights, fetched_at)`
  - `LiteApiHotelSupplier(api_key, *, base_url=LITEAPI_BASE_URL, http_timeout_s=15.0)` with `code = "liteapi"` and `async search(request, *, latitude, longitude, currency, guest_nationality="IN") -> list[HotelOffer]`
  - HTTP `POST /api/v1/hotels/search` → `{display_currency, nights, sources: [SourceStatusOut], offers: [HotelOffer + display_total]}`; without a key the single source is `not_configured`.

- [ ] **Step 1: Fixture and failing tests**

Create `backend/tests/hotels/__init__.py` (empty) and `backend/tests/hotels/fixtures/liteapi_rates.json`:

```json
{
  "data": [
    {
      "hotelId": "lp1897",
      "roomTypes": [
        {
          "offerId": "offer-king",
          "offerRetailRate": { "amount": 9420.5, "currency": "INR" },
          "rates": [
            {
              "rateId": "r1",
              "name": "Deluxe King Room",
              "boardType": "BB",
              "boardName": "Bed & Breakfast",
              "retailRate": { "total": [{ "amount": 9420.5, "currency": "INR" }] },
              "cancellationPolicies": {
                "refundableTag": "RFN",
                "cancelPolicyInfos": [{ "cancelTime": "2026-11-18 12:00:00", "amount": 9420.5, "currency": "INR", "type": "amount", "timezone": "GMT" }]
              }
            }
          ]
        },
        {
          "offerId": "offer-suite",
          "offerRetailRate": { "amount": 15800, "currency": "INR" },
          "rates": [{ "rateId": "r2", "name": "Suite", "boardType": "RO", "boardName": "Room Only", "retailRate": { "total": [{ "amount": 15800, "currency": "INR" }] }, "cancellationPolicies": { "refundableTag": "NRFN", "cancelPolicyInfos": [] } }]
        }
      ]
    },
    {
      "hotelId": "lp2044",
      "roomTypes": [
        {
          "offerId": "offer-twin",
          "offerRetailRate": { "amount": 6100, "currency": "INR" },
          "rates": [{ "rateId": "r3", "name": "Standard Twin", "boardType": "RO", "boardName": "Room Only", "retailRate": { "total": [{ "amount": 6100, "currency": "INR" }] }, "cancellationPolicies": { "refundableTag": "NRFN", "cancelPolicyInfos": [] } }]
        }
      ]
    }
  ],
  "sandbox": true,
  "hotels": [
    { "id": "lp1897", "name": "Harbour View Mumbai", "address": "12 Marine Drive, Mumbai", "stars": 5, "rating": 8.9, "main_photo": "https://static.example/lp1897.jpg" },
    { "id": "lp2044", "name": "Airport Lodge Andheri", "address": "Andheri East, Mumbai", "stars": 3, "rating": 7.4, "main_photo": null }
  ]
}
```

Create `backend/tests/hotels/test_liteapi.py`:

```python
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from travelmind.hotels.liteapi import LITEAPI_BASE_URL, LiteApiHotelSupplier
from travelmind.hotels.models import HotelSearchRequest, RoomRequest
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError

RATES = f"{LITEAPI_BASE_URL}/hotels/rates"
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "liteapi_rates.json").read_text(encoding="utf-8"))
TODAY = datetime.now(UTC).date()


def request() -> HotelSearchRequest:
    return HotelSearchRequest(
        destination="BOM",
        checkin=TODAY + timedelta(days=30),
        checkout=TODAY + timedelta(days=32),
        rooms=[RoomRequest(adults=2, children_ages=[6])],
    )


async def search(key: str = "sand_abc"):
    return await LiteApiHotelSupplier(key).search(request(), latitude=19.0887, longitude=72.8679, currency="INR")


async def test_sends_the_documented_request(respx_mock):
    route = respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    await search()
    sent = route.calls.last.request
    assert sent.headers["X-API-Key"] == "sand_abc"
    body = json.loads(sent.content)
    assert body["occupancies"] == [{"adults": 2, "children": [6]}]
    assert "rooms" not in body
    assert (body["latitude"], body["longitude"], body["radius"]) == (19.0887, 72.8679, 15000)
    assert (body["currency"], body["guestNationality"], body["includeHotelData"]) == ("INR", "IN", True)
    assert body["checkin"] == request().checkin.isoformat()


async def test_maps_the_cheapest_room_per_hotel(respx_mock):
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=FIXTURE))
    offers = await search()
    assert [o.hotel_id for o in offers] == ["lp2044", "lp1897"]  # cheapest first
    lodge, harbour = offers
    assert harbour.name == "Harbour View Mumbai" and harbour.stars == 5 and harbour.rating == 8.9
    assert harbour.room_name == "Deluxe King Room" and harbour.board == "Bed & Breakfast"
    assert harbour.total == Money(amount_minor=942050, currency="INR")
    assert harbour.refundable is True and harbour.free_cancellation_until == "2026-11-18 12:00:00 GMT"
    assert harbour.photo_url == "https://static.example/lp1897.jpg"
    assert harbour.provenance == "SANDBOX" and harbour.nights == 2
    assert lodge.refundable is False and lodge.free_cancellation_until is None and lodge.photo_url is None


async def test_production_keys_are_live(respx_mock):
    payload = FIXTURE | {"sandbox": False}
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json=payload))
    assert {o.provenance for o in await search("prod_key")} == {"LIVE"}


async def test_no_availability_is_an_empty_result(respx_mock):
    respx_mock.post(RATES).mock(return_value=httpx.Response(200, json={"error": {"code": 2001, "message": "no availability found"}}))
    assert await search() == []


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(401, json={"error": {"code": 401, "message": "Unauthorized"}}), "auth"),
        (httpx.Response(429, json={"error": {"code": 429, "message": "Too many requests"}}), "rate_limited"),
        (httpx.Response(200, json={"error": {"code": 5000, "message": "internal"}}), "unavailable"),
        (httpx.Response(502, text="bad gateway"), "unavailable"),
    ],
)
async def test_errors(respx_mock, response, code):
    respx_mock.post(RATES).mock(return_value=response)
    with pytest.raises(SupplierError) as err:
        await search()
    assert err.value.code == code


async def test_timeouts(respx_mock):
    respx_mock.post(RATES).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(SupplierError) as err:
        await search()
    assert err.value.code == "timeout"


@pytest.mark.parametrize(
    ("checkin", "checkout", "message"),
    [(-1, 2, "in the past"), (10, 10, "after check-in"), (10, 45, "at most 30 nights")],
)
def test_request_validation(checkin, checkout, message):
    with pytest.raises(ValueError, match=message):
        HotelSearchRequest(destination="BOM", checkin=TODAY + timedelta(days=checkin), checkout=TODAY + timedelta(days=checkout))
```

Create `backend/tests/hotels/test_hotels_api.py`:

```python
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from tests.helpers import signup
from travelmind.config import get_settings
from travelmind.hotels.liteapi import LITEAPI_BASE_URL

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "liteapi_rates.json").read_text(encoding="utf-8"))
SEARCH = "/api/v1/hotels/search"
TODAY = datetime.now(UTC).date()


def stay(**changes) -> dict:
    return {
        "destination": "BOM",
        "checkin": (TODAY + timedelta(days=30)).isoformat(),
        "checkout": (TODAY + timedelta(days=32)).isoformat(),
    } | changes


async def test_without_a_key_hotels_are_not_configured(client, airports):
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    assert body["offers"] == []
    assert body["sources"][0]["supplier"] == "liteapi"
    assert body["sources"][0]["status"] == "not_configured"
    assert "TM_LITEAPI_KEY" in body["sources"][0]["message"]


async def test_hotel_search_returns_offers_in_display_currency(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    respx_mock.post(f"{LITEAPI_BASE_URL}/hotels/rates").mock(return_value=httpx.Response(200, json=FIXTURE))
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    assert body["display_currency"] == "INR" and body["nights"] == 2
    assert body["sources"][0]["status"] == "ok"
    assert [o["hotel_id"] for o in body["offers"]] == ["lp2044", "lp1897"]
    assert body["offers"][0]["display_total"] == body["offers"][0]["total"]


async def test_hotel_supplier_failures_are_reported(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    respx_mock.post(f"{LITEAPI_BASE_URL}/hotels/rates").mock(return_value=httpx.Response(401, json={"error": {"code": 401}}))
    await signup(client)
    body = (await client.post(SEARCH, json=stay())).json()
    assert body["sources"][0]["status"] == "error"
    assert "TM_LITEAPI_KEY" in body["sources"][0]["message"]


async def test_hotel_search_validates_input(client, airports):
    await signup(client)
    assert (await client.post(SEARCH, json=stay(destination="XXX"))).status_code == 422
    assert (await client.post(SEARCH, json=stay(checkout=stay()["checkin"]))).status_code == 422
    assert (await client.post(SEARCH, json={})).status_code == 422
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run python -m pytest tests/hotels -q`
Expected: FAIL — missing modules.

- [ ] **Step 3: Implement models, supplier and router**

Create `backend/src/travelmind/hotels/__init__.py` (empty) and `backend/src/travelmind/hotels/models.py`:

```python
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

from travelmind.offers.models import IataCode, Provenance
from travelmind.offers.money import Money

MAX_NIGHTS = 30
MAX_DAYS_AHEAD = 360


class RoomRequest(BaseModel):
    adults: int = Field(default=2, ge=1, le=6)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=4)


class HotelSearchRequest(BaseModel):
    destination: IataCode
    checkin: date
    checkout: date
    rooms: list[RoomRequest] = Field(default_factory=lambda: [RoomRequest()], min_length=1, max_length=4)
    radius_km: int = Field(default=15, ge=1, le=50)

    @model_validator(mode="after")
    def _check_stay(self) -> "HotelSearchRequest":
        today = datetime.now(UTC).date()
        if self.checkin < today:
            raise ValueError("The check-in date is in the past.")
        if self.checkin > today + timedelta(days=MAX_DAYS_AHEAD):
            raise ValueError(f"Hotels only sell about {MAX_DAYS_AHEAD} days ahead.")
        if self.checkout <= self.checkin:
            raise ValueError("The check-out date must be after check-in.")
        if (self.checkout - self.checkin).days > MAX_NIGHTS:
            raise ValueError(f"A stay can be at most {MAX_NIGHTS} nights.")
        return self

    @property
    def nights(self) -> int:
        return (self.checkout - self.checkin).days


class HotelOffer(BaseModel):
    id: str
    supplier: str
    provenance: Provenance
    hotel_id: str
    name: str
    stars: float | None = None
    rating: float | None = None
    address: str | None = None
    photo_url: str | None = None
    room_name: str | None = None
    board: str | None = None
    total: Money
    refundable: bool | None = None
    free_cancellation_until: str | None = None
    nights: int
    fetched_at: datetime
```

Create `backend/src/travelmind/hotels/liteapi.py`:

```python
"""LiteAPI v3 hotel rates. Reference: docs/research/2026-09-29-supplier-apis.md."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from travelmind.hotels.models import HotelOffer, HotelSearchRequest
from travelmind.offers.money import Money
from travelmind.offers.suppliers.base import SupplierError

LITEAPI_BASE_URL = "https://api.liteapi.travel/v3.0"
NO_AVAILABILITY = 2001
log = structlog.get_logger()


def _amount(room_type: dict[str, Any]) -> float:
    rate = room_type.get("offerRetailRate") or {}
    value = rate.get("amount")
    return float(value) if isinstance(value, int | float) else float("inf")


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
        self, request: HotelSearchRequest, *, latitude: float, longitude: float, currency: str, guest_nationality: str = "IN"
    ) -> list[HotelOffer]:
        body = {
            "latitude": latitude,
            "longitude": longitude,
            "radius": request.radius_km * 1000,
            "checkin": request.checkin.isoformat(),
            "checkout": request.checkout.isoformat(),
            "occupancies": [{"adults": r.adults, "children": r.children_ages} for r in request.rooms],
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
            if isinstance(error, dict) and error.get("code") == NO_AVAILABILITY:
                return []
            log.warning("liteapi_error", error=error)
            raise SupplierError("unavailable", "LiteAPI had a problem answering. Try again shortly.")
        sandbox = bool(payload.get("sandbox")) or self._key.startswith("sand_")
        hotels = {h.get("id"): h for h in payload.get("hotels") or [] if isinstance(h, dict)}
        fetched_at = self._clock()
        offers: list[HotelOffer] = []
        for item in payload.get("data") or []:
            room_types = [rt for rt in item.get("roomTypes") or [] if _amount(rt) != float("inf")]
            if not room_types:
                continue
            best = min(room_types, key=_amount)
            price = best["offerRetailRate"]
            rate = (best.get("rates") or [{}])[0]
            policy = rate.get("cancellationPolicies") or {}
            refundable = {"RFN": True, "NRFN": False}.get(policy.get("refundableTag"))
            infos = policy.get("cancelPolicyInfos") or []
            deadline = None
            if refundable and infos:
                first = infos[0]
                deadline = f"{first.get('cancelTime')} {first.get('timezone') or ''}".strip() if first.get("cancelTime") else None
            hotel = hotels.get(item.get("hotelId"), {})
            offers.append(
                HotelOffer(
                    id=f"{self.code}~{best.get('offerId') or item.get('hotelId')}",
                    supplier=self.code,
                    provenance="SANDBOX" if sandbox else "LIVE",
                    hotel_id=str(item.get("hotelId")),
                    name=hotel.get("name") or "Unnamed hotel",
                    stars=hotel.get("stars"),
                    rating=hotel.get("rating"),
                    address=hotel.get("address"),
                    photo_url=hotel.get("main_photo") or None,
                    room_name=rate.get("name"),
                    board=rate.get("boardName"),
                    total=Money.from_decimal(price["amount"], price["currency"]),
                    refundable=refundable,
                    free_cancellation_until=deadline,
                    nights=request.nights,
                    fetched_at=fetched_at,
                )
            )
        offers.sort(key=lambda o: (o.total.currency, o.total.amount_minor))
        return offers

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        headers = {"X-API-Key": self._key, "Accept": "application/json", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout) as client:
                response = await client.post(path, json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise SupplierError("timeout", "LiteAPI didn't answer in time.") from exc
        except httpx.HTTPError as exc:
            raise SupplierError("unavailable", "Couldn't reach LiteAPI.") from exc
        if response.status_code in (401, 403):
            raise SupplierError("auth", "LiteAPI rejected the key. Check TM_LITEAPI_KEY.")
        if response.status_code == 429:
            raise SupplierError("rate_limited", "LiteAPI's rate limit was reached. Try again in a moment.")
        if response.status_code >= 400:
            raise SupplierError("unavailable", "LiteAPI had a problem answering. Try again shortly.")
        try:
            body_json = response.json()
        except ValueError as exc:
            raise SupplierError("unavailable", "LiteAPI sent an unreadable response.") from exc
        return body_json if isinstance(body_json, dict) else {}
```

Create `backend/src/travelmind/hotels/router.py`:

```python
import asyncio
import time

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.hotels.liteapi import LiteApiHotelSupplier
from travelmind.hotels.models import HotelOffer, HotelSearchRequest
from travelmind.identity.deps import AuthedUser
from travelmind.offers.fx import display_currency_for, get_fx_rates
from travelmind.offers.money import Money
from travelmind.offers.router import SourceStatusOut
from travelmind.offers.suppliers.base import SupplierError
from travelmind.reference.service import get_airport_index

hotels_router = APIRouter(prefix="/api/v1/hotels", tags=["hotels"])


class HotelOfferView(HotelOffer):
    display_total: Money | None = None


class HotelSearchResponse(BaseModel):
    display_currency: str
    nights: int
    sources: list[SourceStatusOut]
    offers: list[HotelOfferView]


@hotels_router.post("/search")
async def search_hotels_route(
    body: HotelSearchRequest, _current: AuthedUser, db: DbSession, redis: RedisClient
) -> HotelSearchResponse:
    settings = get_settings()
    airport = (await get_airport_index(db)).get(body.destination)
    if airport is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown airport code {body.destination}.")
    currency = display_currency_for(airport.country_code)
    if not settings.liteapi_key:
        return HotelSearchResponse(
            display_currency=currency,
            nights=body.nights,
            sources=[
                SourceStatusOut(supplier="liteapi", status="not_configured", offer_count=0, latency_ms=0,
                                message="Connect LiteAPI (TM_LITEAPI_KEY) to see hotels.")
            ],
            offers=[],
        )
    supplier = LiteApiHotelSupplier(settings.liteapi_key)
    started = time.monotonic()
    offers: list[HotelOffer] = []
    try:
        offers = await asyncio.wait_for(
            supplier.search(body, latitude=airport.latitude, longitude=airport.longitude, currency=currency),
            timeout=settings.search_timeout_seconds,
        )
        source = SourceStatusOut(supplier="liteapi", status="ok", offer_count=len(offers),
                                 latency_ms=round((time.monotonic() - started) * 1000), message=None)
    except TimeoutError:
        source = SourceStatusOut(supplier="liteapi", status="timeout", offer_count=0,
                                 latency_ms=round((time.monotonic() - started) * 1000),
                                 message=f"No answer within {settings.search_timeout_seconds:g}s.")
    except SupplierError as exc:
        source = SourceStatusOut(supplier="liteapi", status="error", offer_count=0,
                                 latency_ms=round((time.monotonic() - started) * 1000), message=exc.message)
    fx = await get_fx_rates(redis, enabled=settings.fx_enabled)

    def display(offer: HotelOffer) -> Money | None:
        if offer.total.currency == currency:
            return offer.total
        return fx.convert(offer.total, currency) if fx else None

    views = [HotelOfferView.model_validate(o.model_dump() | {"display_total": display(o)}) for o in offers]
    views.sort(key=lambda v: (v.display_total is None, v.display_total.amount_minor if v.display_total else 0))
    return HotelSearchResponse(display_currency=currency, nights=body.nights, sources=[source], offers=views)
```

Include `hotels_router` in `backend/src/travelmind/main.py` after the offers routers.

- [ ] **Step 4: Run the tests and checks**

Run: `uv run python -m pytest -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "feat(hotels): LiteAPI hotel search with provenance, cancellation terms and supplier status"
```

---

### Task 9: Frontend data layer for offers, hotels and suppliers

**Files:**
- Create: `frontend/src/api/offers.ts`, `frontend/src/lib/money.ts`, `frontend/src/lib/dates.ts`, `frontend/src/test/offerFixtures.ts`
- Modify: `frontend/src/api/queries.ts`
- Test: `frontend/src/lib/money.test.ts`, `frontend/src/lib/dates.test.ts`, `frontend/src/api/offers.test.ts`

**Interfaces:**
- Consumes: the Task 7/8 HTTP contracts; `apiFetch` and `mockApi`.
- Produces:
  - Types `Money`, `Provenance`, `Cabin`, `Segment`, `Slice`, `FlightOffer`, `Insight`, `Baseline`, `SourceStatus`, `FlightSearchRequest`, `FlightSearchResponse`, `RepriceResponse`, `SupplierStatus`, `HotelSearchRequest`, `HotelOffer`, `HotelSearchResponse`
  - `offersApi.searchFlights(body, signal?)`, `offersApi.reprice(offerId)`, `offersApi.searchHotels(body, signal?)`, `offersApi.suppliers(signal?)`
  - `qk.flights(request)`, `qk.hotels(request)`, `qk.suppliers`; `flightSearchQueryOptions(request | null)`, `hotelSearchQueryOptions(request | null)` (idle with `skipToken` when null, no retries, 5 min stale), `suppliersQueryOptions`
  - `formatMoney(money)`; `isoDateFromNow(days, now?)`, `localTime(iso)`, `dayShift(departing, arriving)`
  - Test helpers `segment(...)`, `makeOffer(overrides)`, `searchResponse(overrides)`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/money.test.ts`:

```ts
import { expect, test } from "vitest";
import { formatMoney } from "./money";

test.each([
  [{ amount_minor: 523400, currency: "INR" }, "₹5,234"],
  [{ amount_minor: 12345678, currency: "INR" }, "₹1,23,456.78"],
  [{ amount_minor: 4500, currency: "USD" }, "$45"],
  [{ amount_minor: 4550, currency: "GBP" }, "£45.50"],
  [{ amount_minor: 148, currency: "JPY" }, "¥148"],
])("formats %o as %s", (money, expected) => {
  expect(formatMoney(money)).toBe(expected);
});
```

Create `frontend/src/lib/dates.test.ts`:

```ts
import { expect, test } from "vitest";
import { dayShift, isoDateFromNow, localTime } from "./dates";

test("dates are local calendar days", () => {
  const now = new Date(2026, 11, 30, 23, 30); // 30 Dec 2026, 23:30 local
  expect(isoDateFromNow(0, now)).toBe("2026-12-30");
  expect(isoDateFromNow(3, now)).toBe("2027-01-02");
});

test("supplier times are shown as given, in airport-local time", () => {
  expect(localTime("2026-11-20T06:10:00")).toBe("06:10");
  expect(dayShift("2026-11-20T23:10:00", "2026-11-21T01:20:00")).toBe(1);
  expect(dayShift("2026-11-20T06:10:00", "2026-11-20T08:20:00")).toBe(0);
});
```

Create `frontend/src/api/offers.test.ts`:

```ts
import { expect, test } from "vitest";
import { mockApi } from "../test/mockApi";
import { makeOffer, searchResponse } from "../test/offerFixtures";
import { offersApi } from "./offers";

test("flight search posts the trip", async () => {
  const { calls } = mockApi({ "POST /api/v1/flights/search": { status: 200, body: searchResponse() } });
  const request = {
    origin: "DEL",
    destination: "BOM",
    departure_date: "2026-11-20",
    return_date: null,
    adults: 1,
    children_ages: [],
    cabin: "economy" as const,
    max_connections: 1,
  };
  const result = await offersApi.searchFlights(request);
  expect(result.offers[0]?.id).toBe("sandbox~ref-1");
  expect(calls[0]?.body).toEqual(request);
});

test("re-pricing addresses the offer by id", async () => {
  const offer = makeOffer({ id: "duffel~off_123" });
  const { calls } = mockApi({
    "POST /api/v1/flights/offers/duffel~off_123/price": {
      status: 200,
      body: { offer, price_changed: false, previous_total: offer.total },
    },
  });
  const result = await offersApi.reprice(offer.id);
  expect(result.price_changed).toBe(false);
  expect(calls[0]?.method).toBe("POST");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- src/lib src/api/offers.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `frontend/src/api/offers.ts`:

```ts
import { apiFetch } from "./client";

export type Money = { amount_minor: number; currency: string };
export type Provenance = "LIVE" | "CACHED" | "SANDBOX";
export type Cabin = "economy" | "premium_economy" | "business" | "first";

export type Segment = {
  origin: string;
  destination: string;
  /** Airport-local time without an offset, e.g. "2026-11-20T06:10:00". */
  departing_at: string;
  arriving_at: string;
  marketing_carrier: string;
  marketing_carrier_name: string | null;
  flight_number: string;
  operating_carrier: string | null;
  operating_flight_number: string | null;
  duration_minutes: number | null;
};

export type Slice = {
  origin: string;
  destination: string;
  duration_minutes: number | null;
  fare_brand: string | null;
  segments: Segment[];
  stops: number;
};

export type Insight = { signal: "good" | "typical" | "high"; delta_pct: number; message: string };

export type FlightOffer = {
  id: string;
  supplier: string;
  supplier_ref: string;
  provenance: Provenance;
  total: Money;
  base: Money | null;
  tax: Money | null;
  owner_carrier: string;
  owner_name: string | null;
  cabin: Cabin | null;
  passenger_count: number;
  slices: Slice[];
  baggage: { checked: number | null; carry_on: number | null };
  conditions: {
    refundable: boolean | null;
    refund_penalty: Money | null;
    changeable: boolean | null;
    change_penalty: Money | null;
  };
  co2_kg_per_passenger: number | null;
  co2_source: "google_tim" | "google_tim_typical" | "supplier" | null;
  fetched_at: string;
  expires_at: string | null;
  stops: number;
  total_duration_minutes: number | null;
  /** The total in the agency's display currency; null when no exchange rate is available. */
  display_total: Money | null;
  insight: Insight | null;
};

export type Baseline = {
  family: "market" | "sandbox";
  currency: string;
  sample_size: number;
  p25_minor: number;
  median_minor: number;
  p75_minor: number;
  window_days: number;
};

export type SourceStatus = {
  supplier: string;
  status: "ok" | "error" | "timeout" | "not_configured";
  offer_count: number;
  latency_ms: number;
  message: string | null;
};

export type FlightSearchRequest = {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string | null;
  adults: number;
  children_ages: number[];
  cabin: Cabin;
  max_connections: number;
};

export type FlightSearchResponse = {
  search_id: string;
  display_currency: string;
  fx_as_of: string | null;
  baseline: Baseline | null;
  sources: SourceStatus[];
  offers: FlightOffer[];
};

export type RepriceResponse = { offer: FlightOffer; price_changed: boolean; previous_total: Money };

export type SupplierStatus = {
  code: string;
  name: string;
  kind: "flights" | "hotels" | "emissions" | "price_history" | "exchange_rates";
  connected: boolean;
  mode: "live" | "test" | "sandbox" | null;
  detail: string;
};

export type HotelSearchRequest = {
  destination: string;
  checkin: string;
  checkout: string;
  rooms: { adults: number; children_ages: number[] }[];
};

export type HotelOffer = {
  id: string;
  supplier: string;
  provenance: Provenance;
  hotel_id: string;
  name: string;
  stars: number | null;
  rating: number | null;
  address: string | null;
  photo_url: string | null;
  room_name: string | null;
  board: string | null;
  total: Money;
  refundable: boolean | null;
  free_cancellation_until: string | null;
  nights: number;
  fetched_at: string;
  display_total: Money | null;
};

export type HotelSearchResponse = {
  display_currency: string;
  nights: number;
  sources: SourceStatus[];
  offers: HotelOffer[];
};

export const offersApi = {
  searchFlights(body: FlightSearchRequest, signal?: AbortSignal): Promise<FlightSearchResponse> {
    return apiFetch<FlightSearchResponse>("/api/v1/flights/search", { method: "POST", body, signal });
  },
  reprice(offerId: string): Promise<RepriceResponse> {
    return apiFetch<RepriceResponse>(`/api/v1/flights/offers/${encodeURIComponent(offerId)}/price`, {
      method: "POST",
    });
  },
  searchHotels(body: HotelSearchRequest, signal?: AbortSignal): Promise<HotelSearchResponse> {
    return apiFetch<HotelSearchResponse>("/api/v1/hotels/search", { method: "POST", body, signal });
  },
  suppliers(signal?: AbortSignal): Promise<SupplierStatus[]> {
    return apiFetch<SupplierStatus[]>("/api/v1/suppliers", { signal });
  },
};
```

In `frontend/src/api/queries.ts`, import `skipToken` from `@tanstack/react-query` and `offersApi, type FlightSearchRequest, type HotelSearchRequest` from `./offers`; extend `qk` and add the options:

```ts
export const qk = {
  me: ["me"] as const,
  team: ["team"] as const,
  invitations: ["invitations"] as const,
  health: ["health"] as const,
  airports: (term: string) => ["airports", term.toLowerCase()] as const,
  flights: (request: FlightSearchRequest | null) => ["flights", request] as const,
  hotels: (request: HotelSearchRequest | null) => ["hotels", request] as const,
  suppliers: ["suppliers"] as const,
};

/** Searches are explicit: idle until a request exists, never retried (a retry would burn rate limit). */
export function flightSearchQueryOptions(request: FlightSearchRequest | null) {
  return queryOptions({
    queryKey: qk.flights(request),
    queryFn: request ? ({ signal }) => offersApi.searchFlights(request, signal) : skipToken,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function hotelSearchQueryOptions(request: HotelSearchRequest | null) {
  return queryOptions({
    queryKey: qk.hotels(request),
    queryFn: request ? ({ signal }) => offersApi.searchHotels(request, signal) : skipToken,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export const suppliersQueryOptions = queryOptions({
  queryKey: qk.suppliers,
  queryFn: ({ signal }) => offersApi.suppliers(signal),
  staleTime: 60_000,
});
```

`resetSessionState` already removes every query except `me`, so search results never outlive the session.

Create `frontend/src/lib/money.ts`:

```ts
import type { Money } from "../api/offers";

const cache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fractionDigits: number, whole: boolean): Intl.NumberFormat {
  const key = `${currency}:${whole}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    cache.set(key, format);
  }
  return format;
}

function exponent(currency: string): number {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Integer minor units → "₹5,234", "£45.50". Whole amounts drop the decimals. */
export function formatMoney(money: Money): string {
  const digits = exponent(money.currency);
  const scale = 10 ** digits;
  return formatter(money.currency, digits, money.amount_minor % scale === 0).format(money.amount_minor / scale);
}
```

Create `frontend/src/lib/dates.ts`:

```ts
const pad = (value: number) => String(value).padStart(2, "0");

/** A local calendar date `days` from now as YYYY-MM-DD (the value format of <input type="date">). */
export function isoDateFromNow(days: number, now: Date = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-11-20T06:10:00" → "06:10". Supplier times are airport-local, so they are shown as given. */
export function localTime(iso: string): string {
  return iso.slice(11, 16);
}

/** Calendar days between two airport-local timestamps (the "+1" on an overnight arrival). */
export function dayShift(departing: string, arriving: string): number {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((day(arriving) - day(departing)) / 86_400_000);
}
```

Create `frontend/src/test/offerFixtures.ts`:

```ts
import type { FlightOffer, FlightSearchResponse, Segment } from "../api/offers";

export function segment(
  origin: string,
  destination: string,
  departing: string,
  arriving: string,
  carrier = "6E",
  flightNumber = "2045",
  minutes = 130,
): Segment {
  return {
    origin,
    destination,
    departing_at: departing,
    arriving_at: arriving,
    marketing_carrier: carrier,
    marketing_carrier_name: null,
    flight_number: flightNumber,
    operating_carrier: carrier,
    operating_flight_number: null,
    duration_minutes: minutes,
  };
}

/** A sandbox DEL→BOM nonstop on IndiGo for ₹5,234; override what a test cares about. */
export function makeOffer(overrides: Partial<FlightOffer> = {}): FlightOffer {
  return {
    id: "sandbox~ref-1",
    supplier: "sandbox",
    supplier_ref: "ref-1",
    provenance: "SANDBOX",
    total: { amount_minor: 523400, currency: "INR" },
    base: null,
    tax: null,
    owner_carrier: "6E",
    owner_name: "IndiGo",
    cabin: "economy",
    passenger_count: 1,
    slices: [
      {
        origin: "DEL",
        destination: "BOM",
        duration_minutes: 130,
        fare_brand: "Saver",
        segments: [segment("DEL", "BOM", "2026-11-20T06:10:00", "2026-11-20T08:20:00")],
        stops: 0,
      },
    ],
    baggage: { checked: 1, carry_on: 1 },
    conditions: { refundable: false, refund_penalty: null, changeable: true, change_penalty: null },
    co2_kg_per_passenger: 98,
    co2_source: "google_tim",
    fetched_at: "2026-09-29T10:00:00Z",
    expires_at: "2026-09-29T10:30:00Z",
    stops: 0,
    total_duration_minutes: 130,
    display_total: { amount_minor: 523400, currency: "INR" },
    insight: null,
    ...overrides,
  };
}

export function searchResponse(overrides: Partial<FlightSearchResponse> = {}): FlightSearchResponse {
  return {
    search_id: "s-1",
    display_currency: "INR",
    fx_as_of: null,
    baseline: null,
    sources: [{ supplier: "sandbox", status: "ok", offer_count: 1, latency_ms: 12, message: null }],
    offers: [makeOffer()],
    ...overrides,
  };
}
```

- [ ] **Step 4: Run the tests and checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): offers, hotels and supplier API client with money and date helpers"
```

---

### Task 10: Fare Scan screen

**Files:**
- Create: `frontend/src/ui/SelectField.tsx`, `frontend/src/features/fares/sortOffers.ts`, `frontend/src/features/fares/FareSearchForm.tsx`, `frontend/src/features/fares/SourceStrip.tsx`, `frontend/src/features/fares/FareGauge.tsx`, `frontend/src/features/fares/OfferCard.tsx`, `frontend/src/features/fares/FareScanPage.tsx`
- Modify: `frontend/src/router.tsx` (route `/fares`)
- Test: `frontend/src/features/fares/sortOffers.test.ts`, `frontend/src/features/fares/FareScanPage.test.tsx`

**Interfaces:**
- Consumes: Task 9 types, `offersApi`, `flightSearchQueryOptions`, `formatMoney`, date helpers; `routeStore`/`useRouteSelection`, `AirportPicker`, `Panel`, `Badge`, `Button`, `Readout`, `StatusDot`, `TextField`, `asApiError`, `formatDuration`, `formatNumber`.
- Produces: route `/fares` rendering `FareScanPage`; `SourceStrip({ sources })` (reused by Task 11); `sortOffers(offers, mode)` with `SortMode = "price" | "duration" | "co2"`; `SelectField` UI primitive.
- Accessible names the tests (and Task 12's e2e) rely on: button "Scan fares"; list "Supplier sweep"; list "Flight offers" of `article`s named "<carrier> <price>"; sort buttons "Cheapest" / "Fastest" / "Greenest" (`aria-pressed`); per-offer button "Verify price"; region "Price check".

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/fares/sortOffers.test.ts`:

```ts
import { expect, test } from "vitest";
import { makeOffer } from "../../test/offerFixtures";
import { sortOffers } from "./sortOffers";

const cheapSlow = makeOffer({ id: "a", total_duration_minutes: 300, co2_kg_per_passenger: 180 });
const dearFast = makeOffer({ id: "b", total_duration_minutes: 130, co2_kg_per_passenger: null });
const midGreen = makeOffer({ id: "c", total_duration_minutes: 200, co2_kg_per_passenger: 90 });
const ranked = [cheapSlow, dearFast, midGreen];

test("cheapest keeps the server's ranking", () => {
  expect(sortOffers(ranked, "price").map((o) => o.id)).toEqual(["a", "b", "c"]);
});

test("fastest and greenest re-sort; unknown values go last", () => {
  expect(sortOffers(ranked, "duration").map((o) => o.id)).toEqual(["b", "c", "a"]);
  expect(sortOffers(ranked, "co2").map((o) => o.id)).toEqual(["c", "a", "b"]);
});
```

Create `frontend/src/features/fares/FareScanPage.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { resetSessionState } from "../../auth/resetSessionState";
import { isoDateFromNow } from "../../lib/dates";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockHandler } from "../../test/mockApi";
import { makeOffer, searchResponse, segment } from "../../test/offerFixtures";
import { renderApp, withSession } from "../../test/renderApp";
import { routeStore } from "../route/routeStore";

const SEARCH = "POST /api/v1/flights/search";
const inr = (amount_minor: number) => ({ amount_minor, currency: "INR" });

const indigo = makeOffer({ id: "sandbox~a", total: inr(420000), display_total: inr(420000), total_duration_minutes: 200 });
const airIndia = makeOffer({
  id: "sandbox~b",
  owner_carrier: "AI",
  owner_name: "Air India",
  total: inr(610000),
  display_total: inr(610000),
  total_duration_minutes: 130,
});

function scan(extra: Record<string, MockHandler>) {
  const api = mockApi(withSession(ME_OWNER, extra));
  const view = renderApp("/fares");
  return { ...api, ...view };
}

async function scanAndList(extra: Record<string, MockHandler>) {
  const view = scan(extra);
  await view.user.click(await screen.findByRole("button", { name: "Scan fares" }));
  const list = await screen.findByRole("list", { name: "Flight offers" });
  return { ...view, list };
}

beforeEach(() => routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM }));

test("scanning sends the trip and lists offers cheapest first", async () => {
  const { list, calls } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, airIndia] }) } });
  const cards = within(list).getAllByRole("article");
  expect(cards).toHaveLength(2);
  expect(cards[0]).toHaveAccessibleName("IndiGo ₹4,200");
  expect(cards[0]).toHaveTextContent("06:10");
  expect(cards[0]).toHaveTextContent("Nonstop");
  expect(calls.find((c) => c.path === "/api/v1/flights/search")?.body).toEqual({
    origin: "DEL",
    destination: "BOM",
    departure_date: isoDateFromNow(14),
    return_date: null,
    adults: 1,
    children_ages: [],
    cabin: "economy",
    max_connections: 1,
  });
});

test("the scan button waits for two different airports", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: null });
  scan({});
  expect(await screen.findByRole("button", { name: "Scan fares" })).toBeDisabled();
});

test("offers show provenance, stops, CO₂ and converted prices", async () => {
  const london = makeOffer({
    id: "duffel~off_1",
    supplier: "duffel",
    provenance: "LIVE",
    owner_carrier: "EK",
    owner_name: "Emirates",
    total: { amount_minor: 10000, currency: "USD" },
    display_total: inr(833100),
    co2_kg_per_passenger: 240,
    co2_source: "google_tim_typical",
    slices: [
      {
        origin: "DEL",
        destination: "BOM",
        duration_minutes: 610,
        fare_brand: null,
        segments: [
          segment("DEL", "DXB", "2026-11-20T22:00:00", "2026-11-21T00:30:00", "EK", "511"),
          segment("DXB", "BOM", "2026-11-21T03:00:00", "2026-11-21T07:40:00", "EK", "500"),
        ],
        stops: 1,
      },
    ],
    stops: 1,
  });
  const { list } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, london] }) } });
  const [sandboxCard, liveCard] = within(list).getAllByRole("article");
  expect(sandboxCard).toHaveTextContent("Sandbox · not bookable");
  expect(liveCard).toHaveTextContent("Live");
  expect(liveCard).toHaveTextContent("≈ ₹8,331");
  expect(liveCard).toHaveTextContent("Billed $100");
  expect(liveCard).toHaveTextContent("1 stop · DXB");
  expect(liveCard).toHaveTextContent("+1");
  expect(liveCard).toHaveTextContent("240 kg CO₂e");
  expect(screen.getByText(/Google Travel Impact Model/)).toBeInTheDocument();
});

test("every supplier's outcome is reported", async () => {
  await scanAndList({
    [SEARCH]: {
      status: 200,
      body: searchResponse({
        sources: [
          { supplier: "sandbox", status: "ok", offer_count: 1, latency_ms: 12, message: null },
          { supplier: "duffel", status: "timeout", offer_count: 0, latency_ms: 25000, message: "No answer within 25s." },
        ],
      }),
    },
  });
  const sweep = screen.getByRole("list", { name: "Supplier sweep" });
  expect(sweep).toHaveTextContent("sandbox · OK");
  expect(sweep).toHaveTextContent("duffel · Timeout");
  expect(sweep).toHaveTextContent("No answer within 25s.");
});

test("the price check compares the cheapest fare with the route's history", async () => {
  const good = { ...indigo, insight: { signal: "good" as const, delta_pct: -19.2, message: "19% under the median of 24 fares seen for this route. Good time to book." } };
  await scanAndList({
    [SEARCH]: {
      status: 200,
      body: searchResponse({
        baseline: { family: "market", currency: "INR", sample_size: 24, p25_minor: 450000, median_minor: 520000, p75_minor: 600000, window_days: 45 },
        offers: [good],
      }),
    },
  });
  const check = screen.getByRole("region", { name: "Price check" });
  expect(within(check).getByText("₹5,200")).toBeInTheDocument();
  expect(within(check).getByText(/Good time to book/)).toBeInTheDocument();
  expect(within(check).getByRole("img", { name: /Cheapest fare ₹4,200 against a typical range of ₹4,500 to ₹6,000/ })).toBeInTheDocument();
  expect(screen.getAllByRole("article")[0]).toHaveTextContent("Good price");
});

test("sandbox history is labelled as such", async () => {
  await scanAndList({
    [SEARCH]: {
      status: 200,
      body: searchResponse({
        baseline: { family: "sandbox", currency: "INR", sample_size: 12, p25_minor: 450000, median_minor: 520000, p75_minor: 600000, window_days: 45 },
      }),
    },
  });
  expect(screen.getByRole("region", { name: "Price check" })).toHaveTextContent("Built from sandbox searches");
});

test("fastest re-sorts the board", async () => {
  const { list, user } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, airIndia] }) } });
  await user.click(screen.getByRole("button", { name: "Fastest" }));
  expect(screen.getByRole("button", { name: "Fastest" })).toHaveAttribute("aria-pressed", "true");
  expect(within(list).getAllByRole("article")[0]).toHaveAccessibleName("Air India ₹6,100");
});

test("verifying a price confirms it or shows the new one", async () => {
  const { list, user } = await scanAndList({
    [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo, airIndia] }) },
    "POST /api/v1/flights/offers/sandbox~a/price": {
      status: 200,
      body: { offer: indigo, price_changed: false, previous_total: indigo.total },
    },
    "POST /api/v1/flights/offers/sandbox~b/price": {
      status: 200,
      body: { offer: { ...airIndia, total: inr(650000) }, price_changed: true, previous_total: airIndia.total },
    },
  });
  const first = within(list).getByRole("article", { name: "IndiGo ₹4,200" });
  const second = within(list).getByRole("article", { name: "Air India ₹6,100" });
  await user.click(within(first).getByRole("button", { name: "Verify price" }));
  expect(await within(first).findByText(/Price confirmed/)).toBeInTheDocument();
  await user.click(within(second).getByRole("button", { name: "Verify price" }));
  expect(await within(second).findByText("Price changed · now ₹6,500 (was ₹6,100)")).toBeInTheDocument();
});

test("an expired offer says so", async () => {
  const { list, user } = await scanAndList({
    [SEARCH]: { status: 200, body: searchResponse({ offers: [indigo] }) },
    "POST /api/v1/flights/offers/sandbox~a/price": {
      status: 410,
      body: { detail: "This offer has expired. Search again for a fresh price." },
    },
  });
  await user.click(within(list).getByRole("button", { name: "Verify price" }));
  expect(await within(list).findByRole("alert")).toHaveTextContent("This offer has expired. Search again for a fresh price.");
});

test("an empty board is explained", async () => {
  await scanAndList({ [SEARCH]: { status: 200, body: searchResponse({ offers: [] }) } });
  expect(screen.getByText("No offers for this route and date.")).toBeInTheDocument();
});

test("fare results are cleared when the session resets", async () => {
  const { queryClient, unmount } = await scanAndList({ [SEARCH]: { status: 200, body: searchResponse() } });
  unmount();
  expect(queryClient.getQueriesData({ queryKey: ["flights"] })).not.toHaveLength(0);
  resetSessionState(queryClient);
  expect(queryClient.getQueriesData({ queryKey: ["flights"] })).toHaveLength(0);
});

test("a failed scan shows the reason", async () => {
  const { user } = scan({
    [SEARCH]: { status: 503, body: { detail: "No flight suppliers are connected yet. Add a supplier key or enable the sandbox." } },
  });
  await user.click(await screen.findByRole("button", { name: "Scan fares" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No flight suppliers are connected yet.");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- src/features/fares`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the pieces**

Create `frontend/src/ui/SelectField.tsx`:

```tsx
import { useId, type ComponentProps } from "react";
import { cn } from "./cn";

type SelectFieldProps = Omit<ComponentProps<"select">, "id"> & { label: string };

export function SelectField({ label, className, children, ...select }: SelectFieldProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
        {label}
      </label>
      <select
        id={id}
        className="h-10 rounded-sm border border-line bg-void/60 px-3 text-ink outline-none transition focus:border-primary"
        {...select}
      >
        {children}
      </select>
    </div>
  );
}
```

Create `frontend/src/features/fares/sortOffers.ts`:

```ts
import type { FlightOffer } from "../../api/offers";

export type SortMode = "price" | "duration" | "co2";

/** The server ranks by display price; the other modes re-sort, with unknown values last (stable). */
export function sortOffers(offers: FlightOffer[], mode: SortMode): FlightOffer[] {
  if (mode === "price") return offers;
  const value = (offer: FlightOffer) =>
    (mode === "duration" ? offer.total_duration_minutes : offer.co2_kg_per_passenger) ?? Number.POSITIVE_INFINITY;
  return [...offers].sort((a, b) => {
    const diff = value(a) - value(b);
    return Number.isNaN(diff) ? 0 : diff;
  });
}
```

Create `frontend/src/features/fares/FareSearchForm.tsx`:

```tsx
import { useState } from "react";
import type { Cabin, FlightSearchRequest } from "../../api/offers";
import { isoDateFromNow } from "../../lib/dates";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { SelectField } from "../../ui/SelectField";
import { TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { routeStore, useRouteSelection } from "../route/routeStore";

const CABINS: { value: Cabin; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

export function FareSearchForm({ busy, onSearch }: { busy: boolean; onSearch: (request: FlightSearchRequest) => void }) {
  const { origin, destination } = useRouteSelection();
  const [departure, setDeparture] = useState(() => isoDateFromNow(14));
  const [returning, setReturning] = useState("");
  const [adults, setAdults] = useState(1);
  const [cabin, setCabin] = useState<Cabin>("economy");

  const sameAirport = origin !== null && destination !== null && origin.iata_code === destination.iata_code;
  const returnTooEarly = returning !== "" && returning < departure;
  const ready = origin !== null && destination !== null && !sameAirport && departure !== "" && !returnTooEarly;

  return (
    <Panel eyebrow="Fare scan" title="Scan live fares">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || !origin || !destination) return;
          onSearch({
            origin: origin.iata_code,
            destination: destination.iata_code,
            departure_date: departure,
            return_date: returning || null,
            adults,
            children_ages: [],
            cabin,
            max_connections: 1,
          });
        }}
      >
        <AirportPicker label="From" value={origin} onChange={(a) => routeStore.setOrigin(a)} />
        <AirportPicker label="To" value={destination} onChange={(a) => routeStore.setDestination(a)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Depart"
            type="date"
            required
            min={isoDateFromNow(0)}
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
          <TextField
            label="Return"
            type="date"
            min={departure}
            value={returning}
            hint="Empty for one-way"
            error={returnTooEarly ? "Return must be on or after departure." : undefined}
            onChange={(e) => setReturning(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Adults"
            type="number"
            min={1}
            max={9}
            value={adults}
            onChange={(e) => setAdults(Math.min(9, Math.max(1, Number(e.target.value) || 1)))}
          />
          <SelectField label="Cabin" value={cabin} onChange={(e) => setCabin(e.target.value as Cabin)}>
            {CABINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectField>
        </div>
        {sameAirport && (
          <p role="alert" className="text-sm text-warn">
            Pick two different airports.
          </p>
        )}
        <Button type="submit" disabled={!ready} loading={busy}>
          Scan fares
        </Button>
      </form>
    </Panel>
  );
}
```

Create `frontend/src/features/fares/SourceStrip.tsx`:

```tsx
import type { SourceStatus } from "../../api/offers";
import { StatusDot, type Status } from "../../ui/StatusDot";

const STATE: Record<SourceStatus["status"], { dot: Status; label: string }> = {
  ok: { dot: "ok", label: "OK" },
  error: { dot: "down", label: "Error" },
  timeout: { dot: "degraded", label: "Timeout" },
  not_configured: { dot: "unknown", label: "Not connected" },
};

/** One chip per supplier asked: how it answered, how many offers, how fast — or why not. */
export function SourceStrip({ sources }: { sources: SourceStatus[] }) {
  return (
    <ul aria-label="Supplier sweep" className="flex flex-wrap gap-2">
      {sources.map((source) => (
        <li key={source.supplier} className="flex items-center gap-2 rounded-sm border border-line px-2 py-1 font-mono text-[11px] text-dim">
          <StatusDot status={STATE[source.status].dot} label={`${source.supplier} · ${STATE[source.status].label}`} />
          <span>{source.status === "ok" ? `${source.offer_count} offers · ${source.latency_ms} ms` : source.message}</span>
        </li>
      ))}
    </ul>
  );
}
```

Create `frontend/src/features/fares/FareGauge.tsx`:

```tsx
import type { Baseline, Insight, Money } from "../../api/offers";
import { formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";

const INSIGHT_TONE: Record<Insight["signal"], string> = { good: "text-ok", typical: "text-ink", high: "text-warn" };

/** Where the cheapest fare sits against the fares seen for this route and booking window. */
export function FareGauge({ baseline, price, insight }: { baseline: Baseline; price: Money | null; insight: Insight | null }) {
  const money = (minor: number) => formatMoney({ amount_minor: minor, currency: baseline.currency });
  const spread = Math.max(baseline.p75_minor - baseline.p25_minor, 1);
  const low = baseline.p25_minor - spread;
  const high = baseline.p75_minor + spread;
  const at = (minor: number) => Math.min(100, Math.max(0, ((minor - low) / (high - low)) * 100));
  const range = `a typical range of ${money(baseline.p25_minor)} to ${money(baseline.p75_minor)}`;

  return (
    <Panel eyebrow="Fare intelligence" title="Price check">
      <div
        role="img"
        aria-label={price ? `Cheapest fare ${formatMoney(price)} against ${range}` : `Fares on this route usually fall in ${range}`}
        className="relative h-3 overflow-visible rounded-sm bg-void/60"
      >
        <span className="absolute inset-y-0 left-0 bg-ok/30" style={{ width: `${at(baseline.p25_minor)}%` }} />
        <span
          className="absolute inset-y-0 bg-primary/25"
          style={{ left: `${at(baseline.p25_minor)}%`, width: `${at(baseline.p75_minor) - at(baseline.p25_minor)}%` }}
        />
        <span className="absolute inset-y-0 right-0 bg-warn/25" style={{ left: `${at(baseline.p75_minor)}%` }} />
        {price && (
          <span className="tm-glow absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `${at(price.amount_minor)}%` }} />
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Readout
          label="Typical"
          value={money(baseline.median_minor)}
          hint={`Usual ${money(baseline.p25_minor)}–${money(baseline.p75_minor)}`}
        />
        <Readout label="Fares seen" value={formatNumber(baseline.sample_size)} hint={`Last ${baseline.window_days} days`} />
      </dl>
      {insight && <p className={cn("mt-3 text-sm", INSIGHT_TONE[insight.signal])}>{insight.message}</p>}
      {baseline.family === "sandbox" && (
        <p className="mt-2 text-xs text-dim">Built from sandbox searches — for demonstration only.</p>
      )}
    </Panel>
  );
}
```

Create `frontend/src/features/fares/OfferCard.tsx`:

```tsx
import { useMutation } from "@tanstack/react-query";
import { asApiError } from "../../api/client";
import { offersApi, type FlightOffer, type Insight, type Provenance, type Slice } from "../../api/offers";
import { dayShift, localTime } from "../../lib/dates";
import { formatDuration, formatNumber } from "../../lib/format";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";

const PROVENANCE: Record<Provenance, { tone: "ok" | "warn" | "ai"; label: string }> = {
  LIVE: { tone: "ok", label: "Live" },
  CACHED: { tone: "warn", label: "Cached · indicative" },
  SANDBOX: { tone: "ai", label: "Sandbox · not bookable" },
};

const INSIGHT: Record<Insight["signal"], { tone: "ok" | "neutral" | "warn"; label: string }> = {
  good: { tone: "ok", label: "Good price" },
  typical: { tone: "neutral", label: "Typical price" },
  high: { tone: "warn", label: "High price" },
};

const CO2_SOURCE = {
  google_tim: "Google Travel Impact Model, this flight",
  google_tim_typical: "Google Travel Impact Model, typical for this route",
  supplier: "Supplier estimate",
} as const;

export function stopsLabel(slice: Slice): string {
  const vias = slice.segments.slice(0, -1).map((s) => s.destination);
  if (vias.length === 0) return "Nonstop";
  return `${vias.length} stop${vias.length > 1 ? "s" : ""} · ${vias.join(", ")}`;
}

function SliceRow({ slice }: { slice: Slice }) {
  const first = slice.segments[0];
  const last = slice.segments[slice.segments.length - 1];
  if (!first || !last) return null;
  const shift = dayShift(first.departing_at, last.arriving_at);
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <p className="font-mono text-lg text-ink">
        {localTime(first.departing_at)} <span className="text-xs text-dim">{slice.origin}</span>
      </p>
      <div className="flex flex-col items-center gap-0.5 text-[11px] text-dim">
        <span>{slice.duration_minutes !== null ? formatDuration(slice.duration_minutes) : "—"}</span>
        <span aria-hidden="true" className="h-px w-full bg-line" />
        <span>{stopsLabel(slice)}</span>
      </div>
      <p className="font-mono text-lg text-ink">
        {localTime(last.arriving_at)}
        {shift > 0 && <sup className="text-warn">+{shift}</sup>} <span className="text-xs text-dim">{slice.destination}</span>
      </p>
      <p className="col-span-3 text-[11px] text-dim">
        {slice.segments.map((s) => `${s.marketing_carrier} ${s.flight_number}`).join(" · ")}
        {slice.fare_brand ? ` · ${slice.fare_brand}` : ""}
      </p>
    </div>
  );
}

export function OfferCard({ offer }: { offer: FlightOffer }) {
  const reprice = useMutation({ mutationFn: () => offersApi.reprice(offer.id) });
  const carrier = offer.owner_name ?? offer.owner_carrier;
  const shown = offer.display_total ?? offer.total;
  const converted = offer.display_total !== null && offer.display_total.currency !== offer.total.currency;
  const price = formatMoney(shown);
  const { checked } = offer.baggage;

  return (
    <article aria-label={`${carrier} ${price}`} className="rounded-sm border border-line bg-void/40 p-4 transition hover:border-primary/50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2">
            <span className="font-mono text-primary">{offer.owner_carrier}</span>
            <span className="text-ink">{carrier}</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={PROVENANCE[offer.provenance].tone}>{PROVENANCE[offer.provenance].label}</Badge>
            {offer.insight && <Badge tone={INSIGHT[offer.insight.signal].tone}>{INSIGHT[offer.insight.signal].label}</Badge>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl text-ink">{converted ? `≈ ${price}` : price}</p>
          {converted && <p className="text-xs text-dim">Billed {formatMoney(offer.total)}</p>}
          {offer.passenger_count > 1 && <p className="text-xs text-dim">Total for {offer.passenger_count} travellers</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {offer.slices.map((slice, index) => (
          <SliceRow key={`${slice.origin}-${slice.destination}-${index}`} slice={slice} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-dim">
        <span className="flex flex-wrap gap-3">
          {offer.co2_kg_per_passenger !== null && (
            <span title={CO2_SOURCE[offer.co2_source ?? "supplier"]}>
              {formatNumber(offer.co2_kg_per_passenger)} kg CO₂e
            </span>
          )}
          {checked !== null && <span>{checked > 0 ? `${checked} checked bag${checked > 1 ? "s" : ""}` : "No checked bag"}</span>}
          {offer.conditions.refundable !== null && (
            <span>{offer.conditions.refundable ? "Refundable" : "Non-refundable"}</span>
          )}
        </span>
        <Button variant="ghost" size="sm" loading={reprice.isPending} onClick={() => reprice.mutate()}>
          Verify price
        </Button>
      </div>
      {reprice.isSuccess &&
        (reprice.data.price_changed ? (
          <p role="status" className="mt-2 text-sm text-warn">
            {`Price changed · now ${formatMoney(reprice.data.offer.total)} (was ${formatMoney(reprice.data.previous_total)})`}
          </p>
        ) : (
          <p role="status" className="mt-2 text-sm text-ok">
            {`Price confirmed · ${formatMoney(reprice.data.offer.total)}`}
          </p>
        ))}
      {reprice.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {asApiError(reprice.error).message}
        </p>
      )}
    </article>
  );
}
```

Create `frontend/src/features/fares/FareScanPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { asApiError } from "../../api/client";
import type { FlightSearchRequest } from "../../api/offers";
import { flightSearchQueryOptions } from "../../api/queries";
import { cn } from "../../ui/cn";
import { Panel } from "../../ui/Panel";
import { FareGauge } from "./FareGauge";
import { FareSearchForm } from "./FareSearchForm";
import { OfferCard } from "./OfferCard";
import { SourceStrip } from "./SourceStrip";
import { sortOffers, type SortMode } from "./sortOffers";

const SORTS: { mode: SortMode; label: string }[] = [
  { mode: "price", label: "Cheapest" },
  { mode: "duration", label: "Fastest" },
  { mode: "co2", label: "Greenest" },
];

export function FareScanPage() {
  const [request, setRequest] = useState<FlightSearchRequest | null>(null);
  const [sort, setSort] = useState<SortMode>("price");
  const search = useQuery(flightSearchQueryOptions(request));
  const data = search.data;
  const cheapest = data?.offers[0] ?? null;

  const submit = (next: FlightSearchRequest) => {
    if (request && JSON.stringify(request) === JSON.stringify(next)) void search.refetch();
    else setRequest(next);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <FareSearchForm busy={search.isFetching} onSearch={submit} />
        {data?.baseline && (
          <FareGauge baseline={data.baseline} price={cheapest?.display_total ?? null} insight={cheapest?.insight ?? null} />
        )}
      </div>
      <Panel eyebrow="Offers" title="Fare board">
        {request === null ? (
          <p className="text-sm text-dim">Pick a route and scan to see offers from every connected supplier.</p>
        ) : search.isFetching ? (
          <p role="status" className="tm-blink font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Scanning suppliers…
          </p>
        ) : search.isError ? (
          <p role="alert" className="text-sm text-danger">
            {asApiError(search.error).message}
          </p>
        ) : data ? (
          <div className="flex flex-col gap-3">
            <SourceStrip sources={data.sources} />
            {data.offers.length === 0 ? (
              <p className="text-sm text-dim">No offers for this route and date.</p>
            ) : (
              <>
                <div className="flex gap-2">
                  {SORTS.map(({ mode, label }) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={sort === mode}
                      onClick={() => setSort(mode)}
                      className={cn(
                        "h-8 rounded-sm border px-3 font-display text-xs uppercase tracking-[0.14em] transition",
                        sort === mode ? "border-primary text-primary" : "border-line text-dim hover:text-ink",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ol aria-label="Flight offers" className="flex flex-col gap-3">
                  {sortOffers(data.offers, sort).map((offer) => (
                    <li key={offer.id}>
                      <OfferCard offer={offer} />
                    </li>
                  ))}
                </ol>
                {data.offers.some((o) => o.co2_source?.startsWith("google_tim")) && (
                  <p className="text-[11px] text-dim">
                    CO₂ per passenger: Google Travel Impact Model (CC BY-SA 4.0).
                  </p>
                )}
                {data.fx_as_of && (
                  <p className="text-[11px] text-dim">
                    ≈ prices converted with ECB reference rates of {data.fx_as_of}; you are billed in the supplier's currency.
                  </p>
                )}
              </>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
```

In `frontend/src/router.tsx`, import `FareScanPage` and add:

```tsx
const faresRoute = createRoute({ getParentRoute: () => appRoute, path: "/fares", component: FareScanPage });
```

and include `faresRoute` in `appRoute.addChildren([...])`.

- [ ] **Step 4: Run the tests and checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass. If `toHaveAccessibleName` for an article is empty in jsdom, check that the `article` element carries `aria-label` (it does above) rather than changing the test.

- [ ] **Step 5: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): Fare Scan with supplier sweep, offer board, price check gauge and live re-pricing"
```

---

### Task 11: Hotel Scan, Suppliers page and navigation

**Files:**
- Create: `frontend/src/features/hotels/HotelScanPage.tsx`, `frontend/src/features/suppliers/SuppliersPage.tsx`
- Modify: `frontend/src/router.tsx`, `frontend/src/shell/NavRail.tsx`, `frontend/src/features/palette/CommandPalette.tsx`, `frontend/src/features/route/RouteScanner.tsx`, `frontend/src/features/dashboard/MissionControlPage.tsx`, `frontend/src/shell/shell.test.tsx`, `frontend/src/features/palette/CommandPalette.test.tsx`
- Test: `frontend/src/features/hotels/HotelScanPage.test.tsx`, `frontend/src/features/suppliers/SuppliersPage.test.tsx`, additions to `MissionControlPage.test.tsx`

**Interfaces:**
- Consumes: Task 9 (`hotelSearchQueryOptions`, `suppliersQueryOptions`, types, `formatMoney`, `isoDateFromNow`), Task 10 (`SourceStrip`).
- Produces: routes `/hotels`, `/suppliers`; nav items "Fare scan", "Hotel scan", "Suppliers"; palette commands for each; `RouteScanner` prop `onScanFares?: () => void` (button "Scan fares for this route" once a route is ready).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/hotels/HotelScanPage.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import type { HotelOffer, HotelSearchResponse } from "../../api/offers";
import { isoDateFromNow } from "../../lib/dates";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { routeStore } from "../route/routeStore";

const SEARCH = "POST /api/v1/hotels/search";

function hotel(overrides: Partial<HotelOffer>): HotelOffer {
  return {
    id: "liteapi~offer-1",
    supplier: "liteapi",
    provenance: "SANDBOX",
    hotel_id: "lp1",
    name: "Harbour View Mumbai",
    stars: 5,
    rating: 8.9,
    address: "12 Marine Drive, Mumbai",
    photo_url: null,
    room_name: "Deluxe King Room",
    board: "Bed & Breakfast",
    total: { amount_minor: 942000, currency: "INR" },
    refundable: true,
    free_cancellation_until: "2026-11-18 12:00:00 GMT",
    nights: 2,
    fetched_at: "2026-09-29T10:00:00Z",
    display_total: { amount_minor: 942000, currency: "INR" },
    ...overrides,
  };
}

function response(overrides: Partial<HotelSearchResponse>): HotelSearchResponse {
  return {
    display_currency: "INR",
    nights: 2,
    sources: [{ supplier: "liteapi", status: "ok", offer_count: 1, latency_ms: 800, message: null }],
    offers: [hotel({})],
    ...overrides,
  };
}

beforeEach(() => routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM }));

test("the destination comes from the route and hotels are listed with terms", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { [SEARCH]: { status: 200, body: response({}) } }));
  const { user } = renderApp("/hotels");
  await user.click(await screen.findByRole("button", { name: "Scan hotels" }));
  const list = await screen.findByRole("list", { name: "Hotel offers" });
  const [card] = within(list).getAllByRole("article");
  expect(card).toHaveAccessibleName("Harbour View Mumbai ₹9,420");
  expect(card).toHaveTextContent("₹4,710 / night");
  expect(card).toHaveTextContent("Deluxe King Room · Bed & Breakfast");
  expect(card).toHaveTextContent("Free cancellation until 2026-11-18 12:00:00 GMT");
  expect(card).toHaveTextContent("8.9");
  expect(calls.find((c) => c.path === "/api/v1/hotels/search")?.body).toEqual({
    destination: "BOM",
    checkin: isoDateFromNow(14),
    checkout: isoDateFromNow(16),
    rooms: [{ adults: 2, children_ages: [] }],
  });
});

test("without a hotel supplier the page says how to connect one", async () => {
  mockApi(
    withSession(ME_OWNER, {
      [SEARCH]: {
        status: 200,
        body: response({
          offers: [],
          sources: [{ supplier: "liteapi", status: "not_configured", offer_count: 0, latency_ms: 0, message: "Connect LiteAPI (TM_LITEAPI_KEY) to see hotels." }],
        }),
      },
    }),
  );
  const { user } = renderApp("/hotels");
  await user.click(await screen.findByRole("button", { name: "Scan hotels" }));
  expect(await screen.findByText("Connect LiteAPI (TM_LITEAPI_KEY) to see hotels.", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open suppliers" })).toHaveAttribute("href", "/suppliers");
});
```

Create `frontend/src/features/suppliers/SuppliersPage.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { SupplierStatus } from "../../api/offers";
import { ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

const SUPPLIERS: SupplierStatus[] = [
  { code: "duffel", name: "Duffel", kind: "flights", connected: true, mode: "test", detail: "Flight offers from airlines via NDC and GDS. Set TM_DUFFEL_TOKEN." },
  { code: "sandbox", name: "Sandbox inventory", kind: "flights", connected: true, mode: "sandbox", detail: "Deterministic test flights for demos and development. Never bookable." },
  { code: "liteapi", name: "LiteAPI", kind: "hotels", connected: false, mode: null, detail: "Hotel rates worldwide. Set TM_LITEAPI_KEY." },
];

test("the suppliers page shows each connection and its mode", async () => {
  mockApi(withSession(ME_OWNER, { "GET /api/v1/suppliers": { status: 200, body: SUPPLIERS } }));
  renderApp("/suppliers");
  const table = await screen.findByRole("table", { name: "Supplier connections" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("Duffel");
  expect(rows[0]).toHaveTextContent("Flights");
  expect(rows[0]).toHaveTextContent("Connected");
  expect(rows[0]).toHaveTextContent("Test");
  expect(rows[2]).toHaveTextContent("Not connected");
  expect(rows[2]).toHaveTextContent("Set TM_LITEAPI_KEY.");
});
```

Append to `frontend/src/features/dashboard/MissionControlPage.test.tsx`:

```tsx
test("a plotted route can be sent to the fare scanner", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { user, router } = renderApp("/");
  await user.click(await screen.findByRole("button", { name: "Scan fares for this route" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/fares"));
  expect(await screen.findByRole("heading", { name: "Scan live fares" })).toBeInTheDocument();
});
```

In `frontend/src/shell/shell.test.tsx`, change the navigation list to:

```tsx
  for (const name of ["Mission Control", "Fare scan", "Hotel scan", "Suppliers", "Crew roster", "Design system"]) {
```

In `frontend/src/features/palette/CommandPalette.test.tsx`, change the command list at line 113 to:

```tsx
  for (const name of ["Mission Control", "Fare scan", "Hotel scan", "Suppliers", "Crew roster", "Design system", "Switch to daylight theme", "Sign out"]) {
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — new pages missing, nav lists short, no "Scan fares for this route" button.

- [ ] **Step 3: Implement the pages**

Create `frontend/src/features/hotels/HotelScanPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { asApiError } from "../../api/client";
import type { HotelOffer, HotelSearchRequest, Provenance } from "../../api/offers";
import { hotelSearchQueryOptions } from "../../api/queries";
import type { Airport } from "../../api/types";
import { isoDateFromNow } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { TextField } from "../../ui/TextField";
import { AirportPicker } from "../airports/AirportPicker";
import { SourceStrip } from "../fares/SourceStrip";
import { routeStore } from "../route/routeStore";

const PROVENANCE: Record<Provenance, { tone: "ok" | "warn" | "ai"; label: string }> = {
  LIVE: { tone: "ok", label: "Live" },
  CACHED: { tone: "warn", label: "Cached" },
  SANDBOX: { tone: "ai", label: "Sandbox · not bookable" },
};

function HotelCard({ offer }: { offer: HotelOffer }) {
  const shown = offer.display_total ?? offer.total;
  const price = formatMoney(shown);
  const perNight = formatMoney({ amount_minor: Math.round(shown.amount_minor / offer.nights), currency: shown.currency });
  return (
    <article aria-label={`${offer.name} ${price}`} className="flex gap-4 rounded-sm border border-line bg-void/40 p-4">
      {offer.photo_url && (
        <img src={offer.photo_url} alt="" loading="lazy" className="h-24 w-32 shrink-0 rounded-sm object-cover" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-ink">{offer.name}</p>
            <p className="text-xs text-dim">
              {offer.stars ? `${"★".repeat(Math.round(offer.stars))} · ` : ""}
              {offer.rating !== null ? `Guest rating ${offer.rating.toFixed(1)}` : "No rating yet"}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl text-ink">{price}</p>
            <p className="text-xs text-dim">{perNight} / night</p>
          </div>
        </div>
        <p className="text-sm text-dim">{[offer.room_name, offer.board].filter(Boolean).join(" · ")}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
          <Badge tone={PROVENANCE[offer.provenance].tone}>{PROVENANCE[offer.provenance].label}</Badge>
          <span>
            {offer.refundable === true
              ? offer.free_cancellation_until
                ? `Free cancellation until ${offer.free_cancellation_until}`
                : "Refundable"
              : offer.refundable === false
                ? "Non-refundable"
                : "Cancellation terms on request"}
          </span>
        </div>
        {offer.address && <p className="truncate text-[11px] text-dim">{offer.address}</p>}
      </div>
    </article>
  );
}

export function HotelScanPage() {
  const [destination, setDestination] = useState<Airport | null>(() => routeStore.get().destination);
  const [checkin, setCheckin] = useState(() => isoDateFromNow(14));
  const [checkout, setCheckout] = useState(() => isoDateFromNow(16));
  const [adults, setAdults] = useState(2);
  const [request, setRequest] = useState<HotelSearchRequest | null>(null);
  const search = useQuery(hotelSearchQueryOptions(request));
  const badDates = checkout <= checkin;
  const ready = destination !== null && checkin !== "" && checkout !== "" && !badDates;
  const notConfigured = search.data?.sources.find((s) => s.status === "not_configured");

  return (
    <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <Panel eyebrow="Hotel scan" title="Find a stay">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || !destination) return;
            const next = { destination: destination.iata_code, checkin, checkout, rooms: [{ adults, children_ages: [] }] };
            if (request && JSON.stringify(request) === JSON.stringify(next)) void search.refetch();
            else setRequest(next);
          }}
        >
          <AirportPicker label="Near" value={destination} onChange={setDestination} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Check-in" type="date" required min={isoDateFromNow(0)} value={checkin} onChange={(e) => setCheckin(e.target.value)} />
            <TextField
              label="Check-out"
              type="date"
              required
              min={checkin}
              value={checkout}
              error={badDates ? "Check-out must be after check-in." : undefined}
              onChange={(e) => setCheckout(e.target.value)}
            />
          </div>
          <TextField
            label="Adults"
            type="number"
            min={1}
            max={6}
            value={adults}
            onChange={(e) => setAdults(Math.min(6, Math.max(1, Number(e.target.value) || 1)))}
          />
          <Button type="submit" disabled={!ready} loading={search.isFetching}>
            Scan hotels
          </Button>
        </form>
      </Panel>
      <Panel eyebrow="Stays" title="Hotel board">
        {request === null ? (
          <p className="text-sm text-dim">Choose where and when, then scan for rooms.</p>
        ) : search.isFetching ? (
          <p role="status" className="tm-blink font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Scanning hotels…
          </p>
        ) : search.isError ? (
          <p role="alert" className="text-sm text-danger">
            {asApiError(search.error).message}
          </p>
        ) : search.data ? (
          <div className="flex flex-col gap-3">
            <SourceStrip sources={search.data.sources} />
            {notConfigured ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-ink">{notConfigured.message}</p>
                <Link to="/suppliers" className="text-sm text-primary underline-offset-4 hover:underline">
                  Open suppliers
                </Link>
              </div>
            ) : search.data.offers.length === 0 ? (
              <p className="text-sm text-dim">No rooms for these dates.</p>
            ) : (
              <ol aria-label="Hotel offers" className="flex flex-col gap-3">
                {search.data.offers.map((offer) => (
                  <li key={offer.id}>
                    <HotelCard offer={offer} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
```

Create `frontend/src/features/suppliers/SuppliersPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { asApiError } from "../../api/client";
import type { SupplierStatus } from "../../api/offers";
import { suppliersQueryOptions } from "../../api/queries";
import { Badge } from "../../ui/Badge";
import { Panel } from "../../ui/Panel";
import { StatusDot } from "../../ui/StatusDot";

const KIND: Record<SupplierStatus["kind"], string> = {
  flights: "Flights",
  hotels: "Hotels",
  emissions: "CO₂ data",
  price_history: "Fare history",
  exchange_rates: "Exchange rates",
};
const MODE = { live: { tone: "ok", label: "Live" }, test: { tone: "warn", label: "Test" }, sandbox: { tone: "ai", label: "Sandbox" } } as const;

export function SuppliersPage() {
  const suppliers = useQuery(suppliersQueryOptions);
  return (
    <Panel eyebrow="Data links" title="Suppliers">
      <p className="mb-4 max-w-2xl text-sm text-dim">
        Where TravelMind's prices and data come from. Keys are set on the server and are never shown here.
      </p>
      {suppliers.isError ? (
        <p role="alert" className="text-sm text-danger">
          {asApiError(suppliers.error).message}
        </p>
      ) : !suppliers.data ? (
        <p role="status" className="font-mono text-xs uppercase tracking-[0.2em] text-dim">
          Checking links…
        </p>
      ) : (
        <table aria-label="Supplier connections" className="w-full text-left text-sm">
          <thead className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
            <tr>
              <th className="py-2 pr-4 font-normal">Supplier</th>
              <th className="py-2 pr-4 font-normal">Provides</th>
              <th className="py-2 pr-4 font-normal">Link</th>
              <th className="py-2 font-normal">Mode</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.data.map((s) => (
              <tr key={s.code} className="border-t border-line align-top">
                <td className="py-3 pr-4">
                  <p className="text-ink">{s.name}</p>
                  <p className="text-xs text-dim">{s.detail}</p>
                </td>
                <td className="py-3 pr-4 text-dim">{KIND[s.kind]}</td>
                <td className="py-3 pr-4 text-dim">
                  <StatusDot status={s.connected ? "ok" : "unknown"} label={s.connected ? "Connected" : "Not connected"} />
                </td>
                <td className="py-3">{s.mode ? <Badge tone={MODE[s.mode].tone}>{MODE[s.mode].label}</Badge> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Wire routes, navigation, palette and the Mission Control shortcut**

In `frontend/src/router.tsx`, import both pages and add:

```tsx
const hotelsRoute = createRoute({ getParentRoute: () => appRoute, path: "/hotels", component: HotelScanPage });
const suppliersRoute = createRoute({ getParentRoute: () => appRoute, path: "/suppliers", component: SuppliersPage });
```

with the children list becoming `[missionRoute, faresRoute, hotelsRoute, suppliersRoute, teamRoute, designRoute]`.

In `frontend/src/shell/NavRail.tsx`, import `BedDouble, Palette, Plane, PlugZap, Radar, Users` from `lucide-react` and set:

```tsx
const ITEMS = [
  { to: "/", label: "Mission Control", icon: Radar },
  { to: "/fares", label: "Fare scan", icon: Plane },
  { to: "/hotels", label: "Hotel scan", icon: BedDouble },
  { to: "/suppliers", label: "Suppliers", icon: PlugZap },
  { to: "/team", label: "Crew roster", icon: Users },
  { to: "/design", label: "Design system", icon: Palette },
] as const;
```

In `frontend/src/features/palette/CommandPalette.tsx`, add after `nav-mission`:

```tsx
    { id: "nav-fares", group: "Navigate", label: "Fare scan", keywords: "flights fares prices offers search", run: () => void navigate({ to: "/fares" }) },
    { id: "nav-hotels", group: "Navigate", label: "Hotel scan", keywords: "hotels rooms stay accommodation", run: () => void navigate({ to: "/hotels" }) },
    { id: "nav-suppliers", group: "Navigate", label: "Suppliers", keywords: "suppliers connections keys duffel liteapi data", run: () => void navigate({ to: "/suppliers" }) },
```

In `frontend/src/features/route/RouteScanner.tsx`, add an optional `onScanFares?: () => void` prop and replace the final `<p>` with:

```tsx
      {km !== null && onScanFares ? (
        <Button className="mt-4 w-full" onClick={onScanFares}>
          Scan fares for this route
        </Button>
      ) : (
        <p className="mt-4 text-xs text-dim">Pick two airports to scan fares.</p>
      )}
```

(The signature becomes `RouteScanner({ onRouteReady, onScanFares }: { onRouteReady?: …; onScanFares?: () => void })`.)

In `frontend/src/features/dashboard/MissionControlPage.tsx`, `import { useNavigate } from "@tanstack/react-router"`, call `const navigate = useNavigate();` at the top of the component (before the early return), and render `<RouteScanner onRouteReady={record} onScanFares={() => void navigate({ to: "/fares" })} />`.

- [ ] **Step 5: Run the tests and checks**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): Hotel Scan, Suppliers page, and fare scanning from navigation, palette and Mission Control"
```

---

### Task 12: End-to-end fare scan, docs and CI

**Files:**
- Create: `frontend/e2e/support.ts`, `frontend/e2e/fare-scan.spec.ts`
- Modify: `frontend/e2e/golden-path.spec.ts` (use `support.ts`), `.github/workflows/frontend.yml`, `backend/.env.example`, `README.md`

**Interfaces:**
- Consumes: the sandbox supplier (on by default outside production), the Task 10/11 accessible names.
- Produces: an e2e test proving a real browser → API → sandbox supplier → fare board → re-price loop; documented supplier keys.

- [ ] **Step 1: Share the e2e helpers**

Create `frontend/e2e/support.ts`:

```ts
import { expect, type Page } from "@playwright/test";

export type Owner = { agency: string; name: string; email: string; password: string };

export function newOwner(tag: string): Owner {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    agency: `E2E ${tag} ${stamp}`,
    name: "Esha Owner",
    email: `owner-${tag}-${stamp}@e2etravels.com`,
    password: "e2e-password-123",
  };
}

export async function signUp(page: Page, owner: Owner) {
  await page.goto("/signup");
  await page.getByLabel("Agency name").fill(owner.agency);
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create command deck" }).click();
  await expect(page.getByRole("banner").getByText(owner.agency)).toBeVisible();
}

export async function pickAirport(page: Page, label: string, code: string) {
  await page.getByRole("combobox", { name: label }).fill(code);
  await page.getByRole("option", { name: new RegExp(code) }).first().click();
}
```

In `frontend/e2e/golden-path.spec.ts`, delete the local `signUp`/`pickAirport` functions, import `pickAirport, signUp` from `./support`, keep the existing `owner` object (it already matches `Owner`) and call `signUp(page, owner)`.

- [ ] **Step 2: Write the fare scan journey**

Create `frontend/e2e/fare-scan.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { newOwner, pickAirport, signUp } from "./support";

test("an agent scans sandbox fares, verifies a price and checks the supplier links", async ({ page }) => {
  await signUp(page, newOwner("fares"));

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Fare scan" }).click();
  await pickAirport(page, "From", "DEL");
  await pickAirport(page, "To", "BOM");
  await page.getByRole("button", { name: "Scan fares" }).click();

  const board = page.getByRole("list", { name: "Flight offers" });
  await expect(board.getByRole("article").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Supplier sweep" })).toContainText("sandbox · OK");
  const first = board.getByRole("article").first();
  await expect(first).toContainText("Sandbox · not bookable");
  await expect(first).toContainText(/₹[\d,]+/);

  await first.getByRole("button", { name: "Verify price" }).click();
  await expect(first.getByText(/Price confirmed/)).toBeVisible();

  await page.getByRole("button", { name: "Fastest" }).click();
  await expect(page.getByRole("button", { name: "Fastest" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Suppliers" }).click();
  const links = page.getByRole("table", { name: "Supplier connections" });
  await expect(links.getByRole("row", { name: /Sandbox inventory/ })).toContainText("Connected");
});
```

- [ ] **Step 3: Run the e2e suite locally**

Start a dedicated API for e2e (dev DB, sandbox on, FX off so nothing depends on the ECB being reachable, signup limit raised):

```bash
cd /d/travel-rag-agent/backend
TM_FX_ENABLED=false TM_SIGNUP_MAX_PER_IP=1000 uv run python -m uvicorn travelmind.main:create_app --factory --port 8011
```

In another shell (stop any dev server on 5173 first, or accept `reuseExistingServer` if it already proxies to 8011):

```bash
cd /d/travel-rag-agent/frontend
TM_API_TARGET=http://localhost:8011 npm run e2e
```

Expected: 3 passed. Stop the 8011 server afterwards.

- [ ] **Step 4: CI and configuration**

In `.github/workflows/frontend.yml`, give the "Start the API" step an environment so e2e never calls the ECB:

```yaml
      - name: Start the API
        working-directory: backend
        env:
          TM_FX_ENABLED: "false"
        run: |
```

Append to `backend/.env.example` (skip any line Task 1 already added):

```bash
# Suppliers — all optional. Without keys the sandbox supplier serves demo flights.
TM_DUFFEL_TOKEN=            # duffel_test_… from the Duffel dashboard (test mode is free)
TM_LITEAPI_KEY=             # sand_… from the LiteAPI dashboard
TM_GOOGLE_TIM_API_KEY=      # Google Cloud API key with the Travel Impact Model API enabled
TM_TRAVELPAYOUTS_TOKEN=     # Travelpayouts Data API token (seeds fare history)
# TM_SANDBOX_SUPPLIER=false # sandbox flights are on by default outside production
# TM_FX_ENABLED=false       # ECB reference rates for "≈" converted prices
```

- [ ] **Step 5: README**

In `README.md`, change the status line to:

```markdown
> Status: Milestone 1 in progress. Plans 1 (backend foundation), 2 (Mission Control frontend) and 3 (offers engine) are complete.
```

and add after "### Frontend":

```markdown
### Suppliers and data

TravelMind runs without any supplier keys: a deterministic **sandbox** supplier serves demo flights
(labelled "Sandbox · not bookable"). Add keys to `backend/.env` to bring in real data:

| Variable | Source | What it adds |
|---|---|---|
| `TM_DUFFEL_TOKEN` | [Duffel](https://duffel.com) test token (`duffel_test_…`) | Real airline offers (test mode) with re-pricing |
| `TM_LITEAPI_KEY` | [LiteAPI](https://liteapi.travel) sandbox key (`sand_…`) | Hotel rates and cancellation terms |
| `TM_GOOGLE_TIM_API_KEY` | Google Cloud, Travel Impact Model API | Per-flight CO₂ per passenger |
| `TM_TRAVELPAYOUTS_TOKEN` | [Travelpayouts](https://travelpayouts.com) Data API | Market prices that seed fare history |

Every price carries its provenance — `LIVE`, `CACHED` (indicative) or `SANDBOX` — and prices converted
to the agency's currency are marked "≈" (ECB reference rates, display only). The Suppliers page shows
which links are connected. API notes: `docs/research/2026-09-29-supplier-apis.md`.
```

- [ ] **Step 6: Full verification**

Run backend: `cd backend && uv run python -m pytest -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Run frontend: `cd frontend && npm test && npm run lint && npm run typecheck && npm run build`
Plus the e2e run from Step 3. Expected: everything green; record counts in the report.

- [ ] **Step 7: Commit**

```bash
cd /d/travel-rag-agent
git add frontend .github backend/.env.example README.md
git commit -m "test(e2e): sandbox fare scan journey; document supplier keys"
```
