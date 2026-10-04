"""What a run's tools work with: the run's agency, user and role, and the run's memory.

`RunContext` carries a database session bound to the run's agency (RLS), Redis, settings and
the agency's display currency, country (guest nationality) and time zone. Build one with
`build_context`, which binds the session and reads the agency, so a tool can never see another
agency's rows. `today()` is the agency's own date: the one "today" every tool (and the prompt)
uses, read from `clock`.

`RunMemory` is the run's registry of what its tools returned: flight offers, hotels and places.
Each item gets a short run-scoped id (F1, H1, P1, ...) that the model sees and writes back; the
supplier's own id (a sandbox offer id is ~250 characters) stays here, and so does the price.
Later tools act only on ids in the memory: `price_check` and `draft_quote` re-price and quote the
real offer behind "F1", `build_itinerary` refuses ids no tool returned, and `estimate_budget`
sums the prices stored here, never a number the model wrote. The same supplier id seen again
keeps its short id and takes the newer card and price.

Each item also keeps the supplier's own total (`supplier_price`, in the currency the supplier
bills, which differs from `price` when the shown total was converted) and the offer's expiry, so
a tool can refuse an offer before a service would (draft_quote: wrong currency, expired) with a
message that names the short id only.

The memory also keeps the airport codes `lookup_airport` returned (`airports`): a code that
reads as a city alias ("GOA" reads as Goa) is taken as the other airport (Genoa) only when the
run looked it up (`tools.travel.check_codes`).

`snapshot()` / `RunMemory.restore()` round-trip the memory through JSON, so the engine can store
it with the run (after each tool step, say) and rebuild it for a resumed run. The snapshot also
keeps every supplier id a short id has stood for (a price check's fresh offer replaces the one
searched, and both keep the same short id), and the looked-up airport codes.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from typing import Any, Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.config import Settings
from travelmind.db import bind_tenant, utcnow
from travelmind.identity import service as identity_service
from travelmind.offers.money import Money

AgentRole = Literal["agency", "traveller"]
ItemKind = Literal["flight", "hotel", "place"]
ROLES: tuple[AgentRole, ...] = ("agency", "traveller")
# The short id's letter and the field that carries it in a card.
PREFIXES: dict[ItemKind, str] = {"flight": "F", "hotel": "H", "place": "P"}
ID_FIELDS: dict[ItemKind, str] = {"flight": "offer_id", "hotel": "hotel_id", "place": "place_id"}
SNAPSHOT_VERSION = 1


def _money(value: object) -> Money | None:
    return Money.model_validate(value) if value else None


def _moment(value: object) -> datetime | None:
    return datetime.fromisoformat(value) if isinstance(value, str) else None


@dataclass(frozen=True)
class SeenItem:
    ref: str  # the run-scoped id the model sees ("F1")
    kind: ItemKind
    source_id: str  # the supplier's id (an offer id, an OSM element): never shown to the model
    label: str  # a short name for itineraries ("AI 101 DEL → BOM", a hotel's name)
    price: Money | None  # the total the model was shown, if the item has one
    card: dict[str, Any]  # the trimmed data the model was shown for it (with its ref)
    supplier_price: Money | None = None  # the supplier's own total, in the currency it bills
    expires_at: datetime | None = None  # when the supplier stops honouring the offer, if known

    @property
    def converted(self) -> bool:
        """The shown price is a conversion of the supplier's: an approximate ("≈") amount."""
        return (
            self.price is not None
            and self.supplier_price is not None
            and self.price.currency != self.supplier_price.currency
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "ref": self.ref,
            "kind": self.kind,
            "source_id": self.source_id,
            "label": self.label,
            "price": self.price.model_dump() if self.price else None,
            "card": self.card,
            "supplier_price": self.supplier_price.model_dump() if self.supplier_price else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "SeenItem":
        return cls(
            ref=str(data["ref"]),
            kind=cast(ItemKind, data["kind"]),
            source_id=str(data["source_id"]),
            label=str(data["label"]),
            price=_money(data.get("price")),
            card=dict(data.get("card") or {}),
            supplier_price=_money(data.get("supplier_price")),
            expires_at=_moment(data.get("expires_at")),
        )


class RunMemory:
    """The run's registry of tool-returned items, by short id (see the module docstring)."""

    def __init__(self) -> None:
        self._items: dict[str, SeenItem] = {}
        self._refs: dict[tuple[ItemKind, str], str] = {}
        self._counts: dict[ItemKind, int] = dict.fromkeys(PREFIXES, 0)
        self.airports: set[str] = set()  # codes lookup_airport returned in this run

    def note_airports(self, codes: Iterable[str]) -> None:
        self.airports.update(code for code in codes if isinstance(code, str))

    def remember(
        self,
        kind: ItemKind,
        source_id: str,
        *,
        label: str,
        price: Money | None,
        card: dict[str, Any],
        supplier_price: Money | None = None,
        expires_at: datetime | None = None,
    ) -> SeenItem:
        """Record an item a tool is about to return; its card gets the short id as its first
        field (`offer_id`, `hotel_id` or `place_id`). A known source keeps its short id."""
        ref = self._refs.get((kind, source_id))
        if ref is None:
            self._counts[kind] += 1
            ref = f"{PREFIXES[kind]}{self._counts[kind]}"
            self._refs[(kind, source_id)] = ref
        return self._store(
            SeenItem(ref, kind, source_id, label, price, card, supplier_price, expires_at)
        )

    def replace(
        self,
        ref: str,
        *,
        source_id: str,
        label: str,
        price: Money | None,
        card: dict[str, Any],
        supplier_price: Money | None = None,
        expires_at: datetime | None = None,
    ) -> SeenItem:
        """Give an existing short id a fresh item (a price check's answer). The supplier ids it
        stood for before keep pointing at it."""
        old = self._items[ref]
        self._refs[(old.kind, source_id)] = ref
        return self._store(
            SeenItem(ref, old.kind, source_id, label, price, card, supplier_price, expires_at)
        )

    def _store(self, item: SeenItem) -> SeenItem:
        id_field = ID_FIELDS[item.kind]
        body = {k: v for k, v in item.card.items() if k != id_field}
        stored = replace(item, card={id_field: item.ref} | body)
        self._items[item.ref] = stored
        return stored

    def get(self, ref: str) -> SeenItem | None:
        return self._items.get(ref.strip().upper()) if isinstance(ref, str) else None

    def items(self) -> list[SeenItem]:
        return list(self._items.values())

    def snapshot(self) -> dict[str, Any]:
        """The memory as JSON-safe data (see `restore`)."""
        return {
            "version": SNAPSHOT_VERSION,
            "items": [item.to_json() for item in self._items.values()],
            # Every supplier id each short id has stood for (a price check adds one).
            "aliases": [
                {"kind": kind, "source_id": source_id, "ref": ref}
                for (kind, source_id), ref in self._refs.items()
            ],
            "airports": sorted(self.airports),
        }

    @classmethod
    def restore(cls, data: dict[str, Any] | None) -> "RunMemory":
        memory = cls()
        for raw in (data or {}).get("items") or []:
            item = SeenItem.from_json(raw)
            memory._items[item.ref] = item
            memory._refs[(item.kind, item.source_id)] = item.ref
            number = int(item.ref[1:]) if item.ref[1:].isdigit() else 0
            memory._counts[item.kind] = max(memory._counts[item.kind], number)
        for alias in (data or {}).get("aliases") or []:
            kind, ref = alias.get("kind"), alias.get("ref")
            if kind in PREFIXES and ref in memory._items:
                memory._refs[(cast(ItemKind, kind), str(alias.get("source_id")))] = ref
        memory.note_airports(str(code) for code in (data or {}).get("airports") or [])
        return memory


@dataclass
class RunContext:
    db: AsyncSession  # bound to agency_id
    redis: Redis
    settings: Settings
    agency_id: UUID
    user_id: UUID
    role: AgentRole
    currency: str  # agency display currency
    country: str  # agency country (guest nationality)
    timezone: str
    memory: RunMemory = field(default_factory=RunMemory)
    clock: Callable[[], datetime] = utcnow

    def now(self) -> datetime:
        return self.clock()

    def today(self) -> date:
        """Today in the agency's time zone: the date every tool counts from."""
        return self.clock().astimezone(ZoneInfo(self.timezone)).date()

    @property
    def bound_agency(self) -> UUID | None:
        """The agency the session is bound to (tools refuse to run when it isn't agency_id)."""
        bound = self.db.info.get("agency_id")
        return UUID(str(bound)) if bound is not None else None


async def build_context(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    *,
    agency_id: UUID,
    user_id: UUID,
    role: AgentRole,
    memory: RunMemory | None = None,
    clock: Callable[[], datetime] = utcnow,
) -> RunContext:
    """Bind `db` to the agency and read its currency, country and time zone. The role comes
    from the server (the run's kind), never from the request."""
    if role not in ROLES:
        raise ValueError(f"Unknown agent role {role!r}.")
    agency_id = UUID(str(agency_id))
    await bind_tenant(db, agency_id)
    agency = await identity_service.get_agency(db, agency_id)
    context = RunContext(
        db=db,
        redis=redis,
        settings=settings,
        agency_id=agency_id,
        user_id=UUID(str(user_id)),
        role=role,
        currency=agency.currency,
        country=agency.country_code,
        timezone=agency.timezone,
        memory=memory or RunMemory(),
        clock=clock,
    )
    await db.commit()  # end the read: no connection held while the run waits on the model
    return context
