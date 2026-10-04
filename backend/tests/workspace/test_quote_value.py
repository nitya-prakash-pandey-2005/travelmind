"""One quote value everywhere: the quote reads, the client's won value, the team's won value and
the Command Center pipeline all value a quote the same way.

- accepted: the option the client accepted, from the version they were sent (else, when the agent
  marked it accepted, that version's cheapest option);
- otherwise, once sent: the cheapest option of the sent version (a newer, unsent draft version
  doesn't count);
- never sent: the cheapest option of the current version; no version yet: no value.

Won value counts at most one accepted quote per enquiry: the one decided last.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from tests.dashboard.fixtures import view
from tests.helpers import signup
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.workspace.clients import ClientCreate, create_client
from travelmind.workspace.enquiries import EnquiryCreate, create_enquiry
from travelmind.workspace.quotes import (
    QuoteCreate,
    add_version_from_views,
    create_quote,
    decide_quote,
    send_quote,
)

DAY = timedelta(days=1)
HOUR = timedelta(hours=1)
NO_MARKUP = {"markup_kind": "fixed", "markup_value": 0}


async def build(agency_id: UUID, user_id: UUID, now: datetime) -> dict[str, UUID]:
    """Nimbus (a company client) with two won enquiries, one quoted and one new.

    Q-0001  E-0001 won   v1 950000 | 900000  sent, accepted by the agent 1 day ago (latest)
    Q-0002  E-0001 won   v1 500000 | 300000  sent, client accepted option 0 2 days ago
    Q-0003  E-0002 won   v1 450000 | 250000  sent, client accepted option 0
    Q-0004  E-0003 quoted v1 400000 | 350000 sent; v2 100000 not sent yet
    Q-0005  E-0004 new→quoting  v1 200000 | 250000 draft
    Q-0006  E-0004 draft, no version
    """
    ids: dict[str, UUID] = {}
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        nimbus = await create_client(
            db,
            agency_id,
            user_id,
            ClientCreate(kind="company", name="Nimbus Analytics", company_name="Nimbus"),
            now=now - 9 * DAY,
        )
        ids["client"] = nimbus.id

        async def enquiry():  # type: ignore[no-untyped-def]
            return await create_enquiry(
                db,
                agency_id,
                user_id,
                EnquiryCreate(client_id=nimbus.id, origin="DEL", destination="BOM"),
                now=now - 8 * DAY,
            )

        async def quote(e, sells, *, send: bool, n: int):  # type: ignore[no-untyped-def]
            q = await create_quote(
                db, agency_id, user_id, QuoteCreate(enquiry_id=e.id, **NO_MARKUP), now=now - 7 * DAY
            )
            if sells:
                views = [view(f"q{n}-{i}", s) for i, s in enumerate(sells)]
                await add_version_from_views(db, q, views, "", user_id, now=now - 7 * DAY)
            if send:
                await send_quote(db, q, user_id, now=now - 6 * DAY)
            ids[f"q{n}"] = q.id
            return q

        won, won_again, quoted, fresh = [await enquiry() for _ in range(4)]
        ids["won"], ids["quoted"] = won.id, quoted.id
        q1 = await quote(won, [950000, 900000], send=True, n=1)
        q2 = await quote(won, [500000, 300000], send=True, n=2)
        q3 = await quote(won_again, [450000, 250000], send=True, n=3)
        q4 = await quote(quoted, [400000, 350000], send=True, n=4)
        await add_version_from_views(db, q4, [view("q4-new", 100000)], "", user_id, now=now - DAY)
        await quote(fresh, [200000, 250000], send=False, n=5)
        await quote(fresh, [], send=False, n=6)

        await decide_quote(db, q2, "accepted", None, now=now - 2 * DAY, accepted_option=0)
        await decide_quote(db, q1, "accepted", user_id, now=now - DAY)
        await decide_quote(db, q3, "accepted", None, now=now - 3 * DAY, accepted_option=0)
        await db.commit()
    return ids


async def seeded(client) -> dict[str, UUID]:  # type: ignore[no-untyped-def]
    me = (await signup(client)).json()
    return await build(UUID(me["agency"]["id"]), UUID(me["user"]["id"]), datetime.now(UTC))


EXPECTED = {
    "Q-0001": (900000, 900000),  # marked accepted by the agent: the cheapest sent option
    "Q-0002": (500000, 300000),  # the accepted option, not the cheapest
    "Q-0003": (450000, 250000),
    "Q-0004": (350000, 100000),  # the sent version, not the newer draft
    "Q-0005": (200000, 200000),
    "Q-0006": (None, None),
}


async def test_quote_reads_carry_one_value(client, airports):
    ids = await seeded(client)
    items = (await client.get("/api/v1/quotes")).json()["items"]
    assert {q["number"]: (q["value_minor"], q["min_sell_minor"]) for q in items} == EXPECTED
    for q in items:
        detail = (await client.get(f"/api/v1/quotes/{q['id']}")).json()
        assert detail["value_minor"] == q["value_minor"]
        assert detail["currency"] == "INR"
        assert detail["decided_at"] == q["decided_at"]
        assert (q["decided_at"] is not None) == (q["status"] == "accepted")
    assert items[0]["client"] == {
        "id": str(ids["client"]),
        "name": "Nimbus Analytics",
        "kind": "company",
    }


async def test_won_value_counts_the_latest_decided_quote_per_enquiry(client, airports):
    ids = await seeded(client)
    # E-0001: Q-0001 (decided last) 900000, not Q-0002 as well; E-0002: Q-0003 450000.
    won = 900000 + 450000
    nimbus = (await client.get(f"/api/v1/clients/{ids['client']}")).json()
    assert nimbus["won_value_minor"] == won
    listed = (await client.get("/api/v1/clients")).json()["items"]
    assert [c["won_value_minor"] for c in listed] == [won]
    team = (await client.get("/api/v1/dashboard/team")).json()["members"]
    assert [m["won_value_minor"] for m in team] == [won]
    stages = (await client.get("/api/v1/dashboard/pipeline")).json()["stages"]
    assert {s["status"]: (s["count"], s["value_minor"]) for s in stages} == {
        "new": (0, 0),
        # E-0004's most recent quote has no version yet.
        "quoting": (1, 0),
        "quoted": (1, 350000),
        "won": (2, won),
        "lost": (0, 0),
    }


async def test_quote_list_counts_every_status(client, airports):
    ids = await seeded(client)
    zero = {"draft": 0, "sent": 0, "viewed": 0, "accepted": 0, "declined": 0, "expired": 0}
    everything = zero | {"draft": 2, "sent": 1, "accepted": 3}
    page = (await client.get("/api/v1/quotes", params={"limit": 1})).json()
    assert (len(page["items"]), page["total"], page["counts"]) == (1, 6, everything)
    drafts = (await client.get("/api/v1/quotes", params={"status": "draft", "limit": 1})).json()
    assert (drafts["total"], drafts["counts"]) == (2, everything)
    one = (await client.get("/api/v1/quotes", params={"enquiry_id": str(ids["won"])})).json()
    assert (one["total"], one["counts"]) == (2, zero | {"accepted": 2})
    mine = (await client.get("/api/v1/quotes", params={"client_id": str(ids["client"])})).json()
    assert mine["counts"] == everything
