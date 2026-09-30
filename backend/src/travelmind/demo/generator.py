"""Demo workspace content: a pure, seeded plan, executed through the workspace and offers
services so every row, number and activity event is exactly what real use would produce.

`build_demo_plan` decides who the clients are, which trips they ask for and how each enquiry
moves through the pipeline (with back-dated moments in working hours over the last 30 days).
`seed_demo_workspace` carries the plan out: prices come from real sandbox searches of each
enquiry's trip, never from the plan.
"""

import random
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from functools import partial
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.config import Settings
from travelmind.db import Base, bind_tenant
from travelmind.demo.data import (
    AGENT_NAMES,
    CLIENT_NAMES,
    CLIENT_TAGS,
    COMPANY_NAMES,
    LOST_REASONS,
    NOTE_TEMPLATES,
    ROUTES,
    VERSION_MESSAGES,
)
from travelmind.identity import service as identity_service
from travelmind.identity.service import AgencySettings, TeamMember
from travelmind.offers.db_models import FlightSearchLog
from travelmind.offers.models import Cabin, FlightSearchRequest
from travelmind.offers.schemas import OfferView
from travelmind.offers.service import search_flights
from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier
from travelmind.reference.search import AirportRecord
from travelmind.reference.service import get_airport_index
from travelmind.workspace.clients import ClientCreate, create_client
from travelmind.workspace.enquiries import (
    EnquiryCreate,
    EnquiryStatus,
    create_enquiry,
    load_enquiry,
    set_enquiry_status,
)
from travelmind.workspace.models import ActivityEvent, Client, Enquiry, Quote
from travelmind.workspace.quotes import (
    QuoteCreate,
    add_version_from_views,
    create_quote,
    decide_quote,
    load_quote,
    send_quote,
)

__all__ = [
    "DemoClient",
    "DemoDecision",
    "DemoEnquiry",
    "DemoPlan",
    "DemoSearch",
    "DemoStatusStep",
    "DemoSummary",
    "DemoUnavailable",
    "DemoVersionSpec",
    "build_demo_plan",
    "demo_routes",
    "seed_demo_workspace",
]

log = structlog.get_logger()

HISTORY_DAYS = 30
WORKDAY_START = time(9)
WORKDAY_MINUTES = 10 * 60  # 09:00–19:00 agency time
TEAM_SIZE = 1 + len(AGENT_NAMES)
MIN_ROUTES = 3
CLIENT_COUNT = 40
COMPANY_COUNT = 10
EXTRA_SEARCHES = 30
PULSE_ROUTES = 3
PULSE_RECENT = 4  # per pulse route, in the last 7 days
PULSE_EARLIER = 5  # per pulse route, 8–29 days back
MARKUPS_BP = (500, 750, 800, 1000, 1200)
# New enquiries a teammate logged yesterday and handed to the presenter: the presenter's bell has
# fresh news when the demo opens (see NOTIFICATIONS_SEEN_AGO).
HANDOFFS = 3
NOTIFICATIONS_SEEN_AGO = timedelta(days=2)
_COMPANY_CABINS: tuple[Cabin, ...] = ("economy", "economy", "business")
_PERSONAL_CABINS: tuple[Cabin, ...] = ("economy",) * 8 + ("premium_economy", "business")

# How the 60 enquiries end up (35 of them with a quote):
# quoted and won went through a sent quote; "quoting_draft" has an unsent quote;
# "lost_declined" lost when the client declined the quote; the rest were moved by hand.
_OUTCOMES: tuple[tuple[str, int], ...] = (
    ("new", 12),
    ("quoting_manual", 8),
    ("quoting_draft", 2),
    ("quoted", 16),
    ("won", 14),
    ("lost_manual", 5),
    ("lost_declined", 3),
)
# How long ago (days) each kind of enquiry came in: worked ones are older.
_CREATED_DAYS: dict[str, tuple[int, int]] = {
    "new": (1, 8),
    "quoting_manual": (1, 12),
    "quoting_draft": (2, 12),
    "quoted": (3, 24),
    "won": (6, 29),
    "lost_manual": (3, 28),
    "lost_declined": (5, 28),
}
_FINAL_STATUS: dict[str, EnquiryStatus] = {
    "new": "new",
    "quoting_manual": "quoting",
    "quoting_draft": "quoting",
    "quoted": "quoted",
    "won": "won",
    "lost_manual": "lost",
    "lost_declined": "lost",
}

# (days ago, minutes after 09:00 agency time). Later moments sort after earlier ones.
Stamp = tuple[int, int]


def _order(stamp: Stamp) -> tuple[int, int]:
    return -stamp[0], stamp[1]


@dataclass(frozen=True)
class DemoClient:
    kind: Literal["individual", "company"]
    name: str
    email: str | None
    phone: str | None
    company_name: str | None
    home_airport: str | None
    notes: str | None
    tags: tuple[str, ...]
    creator: int  # index into the team (0 = the presenter)
    created: Stamp


@dataclass(frozen=True)
class DemoVersionSpec:
    """One quote version: how many offers it shows and its markup. Prices come from the sandbox
    search of the enquiry's trip made at `created`."""

    options: int
    markup_bp: int
    message: str
    created: Stamp
    sent: Stamp | None


@dataclass(frozen=True)
class DemoStatusStep:
    """A pipeline move made by hand (moves that follow a quote happen by themselves)."""

    status: EnquiryStatus
    at: Stamp
    lost_reason: str | None = None


@dataclass(frozen=True)
class DemoDecision:
    status: Literal["accepted", "declined"]
    at: Stamp


@dataclass(frozen=True)
class DemoEnquiry:
    client: int | None  # index into DemoPlan.clients
    origin: str
    destination: str
    depart_date: date
    return_date: date | None
    adults: int
    children_ages: tuple[int, ...]
    cabin: Cabin
    budget_minor: int | None  # in the agency currency
    notes: str | None
    assignee: int
    creator: int  # who logged it: the assignee, or a teammate handing it over
    created: Stamp
    status: EnquiryStatus  # where the plan leaves it
    status_path: tuple[DemoStatusStep, ...]
    quote_versions: tuple[DemoVersionSpec, ...]
    decision: DemoDecision | None


@dataclass(frozen=True)
class DemoSearch:
    origin: str
    destination: str
    depart_date: date
    adults: int
    actor: int
    at: Stamp


@dataclass(frozen=True)
class DemoPlan:
    clients: tuple[DemoClient, ...]
    enquiries: tuple[DemoEnquiry, ...]
    extra_searches: tuple[DemoSearch, ...]


@dataclass(frozen=True)
class DemoSummary:
    clients: int
    enquiries: int
    quotes: int
    events: int
    searches: int


class DemoUnavailable(Exception):
    """The reference data can't support a demo (too few known airports)."""


def demo_routes(lookup: Callable[[str], AirportRecord | None]) -> list[tuple[str, str]]:
    """The curated routes whose airports are known; with fewer than MIN_ROUTES of them, every
    pair of the curated airports that are known."""
    routes = [(a, b) for a, b in ROUTES if lookup(a) is not None and lookup(b) is not None]
    if len(routes) >= MIN_ROUTES:
        return routes
    known = [code for code in dict.fromkeys(c for route in ROUTES for c in route) if lookup(code)]
    pairs = [(a, b) for a in known for b in known if a != b]
    if not pairs:
        raise DemoUnavailable("The demo needs airport reference data. Please try again later.")
    return pairs


# --- the plan (pure) --------------------------------------------------------------------------


def _after(rng: random.Random, stamp: Stamp) -> Stamp:
    """A moment after `stamp`: later the same working day or on a following day (never today,
    so the whole history is in the past whatever the time now)."""
    days, minute = stamp
    if days > 1 and rng.random() < 0.45:
        return days - rng.randint(1, min(2, days - 1)), rng.randint(0, WORKDAY_MINUTES - 1)
    later = minute + rng.randint(10, 180)
    if later < WORKDAY_MINUTES:
        return days, later
    if days > 1:
        return days - 1, rng.randint(0, 120)
    return days, min(minute + 1, WORKDAY_MINUTES - 1)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _plan_clients(rng: random.Random, airports: Sequence[str]) -> list[DemoClient]:
    people = rng.sample(CLIENT_NAMES, CLIENT_COUNT - COMPANY_COUNT)
    companies = rng.sample(COMPANY_NAMES, COMPANY_COUNT)
    phones = rng.sample(range(10_000), CLIENT_COUNT)
    entries: list[tuple[str, str]] = [("individual", n) for n in people] + [
        ("company", n) for n in companies
    ]
    rng.shuffle(entries)
    clients: list[DemoClient] = []
    for i, (kind, name) in enumerate(entries):
        # A dozen came over on day one; the rest arrived over the month.
        created: Stamp = (
            (HISTORY_DAYS, rng.randint(0, 120))
            if i < 12
            else (rng.randint(2, HISTORY_DAYS - 1), rng.randint(0, WORKDAY_MINUTES - 1))
        )
        if kind == "company":
            email = f"travel.{_slug(name)}@example.com"
            tags = ("corporate", *(("vip",) if rng.random() < 0.3 else ()))
        else:
            parts = name.split()
            email = f"{_slug(parts[0])}.{_slug(parts[-1])}@example.com"
            tags = tuple(
                rng.sample([t for t in CLIENT_TAGS if t != "corporate"], rng.randint(0, 2))
            )
        clients.append(
            DemoClient(
                kind="company" if kind == "company" else "individual",
                name=name,
                email=None if rng.random() < 0.15 else email,
                phone=None if rng.random() < 0.1 else f"+91 90000 0{phones[i]:04d}",
                company_name=name if kind == "company" else None,
                home_airport=rng.choice(airports) if rng.random() < 0.7 else None,
                notes=rng.choice(NOTE_TEMPLATES) if rng.random() < 0.3 else None,
                tags=tags,
                creator=rng.randrange(TEAM_SIZE),
                created=created,
            )
        )
    clients.sort(key=lambda c: _order(c.created))
    return clients


def _plan_quote(
    rng: random.Random, outcome: str, start: Stamp
) -> tuple[tuple[DemoVersionSpec, ...], DemoDecision | None]:
    sending = outcome != "quoting_draft"
    count = rng.choice((1, 1, 2, 2, 3)) if sending else rng.choice((1, 2))
    markup = rng.choice(MARKUPS_BP)
    versions: list[DemoVersionSpec] = []
    at = start
    for k in range(count):
        if k:
            at = _after(rng, at)
            markup = max(300, markup - 100 * rng.randint(0, 3))
        sent = _after(rng, at) if sending else None
        versions.append(
            DemoVersionSpec(
                options=rng.choice((1, 2, 2, 3, 3)),
                markup_bp=markup,
                message=VERSION_MESSAGES[min(k, len(VERSION_MESSAGES) - 1)],
                created=at,
                sent=sent,
            )
        )
        at = sent or at
    decision = None
    if outcome == "won":
        decision = DemoDecision("accepted", _after(rng, at))
    elif outcome == "lost_declined":
        decision = DemoDecision("declined", _after(rng, at))
    return tuple(versions), decision


def _manual_path(rng: random.Random, outcome: str, start: Stamp) -> tuple[DemoStatusStep, ...]:
    if outcome == "quoting_manual":
        return (DemoStatusStep("quoting", start),)
    if outcome == "lost_manual":
        reason = rng.choice(LOST_REASONS)
        if rng.random() < 0.5:
            return (DemoStatusStep("lost", start, reason),)
        return (
            DemoStatusStep("quoting", start),
            DemoStatusStep("lost", _after(rng, start), reason),
        )
    return ()


def _plan_enquiries(
    rng: random.Random,
    routes: Sequence[tuple[str, str]],
    clients: Sequence[DemoClient],
    today: date,
) -> list[DemoEnquiry]:
    outcomes = [outcome for outcome, count in _OUTCOMES for _ in range(count)]
    rng.shuffle(outcomes)
    dated: list[tuple[str, Stamp, bool]] = []
    handoffs = 0
    for outcome in outcomes:
        low, high = _CREATED_DAYS[outcome]
        handoff = outcome == "new" and handoffs < HANDOFFS
        handoffs += handoff
        days = 1 if handoff else rng.randint(low, high)
        dated.append((outcome, (days, rng.randint(0, WORKDAY_MINUTES - 1)), handoff))
    dated.sort(key=lambda item: _order(item[1]))
    assignees = [i % TEAM_SIZE for i in range(len(dated))]
    rng.shuffle(assignees)
    # Hand-offs go to the presenter: swap with enquiries the presenter held, keeping the spread.
    for i, (_, _, handoff) in enumerate(dated):
        if handoff and assignees[i] != 0:
            j = next(j for j, a in enumerate(assignees) if a == 0 and not dated[j][2])
            assignees[i], assignees[j] = 0, assignees[i]
    enquiries: list[DemoEnquiry] = []
    for (outcome, created, handoff), assignee in zip(dated, assignees, strict=True):
        known = [i for i, c in enumerate(clients) if _order(c.created) < _order(created)]
        client_index = rng.choice(known) if known and rng.random() < 0.95 else None
        company = client_index is not None and clients[client_index].kind == "company"
        origin, destination = rng.choice(routes)
        if outcome == "won":
            depart = today + timedelta(days=rng.randint(3, 75))
        else:
            depart = today + timedelta(days=rng.randint(7, 120))
        returning = rng.random() < 0.6
        family = not company and rng.random() < 0.2
        start = _after(rng, created)
        versions: tuple[DemoVersionSpec, ...] = ()
        decision = None
        if outcome in ("quoting_draft", "quoted", "won", "lost_declined"):
            versions, decision = _plan_quote(rng, outcome, start)
        enquiries.append(
            DemoEnquiry(
                client=client_index,
                origin=origin,
                destination=destination,
                depart_date=depart,
                return_date=depart + timedelta(days=rng.randint(3, 14)) if returning else None,
                adults=rng.randint(1, 6) if company else rng.randint(1, 4),
                children_ages=tuple(rng.randint(1, 14) for _ in range(rng.randint(1, 2)))
                if family
                else (),
                cabin=rng.choice(_COMPANY_CABINS if company else _PERSONAL_CABINS),
                budget_minor=rng.randrange(20_000, 400_000, 500) * 100
                if rng.random() < 0.5
                else None,
                notes=rng.choice(NOTE_TEMPLATES) if rng.random() < 0.5 else None,
                assignee=assignee,
                creator=rng.randrange(1, TEAM_SIZE) if handoff else assignee,
                created=created,
                status=_FINAL_STATUS[outcome],
                status_path=_manual_path(rng, outcome, start),
                quote_versions=versions,
                decision=decision,
            )
        )
    return enquiries


def _plan_searches(
    rng: random.Random, routes: Sequence[tuple[str, str]], today: date
) -> list[DemoSearch]:
    """Fare checks outside any quote: a few watched routes searched both this week and in the
    weeks before (so their price movement shows), plus some one-offs."""
    watched = rng.sample(list(routes), min(PULSE_ROUTES, len(routes)))
    moments: list[tuple[tuple[str, str], int]] = []
    for route in watched:
        # One of this week's checks is from the last day, so supplier health has fresh calls.
        moments += [(route, 0)] + [(route, rng.randint(0, 6)) for _ in range(PULSE_RECENT - 1)]
        moments += [(route, rng.randint(8, HISTORY_DAYS - 1)) for _ in range(PULSE_EARLIER)]
    while len(moments) < EXTRA_SEARCHES:
        moments.append((rng.choice(routes), rng.randint(0, HISTORY_DAYS - 1)))
    searches = [
        DemoSearch(
            origin=origin,
            destination=destination,
            depart_date=today + timedelta(days=rng.randint(10, 60)),
            adults=rng.randint(1, 3),
            actor=rng.randrange(TEAM_SIZE),
            at=(days, rng.randint(0, WORKDAY_MINUTES - 1)),
        )
        for (origin, destination), days in moments[:EXTRA_SEARCHES]
    ]
    searches.sort(key=lambda s: _order(s.at))
    return searches


def build_demo_plan(seed: int, routes: list[tuple[str, str]], today: date) -> DemoPlan:
    """The same seed, routes and day always give the same plan."""
    if not routes:
        raise DemoUnavailable("The demo needs at least one route.")
    rng = random.Random(seed)
    airports = list(dict.fromkeys(origin for origin, _ in routes))
    clients = _plan_clients(rng, airports)
    enquiries = _plan_enquiries(rng, routes, clients, today)
    searches = _plan_searches(rng, routes, today)
    return DemoPlan(
        clients=tuple(clients), enquiries=tuple(enquiries), extra_searches=tuple(searches)
    )


# --- carrying it out --------------------------------------------------------------------------

_Action = Callable[[], Awaitable[None]]


class _Seeder:
    def __init__(
        self,
        db: AsyncSession,
        redis: Redis,
        settings: Settings,
        agency: AgencySettings,
        users: Sequence[TeamMember],
        now: datetime,
        lookup: Callable[[str], AirportRecord | None],
    ) -> None:
        self.db = db
        self.redis = redis
        self.settings = settings
        self.agency = agency
        self.users = users
        self.now = now
        self.zone = ZoneInfo(agency.timezone)
        self.today = now.astimezone(self.zone).date()
        self.suppliers = [SandboxFlightSupplier(lookup)]
        self.clients: dict[int, UUID] = {}
        self.enquiries: dict[int, UUID] = {}
        self.quotes: dict[int, UUID] = {}

    def at(self, stamp: Stamp) -> datetime:
        days, minute = stamp
        local = datetime.combine(
            self.today - timedelta(days=days), WORKDAY_START, tzinfo=self.zone
        ) + timedelta(minutes=minute)
        if local > self.now:  # later today: use the same time yesterday instead
            local -= timedelta(days=1)
        return local

    def user(self, index: int) -> UUID:
        return self.users[index % len(self.users)].id

    async def search(
        self, request: FlightSearchRequest, actor: int, stamp: Stamp
    ) -> list[OfferView]:
        response = await search_flights(
            self.db,
            self.redis,
            self.settings,
            request,
            agency_id=self.agency.id,
            user_id=self.user(actor),
            suppliers=self.suppliers,
            enforce_budget=False,
            occurred_at=self.at(stamp),
        )
        return response.offers

    async def create_client(self, index: int, spec: DemoClient) -> None:
        data = ClientCreate(
            kind=spec.kind,
            name=spec.name,
            email=spec.email,
            phone=spec.phone,
            company_name=spec.company_name,
            home_airport=spec.home_airport,
            notes=spec.notes,
            tags=list(spec.tags),
        )
        client = await create_client(
            self.db, self.agency.id, self.user(spec.creator), data, now=self.at(spec.created)
        )
        self.clients[index] = client.id

    async def create_enquiry(self, index: int, spec: DemoEnquiry) -> None:
        data = EnquiryCreate(
            client_id=self.clients[spec.client] if spec.client is not None else None,
            origin=spec.origin,
            destination=spec.destination,
            depart_date=spec.depart_date,
            return_date=spec.return_date,
            adults=spec.adults,
            children_ages=list(spec.children_ages),
            cabin=spec.cabin,
            budget_minor=spec.budget_minor,
            budget_currency=self.agency.currency if spec.budget_minor is not None else None,
            notes=spec.notes,
            assignee_user_id=self.user(spec.assignee),
        )
        enquiry = await create_enquiry(
            self.db, self.agency.id, self.user(spec.creator), data, now=self.at(spec.created)
        )
        self.enquiries[index] = enquiry.id

    async def move(self, index: int, spec: DemoEnquiry, step: DemoStatusStep) -> None:
        enquiry = await load_enquiry(self.db, self.enquiries[index], for_update=True)
        await set_enquiry_status(
            self.db,
            enquiry,
            step.status,
            self.user(spec.assignee),
            lost_reason=step.lost_reason,
            now=self.at(step.at),
        )

    async def add_version(self, index: int, spec: DemoEnquiry, number: int) -> None:
        version = spec.quote_versions[number]
        actor = self.user(spec.assignee)
        request = FlightSearchRequest(
            origin=spec.origin,
            destination=spec.destination,
            departure_date=spec.depart_date,
            return_date=spec.return_date,
            adults=spec.adults,
            children_ages=list(spec.children_ages),
            cabin=spec.cabin,
        )
        offers = await self.search(request, spec.assignee, version.created)
        if not offers:
            raise RuntimeError("The sandbox returned no offers for a demo trip.")
        count = min(version.options, len(offers))
        start = number % (len(offers) - count + 1)
        chosen = offers[start : start + count]
        at = self.at(version.created)
        if number == 0:
            quote = await create_quote(
                self.db,
                self.agency.id,
                actor,
                QuoteCreate(
                    enquiry_id=self.enquiries[index],
                    currency=chosen[0].total.currency,
                    markup_kind="percent",
                    markup_value=version.markup_bp,
                ),
                now=at,
            )
            self.quotes[index] = quote.id
            markups = None
        else:
            quote = await load_quote(self.db, self.quotes[index], for_update=True)
            markups = [version.markup_bp] * len(chosen)
        await add_version_from_views(
            self.db, quote, chosen, version.message, actor, option_markups=markups, now=at
        )

    async def send(self, index: int, spec: DemoEnquiry, stamp: Stamp) -> None:
        quote = await load_quote(self.db, self.quotes[index], for_update=True)
        # The share link is never used in a demo; the token is dropped (only its hash is kept).
        await send_quote(self.db, quote, self.user(spec.assignee), now=self.at(stamp))

    async def decide(self, index: int, spec: DemoEnquiry, decision: DemoDecision) -> None:
        quote = await load_quote(self.db, self.quotes[index], for_update=True)
        await decide_quote(
            self.db, quote, decision.status, self.user(spec.assignee), now=self.at(decision.at)
        )

    async def extra_search(self, spec: DemoSearch) -> None:
        request = FlightSearchRequest(
            origin=spec.origin,
            destination=spec.destination,
            departure_date=spec.depart_date,
            adults=spec.adults,
        )
        await self.search(request, spec.actor, spec.at)

    def actions(self, plan: DemoPlan) -> list[tuple[tuple[int, int], _Action]]:
        """Every step of the plan with its moment; each entity's own steps are in order."""
        steps: list[tuple[tuple[int, int], _Action]] = []
        for i, client in enumerate(plan.clients):
            steps.append((_order(client.created), partial(self.create_client, i, client)))
        for i, enquiry in enumerate(plan.enquiries):
            steps.append((_order(enquiry.created), partial(self.create_enquiry, i, enquiry)))
            for step in enquiry.status_path:
                steps.append((_order(step.at), partial(self.move, i, enquiry, step)))
            for n, version in enumerate(enquiry.quote_versions):
                steps.append((_order(version.created), partial(self.add_version, i, enquiry, n)))
                if version.sent is not None:
                    steps.append(
                        (_order(version.sent), partial(self.send, i, enquiry, version.sent))
                    )
            if enquiry.decision is not None:
                steps.append(
                    (
                        _order(enquiry.decision.at),
                        partial(self.decide, i, enquiry, enquiry.decision),
                    )
                )
        for search in plan.extra_searches:
            steps.append((_order(search.at), partial(self.extra_search, search)))
        # Stable sort: steps at the same moment keep their order, so an entity's own steps
        # (which never go back in time) still run in sequence.
        steps.sort(key=lambda item: item[0])
        return steps


def _demo_settings(settings: Settings) -> Settings:
    """Demo searches only ever call the in-process sandbox: no FX feed, emissions or market
    seeding calls to outside services."""
    return settings.model_copy(
        update={"fx_enabled": False, "google_tim_api_key": "", "travelpayouts_token": ""}
    )


async def _count(db: AsyncSession, model: type[Base]) -> int:
    return int(await db.scalar(select(func.count()).select_from(model)) or 0)


async def seed_demo_workspace(
    db: AsyncSession,
    redis: Redis,
    settings: Settings,
    *,
    agency: AgencySettings,
    users: Sequence[TeamMember],
    now: datetime,
) -> DemoSummary:
    """Fill a (new, empty) demo agency with a month of work, through the services, and leave
    the presenter (`users[0]`) with the last two days' notifications unread. Commits.

    Raises DemoUnavailable when the airport reference data can't support the demo.
    """
    await bind_tenant(db, agency.id)
    index = await get_airport_index(db)
    routes = demo_routes(index.get)
    seeder = _Seeder(db, redis, _demo_settings(settings), agency, users, now, index.get)
    plan = build_demo_plan(seed=agency.id.int, routes=routes, today=seeder.today)
    for _, action in seeder.actions(plan):
        await action()
    # The presenter last opened the bell two days ago: what teammates did since is unread.
    await identity_service.set_notifications_seen_at(db, users[0].id, now - NOTIFICATIONS_SEEN_AGO)
    await db.commit()
    summary = DemoSummary(
        clients=await _count(db, Client),
        enquiries=await _count(db, Enquiry),
        quotes=await _count(db, Quote),
        events=await _count(db, ActivityEvent),
        searches=await _count(db, FlightSearchLog),
    )
    log.info("demo_workspace_seeded", agency_id=str(agency.id), **summary.__dict__)
    return summary
