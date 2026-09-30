"""A workspace with a known history for the dashboard tests.

Everything goes through the workspace service helpers (back-dated with `now=`), except search
history, which is inserted directly as `flight_searches` + `search_source_results` rows with the
`search.*` activity a real search writes. Times are relative to the moment the fixture runs; the
agency is Alpha Travels (IN: INR, Asia/Kolkata), and every number the tests assert follows from
the rows below.

Enquiries (all created by the owner, none assigned):
  E-0001 DEL→BOM  new      Meera Kapoor, created 20 days ago, departs in 30 days
  E-0002 BOM→GOI  new      no client, created 3 days ago
  E-0003 DEL→GOI  quoting  Rohan Shah, created 6 days ago; Q-0001 sent 3 h after creation, then
                           moved back to quoting for a revision (draft Q-0002)
  E-0004 BOM→DEL  won      Meera Kapoor, 2 adults + 1 child, created 10 days ago, departs in
                           20 days; Q-0003 sent 1 h after creation, accepted 8 days ago
  E-0005 GOI→BOM  lost     created 12 days ago, lost 9 days ago
Quotes (INR, fixed markup 0, so sell = offer total):
  Q-0001 sent      v1: 600000 (CO2 100 kg/pax) and 650000 (no CO2)
  Q-0002 draft     v1: 700000
  Q-0003 accepted  v1: 800000 (CO2 150 kg/pax)
Flight searches (per traveller = cheapest / adults):
  DEL→BOM  20 d 500000 · 10 d 520000 · 2 d 450000 · 30 h 920000 for 2 adults (460000)
           · 30 h no offers · 3 h supplier error (no offers)
           · 15 d with a child (excluded) · 16 d billed in USD (excluded)
  DEL→GOI  12 d 900000 for 2 adults (no current samples: not a market-pulse route)
  BOM→DEL  16 d 400000 · 9 d 400000 · 4 d 398000 · 2 d 402000 (duffel: LIVE)
  plus one hotel search 1 day ago (activity only: no supplier key, so no source row).
Source results in the last 7 days: sandbox ok 100/200/300 ms (12, 9, 0 offers) + one error at
12000 ms; duffel ok 700/500 ms (6, 5 offers).
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.helpers import DEFAULT_PASSWORD, signup
from tests.offers.offer_factory import make_offer
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.offers.db_models import FlightSearchLog
from travelmind.offers.schemas import OfferView
from travelmind.offers.service import offer_view
from travelmind.workspace.activity import record_activity
from travelmind.workspace.clients import ClientCreate, create_client
from travelmind.workspace.enquiries import EnquiryCreate, create_enquiry, set_enquiry_status
from travelmind.workspace.models import SearchSourceResult
from travelmind.workspace.quotes import (
    QuoteCreate,
    add_version_from_views,
    create_quote,
    decide_quote,
    send_quote,
)

DAY = timedelta(days=1)
HOUR = timedelta(hours=1)
MINUTE = timedelta(minutes=1)

Source = tuple[str, str, int, int]  # supplier, status, offer count, latency ms


def view(ref: str, total_minor: int, co2: int | None = None) -> OfferView:
    offer = make_offer(
        [("DEL", "BOM", "AI", "101", "2026-11-20T08:00:00+00:00")],
        offer_ref=ref,
        supplier="sandbox",
        total_minor=total_minor,
        co2_kg_per_passenger=co2,
    )
    return offer_view(offer, offer.total, None)


async def add_search(
    db: AsyncSession,
    agency_id: UUID,
    user_id: UUID,
    at: datetime,
    route: tuple[str, str],
    cheapest: int | None,
    sources: list[Source],
    *,
    adults: int = 1,
    children: int = 0,
    currency: str = "INR",
) -> None:
    """One flight search as `search_flights` logs it: the search, its sources and its activity."""
    origin, destination = route
    search_id = uuid4()
    offers = sum(count for _, _, count, _ in sources)
    db.add(
        FlightSearchLog(
            id=search_id,
            agency_id=agency_id,
            user_id=user_id,
            origin=origin,
            destination=destination,
            departure_date=(at + 30 * DAY).date(),
            return_date=None,
            adults=adults,
            children=children,
            cabin="economy",
            offer_count=offers,
            display_currency=currency,
            cheapest_minor=cheapest,
            created_at=at,
        )
    )
    for supplier, status, count, latency in sources:
        db.add(
            SearchSourceResult(
                agency_id=agency_id,
                search_kind="flights",
                search_id=search_id,
                supplier=supplier,
                status=status,
                offer_count=count,
                latency_ms=latency,
                occurred_at=at,
            )
        )
    await record_activity(
        db,
        agency_id=agency_id,
        kind="search.flights",
        summary=f"Searched {origin} → {destination}",
        actor_user_id=user_id,
        data={"origin": origin, "destination": destination, "offers": offers},
        occurred_at=at,
    )


async def build_workspace(db: AsyncSession, agency_id: UUID, user_id: UUID, now: datetime) -> None:
    meera = await create_client(
        db,
        agency_id,
        user_id,
        ClientCreate(
            name="Meera Kapoor", email="meera@example.com", company_name="Nimbus Analytics Pvt Ltd"
        ),
        now=now - 25 * DAY,
    )
    rohan = await create_client(
        db,
        agency_id,
        user_id,
        ClientCreate(name="Rohan Shah", email="rohan@example.com"),
        now=now - 25 * DAY,
    )

    async def enquiry(at: datetime, **fields: object):
        return await create_enquiry(
            db, agency_id, user_id, EnquiryCreate.model_validate(fields), now=at
        )

    await enquiry(
        now - 20 * DAY,
        origin="DEL",
        destination="BOM",
        client_id=meera.id,
        depart_date=(now + 30 * DAY).date(),
    )
    await enquiry(now - 3 * DAY, origin="BOM", destination="GOI")
    revising = await enquiry(now - 6 * DAY, origin="DEL", destination="GOI", client_id=rohan.id)
    won = await enquiry(
        now - 10 * DAY,
        origin="BOM",
        destination="DEL",
        client_id=meera.id,
        adults=2,
        children_ages=[5],
        depart_date=(now + 20 * DAY).date(),
    )
    lost = await enquiry(now - 12 * DAY, origin="GOI", destination="BOM")

    no_markup = {"markup_kind": "fixed", "markup_value": 0}
    start = now - 6 * DAY
    q1 = await create_quote(
        db,
        agency_id,
        user_id,
        QuoteCreate(enquiry_id=revising.id, **no_markup),
        now=start + HOUR,
    )
    await add_version_from_views(
        db,
        q1,
        [view("q1-a", 600000, co2=100), view("q1-b", 650000)],
        "Two options",
        user_id,
        now=start + 2 * HOUR,
    )
    await send_quote(db, q1, user_id, now=start + 3 * HOUR)
    await set_enquiry_status(db, revising, "quoting", user_id, now=now - 5 * DAY)
    q2 = await create_quote(
        db,
        agency_id,
        user_id,
        QuoteCreate(enquiry_id=revising.id, **no_markup),
        now=now - 4 * DAY,
    )
    await add_version_from_views(
        db, q2, [view("q2-a", 700000)], "Revised", user_id, now=now - 4 * DAY + HOUR
    )

    start = now - 10 * DAY
    q3 = await create_quote(
        db,
        agency_id,
        user_id,
        QuoteCreate(enquiry_id=won.id, **no_markup),
        now=start + 30 * MINUTE,
    )
    await add_version_from_views(
        db, q3, [view("q3-a", 800000, co2=150)], "", user_id, now=start + 45 * MINUTE
    )
    await send_quote(db, q3, user_id, now=start + HOUR)
    await decide_quote(db, q3, "accepted", user_id, now=now - 8 * DAY)

    await set_enquiry_status(
        db, lost, "lost", user_id, lost_reason="Chose another agency", now=now - 9 * DAY
    )

    del_bom, del_goi, bom_del = ("DEL", "BOM"), ("DEL", "GOI"), ("BOM", "DEL")
    sandbox_ok = "sandbox", "ok"
    for at, route, cheapest, sources, extra in [
        (20 * DAY, del_bom, 500000, [(*sandbox_ok, 10, 800)], {}),
        (10 * DAY, del_bom, 520000, [(*sandbox_ok, 8, 700)], {}),
        (2 * DAY, del_bom, 450000, [(*sandbox_ok, 12, 100)], {}),
        (30 * HOUR, del_bom, 920000, [(*sandbox_ok, 9, 200)], {"adults": 2}),
        (30 * HOUR - MINUTE, del_bom, None, [(*sandbox_ok, 0, 300)], {}),
        (3 * HOUR, del_bom, None, [("sandbox", "error", 0, 12000)], {}),
        (15 * DAY, del_bom, 100000, [(*sandbox_ok, 7, 600)], {"children": 1}),
        (16 * DAY, del_bom, 6000, [(*sandbox_ok, 5, 650)], {"currency": "USD"}),
        (12 * DAY, del_goi, 900000, [(*sandbox_ok, 6, 400)], {"adults": 2}),
        (16 * DAY, bom_del, 400000, [("duffel", "ok", 5, 900)], {}),
        (9 * DAY, bom_del, 400000, [("duffel", "ok", 5, 900)], {}),
        (4 * DAY, bom_del, 398000, [("duffel", "ok", 6, 700)], {}),
        (2 * DAY, bom_del, 402000, [("duffel", "ok", 5, 500)], {}),
    ]:
        await add_search(db, agency_id, user_id, now - at, route, cheapest, sources, **extra)
    await record_activity(
        db,
        agency_id=agency_id,
        kind="search.hotels",
        summary="Searched hotels near GOI · 0 offers",
        actor_user_id=user_id,
        data={"destination": "GOI", "offers": 0},
        occurred_at=now - DAY,
    )


async def join_agent(owner, agent):
    """Invite agent Ravi from the owner's client and sign them in on `agent`; returns the user."""
    invite = await owner.post(
        "/api/v1/invitations", json={"email": "agent@alphatravels.com", "role": "agent"}
    )
    joined = await agent.post(
        "/api/v1/invitations/accept",
        json={
            "token": invite.json()["token"],
            "full_name": "Ravi Agent",
            "password": DEFAULT_PASSWORD,
        },
    )
    assert joined.status_code == 201
    return joined.json()["user"]


@pytest.fixture
async def seeded(client, airports):
    """(client signed in as the owner, agency id, the moment the history was built from)."""
    me = (await signup(client)).json()
    agency_id = UUID(me["agency"]["id"])
    user_id = UUID(me["user"]["id"])
    now = datetime.now(UTC)
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        await build_workspace(db, agency_id, user_id, now)
        await db.commit()
    return client, agency_id, now
