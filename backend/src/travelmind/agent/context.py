"""What a run's tools work with: the run's agency, user and role, and the run's memory.

`RunContext` carries a database session bound to the run's agency (RLS), Redis, settings and
the agency's display currency, country (guest nationality) and time zone. Build one with
`build_context`, which binds the session and reads the agency, so a tool can never see another
agency's rows.

`RunMemory` is the run's registry of what its tools returned: flight offers, hotels and places.
Each item gets a short run-scoped id (F1, H1, P1, ...) that the model sees and writes back; the
supplier's own id (a sandbox offer id is ~250 characters) stays here, and so does the price.
Later tools act only on ids in the memory: `price_check` and `draft_quote` re-price and quote the
real offer behind "F1", `build_itinerary` refuses ids no tool returned, and `estimate_budget`
sums the prices stored here, never a number the model wrote. The same supplier id seen again
keeps its short id and takes the newer card and price.

`snapshot()` / `RunMemory.restore()` round-trip the memory through JSON, so the engine can store
it with the run (after each tool step, say) and rebuild it for a resumed run.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
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


@dataclass(frozen=True)
class SeenItem:
    ref: str  # the run-scoped id the model sees ("F1")
    kind: ItemKind
    source_id: str  # the supplier's id (an offer id, an OSM element): never shown to the model
    label: str  # a short name for itineraries ("AI 101 DEL → BOM", a hotel's name)
    price: Money | None  # the total the model was shown, if the item has one
    card: dict[str, Any]  # the trimmed data the model was shown for it (with its ref)

    def to_json(self) -> dict[str, Any]:
        return {
            "ref": self.ref,
            "kind": self.kind,
            "source_id": self.source_id,
            "label": self.label,
            "price": self.price.model_dump() if self.price else None,
            "card": self.card,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "SeenItem":
        price = data.get("price")
        return cls(
            ref=str(data["ref"]),
            kind=cast(ItemKind, data["kind"]),
            source_id=str(data["source_id"]),
            label=str(data["label"]),
            price=Money.model_validate(price) if price else None,
            card=dict(data.get("card") or {}),
        )


class RunMemory:
    """The run's registry of tool-returned items, by short id (see the module docstring)."""

    def __init__(self) -> None:
        self._items: dict[str, SeenItem] = {}
        self._refs: dict[tuple[ItemKind, str], str] = {}
        self._counts: dict[ItemKind, int] = dict.fromkeys(PREFIXES, 0)

    def remember(
        self,
        kind: ItemKind,
        source_id: str,
        *,
        label: str,
        price: Money | None,
        card: dict[str, Any],
    ) -> SeenItem:
        """Record an item a tool is about to return; its card gets the short id as its first
        field (`offer_id`, `hotel_id` or `place_id`). A known source keeps its short id."""
        ref = self._refs.get((kind, source_id))
        if ref is None:
            self._counts[kind] += 1
            ref = f"{PREFIXES[kind]}{self._counts[kind]}"
            self._refs[(kind, source_id)] = ref
        return self._store(ref, kind, source_id, label, price, card)

    def replace(
        self,
        ref: str,
        *,
        source_id: str,
        label: str,
        price: Money | None,
        card: dict[str, Any],
    ) -> SeenItem:
        """Give an existing short id a fresh item (a price check's answer)."""
        old = self._items[ref]
        self._refs[(old.kind, source_id)] = ref
        return self._store(ref, old.kind, source_id, label, price, card)

    def _store(
        self,
        ref: str,
        kind: ItemKind,
        source_id: str,
        label: str,
        price: Money | None,
        card: dict[str, Any],
    ) -> SeenItem:
        body = {k: v for k, v in card.items() if k != ID_FIELDS[kind]}
        item = SeenItem(ref, kind, source_id, label, price, {ID_FIELDS[kind]: ref} | body)
        self._items[ref] = item
        return item

    def get(self, ref: str) -> SeenItem | None:
        return self._items.get(ref.strip().upper()) if isinstance(ref, str) else None

    def items(self) -> list[SeenItem]:
        return list(self._items.values())

    def snapshot(self) -> dict[str, Any]:
        """The memory as JSON-safe data (see `restore`)."""
        return {
            "version": SNAPSHOT_VERSION,
            "items": [item.to_json() for item in self._items.values()],
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

    def today(self) -> date:
        """Today in the agency's time zone."""
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
