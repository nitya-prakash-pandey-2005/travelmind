import hashlib
from datetime import UTC, datetime, timedelta

import pytest

from tests.helpers import exec_as_tenant, make_client, signup

DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


async def setup_quote(client, markup_kind="percent", markup_value=1000):
    await signup(client)
    enquiry = (
        await client.post(
            "/api/v1/enquiries", json={"origin": "DEL", "destination": "BOM", "depart_date": DAY}
        )
    ).json()
    offers = (
        await client.post(
            "/api/v1/flights/search",
            json={"origin": "DEL", "destination": "BOM", "departure_date": DAY},
        )
    ).json()["offers"]
    quote = (
        await client.post(
            "/api/v1/quotes",
            json={
                "enquiry_id": enquiry["id"],
                "markup_kind": markup_kind,
                "markup_value": markup_value,
            },
        )
    ).json()
    return enquiry, offers, quote


async def test_version_prices_come_from_the_offer_cache(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    assert quote["number"] == "Q-0001" and quote["status"] == "draft" and quote["currency"] == "INR"
    r = await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={
            "offer_ids": [offers[0]["id"], offers[1]["id"]],
            "message": "Two good options",
            "sell_price": 1,
        },
    )  # unknown field ignored — prices are never taken from the client
    assert r.status_code == 201
    version = r.json()["versions"][0]
    first = version["options"][0]
    total = offers[0]["total"]["amount_minor"]
    assert first["markup_minor"] == round(total * 0.10)
    assert first["sell"] == {"amount_minor": total + round(total * 0.10), "currency": "INR"}
    assert version["totals"]["options"] == 2
    detail = (await client.get("/api/v1/enquiries/" + enquiry["id"])).json()
    assert detail["status"] == "quoting"


async def test_unknown_offer_is_rejected(client, airports):
    _, _, quote = await setup_quote(client)
    r = await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": ["sandbox~nope"], "message": ""},
    )
    assert (
        r.status_code == 422
        and r.json()["detail"] == "Offer sandbox~nope is no longer available. Run the search again."
    )


async def test_mixed_currency_options_are_rejected(client, airports):
    enquiry, offers, _ = await setup_quote(client)
    quote = (
        await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"], "currency": "USD"})
    ).json()
    r = await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[0]["id"]], "message": ""},
    )
    assert (
        r.status_code == 422
        and r.json()["detail"] == f"Offer {offers[0]['id']} is priced in INR; this quote is in USD."
    )


async def test_send_returns_token_once_and_stores_hash(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    assert (
        await client.post(f"/api/v1/quotes/{quote['id']}/send")
    ).status_code == 409  # no version yet
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[0]["id"]], "message": "Hi"},
    )
    sent = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()
    token = sent["token"]
    assert sent["share_url"] == f"/q/{token}" and len(token) >= 32
    detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
    assert detail["status"] == "sent" and "token" not in detail and "share_token_hash" not in detail
    stored = await exec_as_tenant(
        (await client.get("/api/v1/agency")).json()["id"], "SELECT share_token_hash FROM quotes"
    )
    assert stored == [(hashlib.sha256(token.encode()).hexdigest(),)]
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "quoted"


async def test_resend_rotates_the_token(client, airports):
    _, offers, quote = await setup_quote(client)
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[0]["id"]], "message": ""},
    )
    first = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()["token"]
    second = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()["token"]
    assert first != second


async def test_accept_wins_the_enquiry(client, airports):
    enquiry, offers, quote = await setup_quote(client, markup_kind="fixed", markup_value=150000)
    v = (
        await client.post(
            f"/api/v1/quotes/{quote['id']}/versions",
            json={"offer_ids": [offers[0]["id"]], "message": ""},
        )
    ).json()
    assert v["versions"][0]["options"][0]["markup_minor"] == 150000
    assert (
        await client.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "accepted"})
    ).status_code == 409  # still draft
    await client.post(f"/api/v1/quotes/{quote['id']}/send")
    r = await client.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "accepted"})
    assert r.json()["status"] == "accepted" and r.json()["decided_at"]
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "won"
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 409


async def test_quotes_are_isolated(client, app, airports):
    _, _, quote = await setup_quote(client)
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        assert (await other.get(f"/api/v1/quotes/{quote['id']}")).status_code == 404
        assert (await other.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 404


async def test_client_with_quotes_cannot_be_deleted(client, airports):
    await signup(client)
    c = (await client.post("/api/v1/clients", json={"name": "Priya"})).json()
    e = (
        await client.post(
            "/api/v1/enquiries",
            json={"client_id": c["id"], "origin": "DEL", "destination": "BOM", "depart_date": DAY},
        )
    ).json()
    await client.post("/api/v1/quotes", json={"enquiry_id": e["id"]})
    r = await client.delete(f"/api/v1/clients/{c['id']}")
    assert (
        r.status_code == 409
        and r.json()["detail"] == "This client has quotes, so it can't be deleted."
    )


# --- beyond the brief -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("total", "kind", "value", "expected"),
    [
        (523401, "percent", 1000, 52340),  # 52340.1 → 52340
        (5, "percent", 1000, 1),  # 0.5 rounds up
        (15, "percent", 1000, 2),  # 1.5 rounds up (not to even)
        (25, "percent", 1000, 3),  # 2.5 rounds up (not to even)
        (523401, "percent", 0, 0),
        (523401, "percent", 10000, 523401),
        (523401, "fixed", 150000, 150000),
        (523401, "fixed", 0, 0),
    ],
)
def test_apply_markup(total, kind, value, expected):
    from travelmind.workspace.quotes import apply_markup

    assert apply_markup(total, kind, value) == expected


async def test_version_details_and_option_overrides(client, airports):
    _, offers, quote = await setup_quote(client)
    url = f"/api/v1/quotes/{quote['id']}/versions"
    ids = [offers[0]["id"], offers[1]["id"], offers[2]["id"]]
    await client.post(url, json={"offer_ids": ids[:1], "message": "First"})
    r = await client.post(
        url, json={"offer_ids": ids, "message": "Second", "option_markups": [None, 0, 2500]}
    )
    assert r.status_code == 201
    detail = r.json()
    assert detail["current_version"] == 2
    assert [v["version"] for v in detail["versions"]] == [2, 1]  # newest first
    newest = detail["versions"][0]
    totals = [o["total"]["amount_minor"] for o in offers[:3]]
    markups = [round(totals[0] * 0.10), 0, round(totals[2] * 0.25)]
    assert [o["markup_minor"] for o in newest["options"]] == markups
    sells = [t + m for t, m in zip(totals, markups, strict=True)]
    assert newest["totals"] == {
        "currency": "INR",
        "min_sell_minor": min(sells),
        "max_sell_minor": max(sells),
        "options": 3,
    }
    offer = newest["options"][0]["offer"]
    assert (
        offer["id"] == ids[0]
        and offer["total"] == offers[0]["total"]
        and offer["display_total"] == offers[0]["total"]
    )
    for key in ("co2_kg_per_passenger", "provenance", "supplier", "slices"):
        assert offer[key] == offers[0][key]
    assert newest["message"] == "Second" and newest["created_by"]
    listed = (await client.get("/api/v1/quotes")).json()
    assert listed["total"] == 1 and listed["items"][0]["min_sell_minor"] == min(sells)


async def test_version_validation(client, airports):
    _, offers, quote = await setup_quote(client)
    url = f"/api/v1/quotes/{quote['id']}/versions"
    ids = [o["id"] for o in offers[:4]]
    assert (await client.post(url, json={"offer_ids": [], "message": ""})).status_code == 422
    assert (
        await client.post(url, json={"offer_ids": ids, "message": ""})
    ).status_code == 422  # > 3
    assert (
        await client.post(url, json={"offer_ids": [ids[0], ids[0]], "message": ""})
    ).status_code == 422
    assert (
        await client.post(url, json={"offer_ids": ids[:2], "message": "", "option_markups": [0]})
    ).status_code == 422
    assert (
        await client.post(
            url, json={"offer_ids": ids[:1], "message": "", "option_markups": [10001]}
        )
    ).status_code == 422
    assert (
        await client.post(url, json={"offer_ids": ids[:1], "message": "x" * 4001})
    ).status_code == 422
    assert (await client.get(f"/api/v1/quotes/{quote['id']}")).json()["current_version"] == 0


async def test_quote_create_validation(client, airports):
    enquiry, _, _ = await setup_quote(client)
    post = lambda **kw: client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]} | kw)  # noqa: E731
    assert (await post(markup_value=10001)).status_code == 422
    assert (await post(markup_value=-1)).status_code == 422
    assert (await post(markup_kind="fixed", markup_value=10**9 + 1)).status_code == 422
    assert (await post(markup_kind="fixed", markup_value=10**9)).status_code == 201
    assert (await post(currency="usd")).json()["currency"] == "USD"
    r = await client.post(
        "/api/v1/quotes", json={"enquiry_id": "00000000-0000-0000-0000-000000000000"}
    )
    assert r.status_code == 404


async def test_second_quote_keeps_the_pipeline_moving(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    # A second quote on a `quoting` enquiry is fine.
    second = await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})
    assert second.status_code == 201 and second.json()["number"] == "Q-0002"
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[0]["id"]], "message": ""},
    )
    await client.post(f"/api/v1/quotes/{quote['id']}/send")
    # Re-sending when the enquiry is already `quoted` is fine too, and a new quote leaves it quoted.
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 200
    assert (
        await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})
    ).status_code == 201
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "quoted"


async def test_closed_enquiry_cannot_be_quoted(client, airports):
    enquiry, _, _ = await setup_quote(client)
    await client.post(
        f"/api/v1/enquiries/{enquiry['id']}/status",
        json={"status": "lost", "lost_reason": "Went quiet"},
    )
    r = await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})
    assert (
        r.status_code == 409
        and r.json()["detail"] == "This enquiry is closed. Reopen it before quoting."
    )


async def test_decline_loses_the_enquiry_unless_another_quote_is_open(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    other = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    for q in (quote, other):
        await client.post(
            f"/api/v1/quotes/{q['id']}/versions",
            json={"offer_ids": [offers[0]["id"]], "message": ""},
        )
        await client.post(f"/api/v1/quotes/{q['id']}/send")
    status = lambda q, s: client.post(f"/api/v1/quotes/{q['id']}/status", json={"status": s})  # noqa: E731
    assert (await status(quote, "declined")).json()["status"] == "declined"
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "quoted"
    assert (await status(quote, "accepted")).status_code == 409  # already decided
    assert (
        await client.post(
            f"/api/v1/quotes/{quote['id']}/versions",
            json={"offer_ids": [offers[0]["id"]], "message": ""},
        )
    ).status_code == 409
    assert (await status(other, "declined")).status_code == 200
    got = (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()
    assert (got["status"], got["lost_reason"]) == ("lost", "Quote declined")


async def test_expired_quote_can_be_resent(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[0]["id"]], "message": ""},
    )
    await client.post(f"/api/v1/quotes/{quote['id']}/send")
    r = await client.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "expired"})
    assert r.json()["status"] == "expired"
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "quoted"
    assert (
        await client.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "sent"})
    ).status_code == 422
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 200
    assert (await client.get(f"/api/v1/quotes/{quote['id']}")).json()["status"] == "sent"


async def test_new_version_waits_for_a_resend(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    url = f"/api/v1/quotes/{quote['id']}"
    agency = (await client.get("/api/v1/agency")).json()["id"]
    await client.post(f"{url}/versions", json={"offer_ids": [offers[0]["id"]], "message": "v1"})
    first = (await client.post(f"{url}/send")).json()["token"]
    got = (await client.get(url)).json()
    assert (got["current_version"], got["sent_version"], got["status"]) == (1, 1, "sent")
    r = await client.post(f"{url}/versions", json={"offer_ids": [offers[1]["id"]], "message": "v2"})
    got = r.json()
    assert (got["current_version"], got["sent_version"], got["status"]) == (2, 1, "sent")
    # The share link still works and still shows version 1 until the agent re-sends.
    first_hash = hashlib.sha256(first.encode()).hexdigest()
    assert await exec_as_tenant(agency, "SELECT share_token_hash FROM quotes") == [(first_hash,)]
    listed = (await client.get("/api/v1/quotes")).json()["items"][0]
    assert (listed["current_version"], listed["sent_version"]) == (2, 1)
    await client.post(f"{url}/send")
    got = (await client.get(url)).json()
    assert (got["current_version"], got["sent_version"], got["status"]) == (2, 2, "sent")
    fresh = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    assert fresh["sent_version"] is None


async def test_closed_enquiry_takes_no_versions_or_sends(client, airports):
    enquiry, offers, a = await setup_quote(client)
    b = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    offer = {"offer_ids": [offers[0]["id"]], "message": ""}
    for q in (a, b):
        await client.post(f"/api/v1/quotes/{q['id']}/versions", json=offer)
        await client.post(f"/api/v1/quotes/{q['id']}/send")
    decide = lambda q, s: client.post(f"/api/v1/quotes/{q['id']}/status", json={"status": s})  # noqa: E731
    enquiry_url = f"/api/v1/enquiries/{enquiry['id']}"
    assert (await decide(a, "expired")).status_code == 200
    # An expired quote is still in play (it can be re-sent), so declining B keeps the enquiry.
    assert (await decide(b, "declined")).status_code == 200
    assert (await client.get(enquiry_url)).json()["status"] == "quoted"
    await client.post(f"{enquiry_url}/status", json={"status": "lost", "lost_reason": "Went quiet"})
    closed = "This enquiry is closed. Reopen it before quoting."
    for r in (
        await client.post(f"/api/v1/quotes/{a['id']}/send"),
        await client.post(f"/api/v1/quotes/{a['id']}/versions", json=offer),
    ):
        assert r.status_code == 409 and r.json()["detail"] == closed
    got = (await client.get(f"/api/v1/quotes/{a['id']}")).json()
    assert (got["status"], got["current_version"]) == ("expired", 1)
    await client.post(f"{enquiry_url}/status", json={"status": "new"})
    assert (await client.post(f"/api/v1/quotes/{a['id']}/send")).status_code == 200
    assert (await client.get(enquiry_url)).json()["status"] == "quoted"


async def test_won_enquiry_takes_no_more_versions(client, airports):
    enquiry, offers, a = await setup_quote(client)
    b = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"]})).json()
    offer = {"offer_ids": [offers[0]["id"]], "message": ""}
    await client.post(f"/api/v1/quotes/{a['id']}/versions", json=offer)
    await client.post(f"/api/v1/quotes/{a['id']}/send")
    await client.post(f"/api/v1/quotes/{a['id']}/status", json={"status": "accepted"})
    r = await client.post(f"/api/v1/quotes/{b['id']}/versions", json=offer)
    assert r.status_code == 409
    assert r.json()["detail"] == "This enquiry is closed. Reopen it before quoting."


async def test_other_agencies_cannot_reach_quotes_or_offers(client, app, airports):
    _, offers, quote = await setup_quote(client)
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        body = {"offer_ids": [offers[0]["id"]], "message": ""}
        assert (
            await other.post(f"/api/v1/quotes/{quote['id']}/versions", json=body)
        ).status_code == 404
        assert (
            await other.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "accepted"})
        ).status_code == 404
        # Beta never searched, so Alpha's offer isn't in Beta's offer cache.
        e = (
            await other.post("/api/v1/enquiries", json={"origin": "DEL", "destination": "BOM"})
        ).json()
        mine = (await other.post("/api/v1/quotes", json={"enquiry_id": e["id"]})).json()
        r = await other.post(f"/api/v1/quotes/{mine['id']}/versions", json=body)
        assert r.status_code == 422
        assert r.json()["detail"] == (
            f"Offer {offers[0]['id']} is no longer available. Run the search again."
        )
    detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
    assert (detail["status"], detail["current_version"]) == ("draft", 0)


async def test_list_filters(client, airports):
    await signup(client)
    c = (await client.post("/api/v1/clients", json={"name": "Priya"})).json()
    e1 = (
        await client.post(
            "/api/v1/enquiries",
            json={"client_id": c["id"], "origin": "DEL", "destination": "BOM", "depart_date": DAY},
        )
    ).json()
    e2 = (
        await client.post("/api/v1/enquiries", json={"origin": "BOM", "destination": "DEL"})
    ).json()
    q1 = (await client.post("/api/v1/quotes", json={"enquiry_id": e1["id"]})).json()
    q2 = (await client.post("/api/v1/quotes", json={"enquiry_id": e2["id"]})).json()
    listed = (await client.get("/api/v1/quotes")).json()
    assert listed["total"] == 2 and [q["number"] for q in listed["items"]] == ["Q-0002", "Q-0001"]
    first = listed["items"][1]
    assert first["client"] == {"id": c["id"], "name": "Priya"}
    assert first["enquiry"] == {
        "id": e1["id"],
        "number": "E-0001",
        "origin": "DEL",
        "destination": "BOM",
        "depart_date": DAY,
    }
    assert (first["current_version"], first["min_sell_minor"], first["sent_at"]) == (0, None, None)
    assert listed["items"][0]["client"] is None
    by_client = (await client.get("/api/v1/quotes", params={"client_id": c["id"]})).json()
    assert [q["id"] for q in by_client["items"]] == [q1["id"]]
    by_enquiry = (await client.get("/api/v1/quotes", params={"enquiry_id": e2["id"]})).json()
    assert [q["id"] for q in by_enquiry["items"]] == [q2["id"]]
    assert (await client.get("/api/v1/quotes", params={"status": "sent"})).json()["total"] == 0
    page = (await client.get("/api/v1/quotes", params={"limit": 1, "offset": 1})).json()
    assert page["total"] == 2 and [q["id"] for q in page["items"]] == [q1["id"]]


async def test_service_helpers_back_date_and_log(client, airports):
    from travelmind.db import bind_tenant, get_sessionmaker
    from travelmind.offers.models import FlightOffer
    from travelmind.offers.service import offer_view
    from travelmind.workspace.quotes import (
        QuoteCreate,
        add_version_from_views,
        create_quote,
        decide_quote,
        send_quote,
    )

    enquiry, offers, _ = await setup_quote(client)
    agency = (await client.get("/api/v1/agency")).json()["id"]
    user = (await client.get("/api/v1/auth/me")).json()["user"]["id"]
    at = datetime(2026, 9, 1, 10, 0, tzinfo=UTC)
    views = [offer_view(FlightOffer.model_validate(o), None, None) for o in offers[:2]]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        quote = await create_quote(
            db,
            agency,
            user,
            QuoteCreate(enquiry_id=enquiry["id"], markup_kind="fixed", markup_value=100),
            now=at,
        )
        await add_version_from_views(
            db, quote, views, "Hello", user, option_markups=[None, 5], now=at + timedelta(hours=1)
        )
        token = await send_quote(db, quote, user, now=at + timedelta(hours=2))
        await decide_quote(db, quote, "accepted", user, now=at + timedelta(days=1))
        await db.commit()
        quote_id = quote.id
    got = (await client.get(f"/api/v1/quotes/{quote_id}")).json()
    assert (got["created_at"], got["sent_at"], got["share_expires_at"], got["decided_at"]) == (
        "2026-09-01T10:00:00Z",
        "2026-09-01T12:00:00Z",
        "2026-09-15T12:00:00Z",
        "2026-09-02T10:00:00Z",
    )
    assert [o["markup_minor"] for o in got["versions"][0]["options"]] == [100, 5]
    assert got["versions"][0]["created_at"] == "2026-09-01T11:00:00Z"
    assert await exec_as_tenant(
        agency, "SELECT share_token_hash FROM quotes WHERE id = :id", {"id": quote_id}
    ) == [(hashlib.sha256(token.encode()).hexdigest(),)]
    rows = await exec_as_tenant(
        agency,
        "SELECT kind, summary FROM activity_events WHERE entity_id = :id ORDER BY occurred_at",
        {"id": quote_id},
    )
    assert rows == [
        ("quote.created", "New quote Q-0002 for E-0001"),
        ("quote.version_added", "Q-0002 version 1 (2 options)"),
        ("quote.sent", "Q-0002 sent"),
        ("quote.accepted", "Q-0002 accepted"),
    ]


async def test_quotes_follow_their_enquirys_client(client, app, airports):
    """Changing an enquiry's client moves its quotes with it: the client's quote count, quote
    list, won value and the public greeting all follow, and the old client can be deleted."""
    enquiry, offers, quote = await setup_quote(client, markup_kind="fixed", markup_value=0)
    qid, eid = quote["id"], enquiry["id"]
    await client.post(
        f"/api/v1/quotes/{qid}/versions",
        json={"offer_ids": [offers[0]["id"], offers[1]["id"]], "message": ""},
    )
    token = (await client.post(f"/api/v1/quotes/{qid}/send")).json()["token"]
    accepted = await client.post(f"/api/v1/quotes/{qid}/status", json={"status": "accepted"})
    assert accepted.json()["client"] is None
    cheapest = min(offers[0]["total"]["amount_minor"], offers[1]["total"]["amount_minor"])

    priya = (await client.post("/api/v1/clients", json={"name": "Priya Sharma"})).json()
    ravi = (await client.post("/api/v1/clients", json={"name": "Ravi Kumar"})).json()
    r = await client.patch(f"/api/v1/enquiries/{eid}", json={"client_id": priya["id"]})
    assert r.status_code == 200, r.text

    got = (await client.get(f"/api/v1/clients/{priya['id']}")).json()
    assert (got["quote_count"], got["won_value_minor"]) == (1, cheapest)
    listed = (await client.get("/api/v1/quotes", params={"client_id": priya["id"]})).json()
    assert [q["id"] for q in listed["items"]] == [qid]
    assert (await client.get(f"/api/v1/quotes/{qid}")).json()["client"]["name"] == "Priya Sharma"
    async with make_client(app) as anon:
        assert (await anon.get(f"/api/v1/public/quotes/{token}")).json()[
            "client_first_name"
        ] == "Priya"

    # Moving the enquiry to another client moves its quotes; the old client can now go.
    await client.patch(f"/api/v1/enquiries/{eid}", json={"client_id": ravi["id"]})
    old = (await client.get(f"/api/v1/clients/{priya['id']}")).json()
    new = (await client.get(f"/api/v1/clients/{ravi['id']}")).json()
    assert (old["quote_count"], old["won_value_minor"]) == (0, 0)
    assert (new["quote_count"], new["won_value_minor"]) == (1, cheapest)
    assert (await client.get(f"/api/v1/quotes/{qid}")).json()["client"]["name"] == "Ravi Kumar"
    assert (await client.delete(f"/api/v1/clients/{priya['id']}")).status_code == 204

    # Clearing the client clears it on the quotes too.
    await client.patch(f"/api/v1/enquiries/{eid}", json={"client_id": None})
    assert (await client.get(f"/api/v1/quotes/{qid}")).json()["client"] is None
    assert (await client.get(f"/api/v1/clients/{ravi['id']}")).json()["quote_count"] == 0


async def test_a_client_keeps_quotes_of_its_other_enquiries(client, airports):
    """Only the moved enquiry's quotes change hands; a client with other quotes still can't be
    deleted."""
    await signup(client)
    priya = (await client.post("/api/v1/clients", json={"name": "Priya Sharma"})).json()
    ravi = (await client.post("/api/v1/clients", json={"name": "Ravi Kumar"})).json()
    trip = {"origin": "DEL", "destination": "BOM", "depart_date": DAY, "client_id": priya["id"]}
    first = (await client.post("/api/v1/enquiries", json=trip)).json()
    second = (await client.post("/api/v1/enquiries", json=trip)).json()
    for e in (first, second):
        await client.post("/api/v1/quotes", json={"enquiry_id": e["id"]})
    await client.patch(f"/api/v1/enquiries/{first['id']}", json={"client_id": ravi["id"]})
    counts = [
        (await client.get(f"/api/v1/clients/{c['id']}")).json()["quote_count"]
        for c in (priya, ravi)
    ]
    assert counts == [1, 1]
    assert (await client.delete(f"/api/v1/clients/{priya['id']}")).status_code == 409
