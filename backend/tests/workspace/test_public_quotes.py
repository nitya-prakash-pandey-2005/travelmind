import asyncio
import hashlib
import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from tests.helpers import exec_as_tenant, make_client, signup
from travelmind.config import get_settings

URL = "/api/v1/public/quotes"
DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()
INVALID = "This quote link isn't valid. Ask your travel agent for a new one."
EXPIRED = "This quote has expired. Ask your travel agent for a fresh one."
LIMITED = "Too many requests. Please try again in a minute."
CHOOSE = "Choose which option you're accepting."
NO_SUCH_OPTION = "That option isn't in this quote."
INDICATIVE = "Indicative price — confirm with your travel agent"
LIVE = "Live fare at the time of quoting"
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

QUOTE_KEYS = {
    "number",
    "status",
    "agency",
    "client_first_name",
    "message",
    "options",
    "currency",
    "expires_at",
    "decided_at",
    "accepted_option",
}
OPTION_KEYS = {
    "index",
    "carrier_code",
    "carrier_name",
    "cabin",
    "slices",
    "baggage",
    "refundable",
    "changeable",
    "co2_kg_per_passenger",
    "price_label",
    "sell",
    "per_traveller",
}
SLICE_KEYS = {
    "origin",
    "destination",
    "departing_at",
    "arriving_at",
    "duration_minutes",
    "stops",
    "segments",
}
SEGMENT_KEYS = {
    "marketing_carrier",
    "flight_number",
    "origin",
    "destination",
    "departing_at",
    "arriving_at",
}


def public(app, ip: str = "203.0.113.7") -> httpx.AsyncClient:
    """A browser with no session, from its own network address."""
    transport = httpx.ASGITransport(app=app, client=(ip, 50000))
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def agency_of(client) -> str:
    return (await client.get("/api/v1/agency")).json()["id"]


async def as_app(
    agency_id: str | None, sql: str, params: dict[str, Any] | None = None
) -> list[tuple[Any, ...]]:
    """Run SQL as the application role, optionally inside one tenant's RLS context."""
    engine = create_async_engine(os.environ["TM_DATABASE_URL"], poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            if agency_id is not None:
                await conn.execute(
                    text("SELECT set_config('app.agency_id', :aid, true)"), {"aid": agency_id}
                )
            result = await conn.execute(text(sql), params or {})
            return [tuple(row) for row in result] if result.returns_rows else []
    finally:
        await engine.dispose()


async def as_owner(sql: str, params: dict[str, Any] | None = None) -> list[tuple[Any, ...]]:
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(sql), params or {})
            return [tuple(row) for row in result] if result.returns_rows else []
    finally:
        await engine.dispose()


async def setup(client, **enquiry_fields) -> tuple[dict, list[dict]]:
    """Sign up Alpha Travels, open a DEL→BOM enquiry and search it (sandbox offers)."""
    await signup(client)
    body = {"origin": "DEL", "destination": "BOM", "depart_date": DAY} | enquiry_fields
    enquiry = (await client.post("/api/v1/enquiries", json=body)).json()
    offers = (
        await client.post(
            "/api/v1/flights/search",
            json={"origin": "DEL", "destination": "BOM", "departure_date": DAY},
        )
    ).json()["offers"]
    return enquiry, offers


async def sent_quote(
    client, enquiry: dict, offers: list[dict], *, count: int = 2, message: str = ""
) -> tuple[dict, str]:
    """A quote with one version of `count` offers (10% markup), sent; returns it and its token."""
    quote = (
        await client.post(
            "/api/v1/quotes",
            json={"enquiry_id": enquiry["id"], "markup_kind": "percent", "markup_value": 1000},
        )
    ).json()
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [o["id"] for o in offers[:count]], "message": message},
    )
    sent = await client.post(f"/api/v1/quotes/{quote['id']}/send")
    assert sent.status_code == 200
    return quote, sent.json()["token"]


async def events(agency: str, kind: str) -> list[tuple[Any, ...]]:
    return await exec_as_tenant(
        agency,
        "SELECT actor_user_id, summary, entity_id::text, data->>'option_index' "
        "FROM activity_events WHERE kind = :kind ORDER BY summary",
        {"kind": kind},
    )


async def overdue(agency: str, quote_id: str | None = None) -> None:
    """Move share links' expiry into the past (every quote's, or one quote's)."""
    condition = "" if quote_id is None else " WHERE id = :id"
    await exec_as_tenant(
        agency,
        "UPDATE quotes SET share_expires_at = now() - interval '1 minute'" + condition,
        {"id": quote_id} if quote_id else {},
    )


def keys_in(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in keys_in(v)}
    if isinstance(value, list):
        return {k for v in value for k in keys_in(v)}
    return set()


def ints_in(value: Any) -> set[int]:
    if isinstance(value, dict):
        return {i for v in value.values() for i in ints_in(v)}
    if isinstance(value, list):
        return {i for v in value for i in ints_in(v)}
    return {value} if isinstance(value, int) and not isinstance(value, bool) else set()


async def test_public_quote_resolves_only_exact_tokens(client, app, airports):
    enquiry, offers = await setup(client)
    quote, token = await sent_quote(client, enquiry, offers)
    async with public(app) as anon:
        ok = await anon.get(f"{URL}/{token}")
        assert ok.status_code == 200 and ok.json()["number"] == "Q-0001"
        variants = [
            token[:-1],
            token[:16],
            token + "A",
            token.upper(),
            token.lower(),
            token.swapcase(),
            sha(token),  # the stored hash is not a token
            "x",
            "a" * 43,
            "a" * 300,
        ]
        for variant in dict.fromkeys(v for v in variants if v != token):
            got = await anon.get(f"{URL}/{variant}")
            assert (got.status_code, got.json()) == (404, {"detail": INVALID}), variant
            decided = await anon.post(f"{URL}/{variant}/decision", json={"decision": "decline"})
            assert (decided.status_code, decided.json()) == (404, {"detail": INVALID}), variant
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        beta = await agency_of(other)
        # Beta's session reaches nothing of Alpha's, and Beta can't register a link of its own
        # choosing for Alpha's quote.
        assert (await other.get(f"/api/v1/quotes/{quote['id']}")).status_code == 404
        with pytest.raises(DBAPIError, match="quote not found"):
            await as_app(
                beta,
                "SELECT set_quote_share_token(:quote, :hash)",
                {"quote": quote["id"], "hash": sha("beta-chosen-token")},
            )
        with pytest.raises(DBAPIError, match="quote not found"):
            await as_app(
                None,
                "SELECT set_quote_share_token(:quote, :hash)",
                {"quote": quote["id"], "hash": sha("no-tenant-token")},
            )
        # A signed-in Beta browser on the public page is just another anonymous visitor.
        got = await other.get(f"{URL}/beta-chosen-token")
        assert (got.status_code, got.json()) == (404, {"detail": INVALID})
    async with public(app) as anon:
        assert (await anon.get(f"{URL}/{token}")).status_code == 200
    detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
    assert detail["status"] == "viewed"


async def test_rotated_token_is_dead(client, app, airports):
    enquiry, offers = await setup(client)
    quote, first = await sent_quote(client, enquiry, offers)
    async with public(app) as anon:
        assert (await anon.get(f"{URL}/{first}")).status_code == 200
        second = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()["token"]
        old = await anon.get(f"{URL}/{first}")
        assert (old.status_code, old.json()) == (404, {"detail": INVALID})
        old_decision = await anon.post(
            f"{URL}/{first}/decision", json={"decision": "accept", "option_index": 0}
        )
        assert (old_decision.status_code, old_decision.json()) == (404, {"detail": INVALID})
        assert (await anon.get(f"{URL}/{second}")).status_code == 200
    rows = await as_owner("SELECT token_hash, quote_id::text FROM quote_share_tokens")
    assert rows == [(sha(second), quote["id"])]
    detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
    assert detail["status"] == "viewed"


async def test_public_payload_has_no_internal_fields(client, app, airports):
    await signup(client)
    person = (
        await client.post(
            "/api/v1/clients",
            json={
                "name": "Priya Sharma",
                "email": "priya.sharma@example.com",
                "phone": "+91 98100 12345",
                "notes": "Prefers aisle seats",
            },
        )
    ).json()
    enquiry = (
        await client.post(
            "/api/v1/enquiries",
            json={
                "client_id": person["id"],
                "origin": "DEL",
                "destination": "BOM",
                "depart_date": DAY,
                "notes": "Internal: margin is thin",
            },
        )
    ).json()
    offers = (
        await client.post(
            "/api/v1/flights/search",
            json={"origin": "DEL", "destination": "BOM", "departure_date": DAY},
        )
    ).json()["offers"]
    quote, token = await sent_quote(
        client, enquiry, offers, message="Hi Priya, two good options for you"
    )
    # A newer version the agent hasn't sent yet stays private.
    await client.post(
        f"/api/v1/quotes/{quote['id']}/versions",
        json={"offer_ids": [offers[2]["id"]], "message": "Draft for later"},
    )
    agency = await agency_of(client)
    me = (await client.get("/api/v1/auth/me")).json()["user"]
    async with public(app) as anon:
        r = await anon.get(f"{URL}/{token}")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == QUOTE_KEYS
    assert body["number"] == "Q-0001" and body["status"] == "viewed"
    assert body["agency"] == {"name": "Alpha Travels", "brand_color": "#22d3ee"}
    assert body["client_first_name"] == "Priya"
    assert body["message"] == "Hi Priya, two good options for you"
    assert body["currency"] == "INR" and body["expires_at"] and body["decided_at"] is None
    assert [o["index"] for o in body["options"]] == [0, 1]
    for option, offer in zip(body["options"], offers[:2], strict=True):
        assert set(option) == OPTION_KEYS
        assert all(set(s) == SLICE_KEYS for s in option["slices"])
        assert all(set(g) == SEGMENT_KEYS for s in option["slices"] for g in s["segments"])
        total = offer["total"]["amount_minor"]
        markup = round(total * 0.10)
        assert option["sell"] == {"amount_minor": total + markup, "currency": "INR"}
        assert option["price_label"] == INDICATIVE
        assert option["carrier_code"] == offer["owner_carrier"]
        # Neither the supplier's price nor the markup can be read or worked out.
        assert total not in ints_in(body) and markup not in ints_in(body)
    forbidden = {
        "id",
        "supplier",
        "supplier_ref",
        "provenance",
        "total",
        "base",
        "tax",
        "display_total",
        "insight",
        "markup_minor",
        "markup_kind",
        "markup_value",
        "totals",
        "versions",
        "created_by",
        "agency_id",
        "quote_id",
        "enquiry_id",
        "client_id",
        "email",
        "phone",
        "notes",
        "fetched_at",
        "share_token_hash",
        "token",
    }
    assert keys_in(body).isdisjoint(forbidden)
    raw = r.text
    for secret in [
        agency,
        quote["id"],
        enquiry["id"],
        person["id"],
        me["id"],
        "@",
        "Sharma",
        "98100",
        "aisle",
        "margin",
        "Asha",
        "Draft for later",
        "sandbox",
        sha(token),
        *(o["id"] for o in offers[:3]),
        *(o["supplier_ref"] for o in offers[:3]),
    ]:
        assert secret not in raw, secret


async def test_first_view_marks_viewed_once(client, app, airports):
    enquiry, offers = await setup(client)
    quote, token = await sent_quote(client, enquiry, offers)
    agency = await agency_of(client)
    assert (await client.get(f"/api/v1/quotes/{quote['id']}")).json()["first_viewed_at"] is None
    async with public(app) as anon:
        first = (await anon.get(f"{URL}/{token}")).json()
        second = (await anon.get(f"{URL}/{token}")).json()
    assert first["status"] == second["status"] == "viewed"
    detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
    assert detail["status"] == "viewed" and detail["first_viewed_at"]
    assert await events(agency, "quote.viewed") == [
        (None, "Client opened Q-0001", quote["id"], None)
    ]


async def test_overdue_quotes_expire_lazily(client, app, airports):
    enquiry, offers = await setup(client)
    a, token_a = await sent_quote(client, enquiry, offers)
    b, _ = await sent_quote(client, enquiry, offers)
    agency = await agency_of(client)
    async with public(app) as anon:
        assert (await anon.get(f"{URL}/{token_a}")).json()["status"] == "viewed"
        await overdue(agency)
        got = await anon.get(f"{URL}/{token_a}")
        assert got.status_code == 200 and got.json()["status"] == "expired"
        assert datetime.fromisoformat(got.json()["expires_at"]) < datetime.now(UTC)
    listed = (await client.get("/api/v1/quotes")).json()["items"]
    assert {q["number"]: q["status"] for q in listed} == {"Q-0001": "expired", "Q-0002": "expired"}
    assert (await client.get(f"/api/v1/quotes/{a['id']}")).json()["status"] == "expired"
    assert (await client.get(f"/api/v1/quotes/{b['id']}")).json()["status"] == "expired"
    expected = [(None, "Q-0001 expired", a["id"], None), (None, "Q-0002 expired", b["id"], None)]
    assert await events(agency, "quote.expired") == expected
    # Expiry leaves the enquiry where it was (the agent can re-send).
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "quoted"
    # The Command Center expires overdue quotes before it counts them.
    for panel in ("pipeline", "summary"):
        c, _ = await sent_quote(client, enquiry, offers)
        await overdue(agency, c["id"])
        assert (await client.get(f"/api/v1/dashboard/{panel}")).status_code == 200
        rows = await exec_as_tenant(
            agency, "SELECT status FROM quotes WHERE id = :id", {"id": c["id"]}
        )
        assert rows == [("expired",)], panel
    # Each quote expires once, however often it is read.
    async with public(app) as anon:
        await anon.get(f"{URL}/{token_a}")
    await client.get("/api/v1/quotes")
    assert len(await events(agency, "quote.expired")) == 4


async def test_global_search_and_notifications_expire_overdue_quotes(client, app, airports):
    enquiry, offers = await setup(client)
    a, _ = await sent_quote(client, enquiry, offers)
    agency = await agency_of(client)
    await overdue(agency, a["id"])
    hits = (await client.get("/api/v1/search", params={"q": "Q-0001"})).json()["quotes"]
    assert [(h["number"], h["status"]) for h in hits] == [("Q-0001", "expired")]
    # The expiry is kept, and logged once.
    assert await exec_as_tenant(agency, "SELECT status FROM quotes") == [("expired",)]
    assert len(await events(agency, "quote.expired")) == 1
    b, _ = await sent_quote(client, enquiry, offers)
    await overdue(agency, b["id"])
    assert (await client.get("/api/v1/notifications")).status_code == 200
    rows = await exec_as_tenant(agency, "SELECT status FROM quotes WHERE id = :id", {"id": b["id"]})
    assert rows == [("expired",)]


async def test_expired_quote_cannot_be_accepted(client, app, airports):
    enquiry, offers = await setup(client)
    quote, token = await sent_quote(client, enquiry, offers)
    agency = await agency_of(client)
    await overdue(agency)
    async with public(app) as anon:
        accept = await anon.post(
            f"{URL}/{token}/decision", json={"decision": "accept", "option_index": 0}
        )
        assert (accept.status_code, accept.json()) == (410, {"detail": EXPIRED})
        decline = await anon.post(f"{URL}/{token}/decision", json={"decision": "decline"})
        assert (decline.status_code, decline.json()) == (410, {"detail": EXPIRED})
    # The refusal still recorded the expiry.
    rows = await exec_as_tenant(agency, "SELECT status, decided_at FROM quotes")
    assert rows == [("expired", None)]
    assert len(await events(agency, "quote.expired")) == 1
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "quoted"
    # An overdue quote can't be marked accepted from the workspace either.
    other, _ = await sent_quote(client, enquiry, offers)
    await overdue(agency, other["id"])
    r = await client.post(f"/api/v1/quotes/{other['id']}/status", json={"status": "accepted"})
    assert r.status_code == 409
    # A quote the agent marked expired reads the same on the public page.
    manual, manual_token = await sent_quote(client, enquiry, offers)
    await client.post(f"/api/v1/quotes/{manual['id']}/status", json={"status": "expired"})
    async with public(app) as anon:
        r = await anon.post(
            f"{URL}/{manual_token}/decision", json={"decision": "accept", "option_index": 0}
        )
        assert (r.status_code, r.json()) == (410, {"detail": EXPIRED})
        assert (await anon.get(f"{URL}/{manual_token}")).json()["status"] == "expired"


async def test_decision_is_final(client, app, airports):
    enquiry, offers = await setup(client)
    a, token_a = await sent_quote(client, enquiry, offers)
    b, _ = await sent_quote(client, enquiry, offers)
    agency = await agency_of(client)
    async with public(app) as anon:
        r = await anon.post(
            f"{URL}/{token_a}/decision", json={"decision": "accept", "option_index": 1}
        )
        assert r.status_code == 200
        body = r.json()
        assert set(body) == QUOTE_KEYS
        assert (body["status"], body["accepted_option"]) == ("accepted", 1) and body["decided_at"]
        assert (await anon.get(f"{URL}/{token_a}")).json()["status"] == "accepted"
        for again in (
            {"decision": "accept", "option_index": 0},
            {"decision": "decline"},
        ):
            r = await anon.post(f"{URL}/{token_a}/decision", json=again)
            assert (r.status_code, r.json()) == (
                409,
                {"detail": "This quote has already been accepted."},
            )
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "won"
    detail = (await client.get(f"/api/v1/quotes/{a['id']}")).json()
    assert (detail["status"], detail["accepted_option"]) == ("accepted", 1)
    # The sibling quote is left alone.
    assert (await client.get(f"/api/v1/quotes/{b['id']}")).json()["status"] == "sent"
    assert await events(agency, "quote.accepted") == [(None, "Q-0001 accepted", a["id"], "1")]

    # Declines lose the enquiry only once no other quote on it is still open.
    second = (
        await client.post(
            "/api/v1/enquiries", json={"origin": "DEL", "destination": "BOM", "depart_date": DAY}
        )
    ).json()
    c, token_c = await sent_quote(client, second, offers)
    d, token_d = await sent_quote(client, second, offers)
    async with public(app) as anon:
        r = await anon.post(f"{URL}/{token_c}/decision", json={"decision": "decline"})
        assert (r.status_code, r.json()["status"], r.json()["accepted_option"]) == (
            200,
            "declined",
            None,
        )
        assert (await client.get(f"/api/v1/enquiries/{second['id']}")).json()["status"] == "quoted"
        r = await anon.post(f"{URL}/{token_d}/decision", json={"decision": "decline"})
        assert r.status_code == 200
        r = await anon.post(f"{URL}/{token_d}/decision", json={"decision": "decline"})
        assert (r.status_code, r.json()) == (
            409,
            {"detail": "This quote has already been declined."},
        )
    got = (await client.get(f"/api/v1/enquiries/{second['id']}")).json()
    assert (got["status"], got["lost_reason"]) == ("lost", "Quote declined")
    assert await events(agency, "quote.declined") == [
        (None, "Q-0003 declined", c["id"], None),
        (None, "Q-0004 declined", d["id"], None),
    ]


async def test_accept_requires_a_valid_option(client, app, airports):
    enquiry, offers = await setup(client)
    quote, token = await sent_quote(client, enquiry, offers, count=2)
    decision = f"{URL}/{token}/decision"
    async with public(app) as anon:
        r = await anon.post(decision, json={"decision": "accept"})
        assert (r.status_code, r.json()) == (422, {"detail": CHOOSE})
        r = await anon.post(decision, json={"decision": "accept", "option_index": None})
        assert (r.status_code, r.json()) == (422, {"detail": CHOOSE})
        for index in (2, 3, -1):
            r = await anon.post(decision, json={"decision": "accept", "option_index": index})
            assert (r.status_code, r.json()) == (422, {"detail": NO_SUCH_OPTION}), index
        r = await anon.post(decision, json={"decision": "decline", "option_index": 5})
        assert (r.status_code, r.json()) == (422, {"detail": NO_SUCH_OPTION})
        for body in (
            {"decision": "accept", "option_index": "1"},
            {"decision": "accept", "option_index": True},
            {"decision": "accept", "option_index": 1.5},
            {"decision": "maybe", "option_index": 0},
            {},
        ):
            assert (await anon.post(decision, json=body)).status_code == 422, body
        detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
        assert (detail["status"], detail["decided_at"]) == ("sent", None)
        r = await anon.post(decision, json={"decision": "accept", "option_index": 0})
        assert (r.status_code, r.json()["accepted_option"]) == (200, 0)


async def test_public_rate_limits(client, app, airports, monkeypatch):
    enquiry, offers = await setup(client)
    _, token = await sent_quote(client, enquiry, offers)
    monkeypatch.setattr(get_settings(), "public_quote_max_per_minute", 2)
    link = f"{URL}/{token}"
    async with public(app, "198.51.100.1") as first, public(app, "198.51.100.2") as second:
        assert (await first.get(link)).status_code == 200
        assert (await first.get(link)).status_code == 200
        r = await first.get(link)
        assert (r.status_code, r.json()) == (429, {"detail": LIMITED})
        # The link's own budget is spent, whichever network asks for it...
        r = await second.get(link)
        assert (r.status_code, r.json()) == (429, {"detail": LIMITED})
        # ...while another link from that network is still answered.
        assert (await second.get(f"{URL}/some-other-link")).status_code == 404
        # The first network's budget covers decisions and guesses too.
        r = await first.post(f"{link}/decision", json={"decision": "decline"})
        assert (r.status_code, r.json()) == (429, {"detail": LIMITED})
        assert (await first.get(f"{URL}/guess")).status_code == 429
    # The limiter keys hold neither the token nor its full hash.
    from redis.asyncio import Redis

    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        keys = [k.decode() for k in await redis.keys("rl:pq*")]
    finally:
        await redis.aclose()
    assert keys and all(token not in k and sha(token) not in k for k in keys)
    assert f"rl:pqt:{sha(token)[:16]}" in keys and "rl:pq:198.51.100.1" in keys


async def test_app_role_cannot_read_token_table(client, airports):
    enquiry, offers = await setup(client)
    quote, token = await sent_quote(client, enquiry, offers)
    agency = await agency_of(client)
    for sql in (
        "SELECT * FROM quote_share_tokens",
        "SELECT count(*) FROM quote_share_tokens",
        "INSERT INTO quote_share_tokens VALUES ('x', :quote, :agency)",
        "UPDATE quote_share_tokens SET token_hash = 'x'",
        "DELETE FROM quote_share_tokens",
    ):
        with pytest.raises(DBAPIError, match="permission denied"):
            await as_app(agency, sql, {"quote": quote["id"], "agency": agency})
    # The only way in is an exact hash, through the definer function.
    assert await as_app(None, "SELECT public_quote_agency(:h)", {"h": sha(token)}) == [
        (UUID(agency),)
    ]
    assert await as_app(None, "SELECT public_quote_agency(:h)", {"h": sha(token)[:-1]}) == [(None,)]


async def test_share_token_function_only_registers_the_quotes_own_hash(client, app, airports):
    enquiry, offers = await setup(client)
    quote, token = await sent_quote(client, enquiry, offers)
    agency = await agency_of(client)
    # Even inside its own tenant, a caller can't register a token of its choosing.
    with pytest.raises(DBAPIError, match="share token does not match the quote"):
        await as_app(
            agency,
            "SELECT set_quote_share_token(:quote, :hash)",
            {"quote": quote["id"], "hash": sha("chosen-token")},
        )
    rows = await as_owner("SELECT token_hash, quote_id::text FROM quote_share_tokens")
    assert rows == [(sha(token), quote["id"])]
    # A quote that was never sent has no hash to register.
    draft = (
        await client.post(
            "/api/v1/quotes",
            json={"enquiry_id": enquiry["id"], "markup_kind": "percent", "markup_value": 0},
        )
    ).json()
    with pytest.raises(DBAPIError, match="share token does not match the quote"):
        await as_app(
            agency,
            "SELECT set_quote_share_token(:quote, :hash)",
            {"quote": draft["id"], "hash": sha("chosen-token")},
        )
    # The quote's own hash is accepted (re-registering it changes nothing).
    await as_app(
        agency,
        "SELECT set_quote_share_token(:quote, :hash)",
        {"quote": quote["id"], "hash": sha(token)},
    )
    rows = await as_owner("SELECT token_hash, quote_id::text FROM quote_share_tokens")
    assert rows == [(sha(token), quote["id"])]
    async with public(app) as anon:
        assert (await anon.get(f"{URL}/chosen-token")).status_code == 404
        assert (await anon.get(f"{URL}/{token}")).status_code == 200


async def test_public_responses_are_never_cached_or_referred(client, app, airports, monkeypatch):
    enquiry, offers = await setup(client)
    _, token = await sent_quote(client, enquiry, offers)
    expired, other = await sent_quote(client, enquiry, offers)

    def private(r: httpx.Response, code: int) -> None:
        assert r.status_code == code, r.text
        assert r.headers["cache-control"] == "no-store"
        assert r.headers["referrer-policy"] == "no-referrer"

    decision = f"{URL}/{token}/decision"
    async with public(app) as anon:
        private(await anon.get(f"{URL}/{token}"), 200)
        private(await anon.get(f"{URL}/not-a-link"), 404)
        private(await anon.post(f"{URL}/not-a-link/decision", json={"decision": "decline"}), 404)
        private(await anon.post(decision, json={"decision": "maybe"}), 422)
        private(await anon.post(decision, json={"decision": "accept"}), 422)
        private(await anon.post(decision, json={"decision": "decline"}), 200)
        private(await anon.post(decision, json={"decision": "decline"}), 409)
        await client.post(f"/api/v1/quotes/{expired['id']}/status", json={"status": "expired"})
        private(await anon.post(f"{URL}/{other}/decision", json={"decision": "decline"}), 410)
        monkeypatch.setattr(get_settings(), "public_quote_max_per_minute", 0)
        private(await anon.get(f"{URL}/{token}"), 429)


# --- beyond the brief -------------------------------------------------------------------------


async def test_resend_after_expiry_clears_the_decision(client, app, airports):
    enquiry, offers = await setup(client)
    quote, old = await sent_quote(client, enquiry, offers)
    await client.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "expired"})
    assert (await client.get(f"/api/v1/quotes/{quote['id']}")).json()["decided_at"]
    new = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()["token"]
    detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
    assert (detail["status"], detail["decided_at"]) == ("sent", None)
    async with public(app) as anon:
        assert (await anon.get(f"{URL}/{old}")).status_code == 404
        got = (await anon.get(f"{URL}/{new}")).json()
        assert (got["status"], got["decided_at"]) == ("viewed", None)
        r = await anon.post(f"{URL}/{new}/decision", json={"decision": "accept", "option_index": 0})
        assert r.json()["status"] == "accepted"


async def _service_quote(client, offers, *, children: list[int]) -> str:
    """Build and send a quote through the service helpers; returns its share token."""
    from travelmind.db import bind_tenant, get_sessionmaker
    from travelmind.workspace.quotes import (
        QuoteCreate,
        add_version_from_views,
        create_quote,
        send_quote,
    )

    enquiry = (
        await client.post(
            "/api/v1/enquiries",
            json={
                "origin": "DEL",
                "destination": "BOM",
                "depart_date": DAY,
                "adults": 2,
                "children_ages": children,
            },
        )
    ).json()
    agency = await agency_of(client)
    async with get_sessionmaker()() as db:
        await bind_tenant(db, UUID(agency))
        quote = await create_quote(
            db,
            UUID(agency),
            None,
            QuoteCreate(enquiry_id=enquiry["id"], markup_kind="fixed", markup_value=1001),
        )
        await add_version_from_views(db, quote, offers, "", None)
        token = await send_quote(db, quote, None)
        await db.commit()
    return token


async def test_labels_prices_and_itinerary_for_the_client(client, app, airports):
    from tests.offers.offer_factory import make_offer
    from travelmind.offers.models import Baggage, FareConditions
    from travelmind.offers.service import offer_view

    await signup(client)
    made = [
        make_offer(
            [
                ("DEL", "BOM", "AI", "101", "2026-11-20T06:10:00"),
                ("BOM", "GOI", "AI", "655", "2026-11-20T10:00:00"),
            ],
            offer_ref="live",
            supplier="duffel",
            provenance="LIVE",
            total_minor=900000,
            passenger_count=2,
            owner_name="Air India",
            cabin="economy",
            baggage=Baggage(checked=1, carry_on=1),
            conditions=FareConditions(refundable=False, changeable=True),
            co2_kg_per_passenger=120,
        ),
        make_offer(
            [("DEL", "BOM", "6E", "2001", "2026-11-20T08:00:00")],
            offer_ref="cached",
            supplier="travelpayouts",
            provenance="CACHED",
            total_minor=700000,
            passenger_count=2,
        ),
        make_offer(
            [("DEL", "BOM", "UK", "933", "2026-11-20T09:00:00")],
            offer_ref="sandbox",
            supplier="sandbox",
            provenance="SANDBOX",
            total_minor=800000,
            passenger_count=2,
        ),
    ]
    views = [offer_view(o, o.total, None) for o in made]
    adults_only = await _service_quote(client, views, children=[])
    with_child = await _service_quote(client, views, children=[7])
    async with public(app) as anon:
        body = (await anon.get(f"{URL}/{adults_only}")).json()
        family = (await anon.get(f"{URL}/{with_child}")).json()
    live, cached, sandbox = body["options"]
    assert [live["price_label"], cached["price_label"], sandbox["price_label"]] == [
        LIVE,
        INDICATIVE,
        INDICATIVE,
    ]
    assert "bookable" not in str(body).lower()
    assert live["sell"] == {"amount_minor": 901001, "currency": "INR"}
    # An even share of the sell price (rounded half-up), for an adults-only party.
    assert live["per_traveller"] == {"amount_minor": 450501, "currency": "INR"}
    assert [o["per_traveller"] for o in family["options"]] == [None, None, None]
    assert (live["carrier_code"], live["carrier_name"], live["cabin"]) == (
        "AI",
        "Air India",
        "economy",
    )
    assert live["baggage"] == {"checked": 1, "carry_on": 1}
    assert (live["refundable"], live["changeable"], live["co2_kg_per_passenger"]) == (
        False,
        True,
        120,
    )
    assert (cached["refundable"], cached["changeable"], cached["co2_kg_per_passenger"]) == (
        None,
        None,
        None,
    )
    assert live["slices"] == [
        {
            "origin": "DEL",
            "destination": "GOI",
            "departing_at": "2026-11-20T06:10:00",
            "arriving_at": "2026-11-20T12:00:00",
            "duration_minutes": 240,
            "stops": 1,
            "segments": [
                {
                    "marketing_carrier": "AI",
                    "flight_number": "101",
                    "origin": "DEL",
                    "destination": "BOM",
                    "departing_at": "2026-11-20T06:10:00",
                    "arriving_at": "2026-11-20T08:10:00",
                },
                {
                    "marketing_carrier": "AI",
                    "flight_number": "655",
                    "origin": "BOM",
                    "destination": "GOI",
                    "departing_at": "2026-11-20T10:00:00",
                    "arriving_at": "2026-11-20T12:00:00",
                },
            ],
        }
    ]
    assert body["client_first_name"] is None and body["message"] == ""


async def test_public_token_never_logged(client, app, airports, caplog, capsys):
    enquiry, offers = await setup(client)
    _, token = await sent_quote(client, enquiry, offers)
    caplog.set_level(logging.DEBUG)
    async with public(app) as anon:
        await anon.get(f"{URL}/{token}")
        await anon.post(f"{URL}/{token}/decision", json={"decision": "accept", "option_index": 0})
        await anon.get(f"{URL}/{token[:-1]}")
    captured = capsys.readouterr()
    for record in caplog.records:
        assert token not in record.getMessage() and token not in str(record.args)
    assert token not in captured.out and token not in captured.err


def _alembic(target: str, direction: str) -> None:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", os.environ["TM_MIGRATION_DATABASE_URL"])
    getattr(command, direction)(cfg, target)


async def test_migration_backfills_links_already_sent(client, app, airports):
    enquiry, offers = await setup(client)
    quote, token = await sent_quote(client, enquiry, offers)
    await asyncio.to_thread(_alembic, "0005_ssr_search_index", "downgrade")
    try:
        tables = await as_owner("SELECT to_regclass('quote_share_tokens')::text")
        assert tables == [(None,)]
    finally:
        await asyncio.to_thread(_alembic, "head", "upgrade")
    rows = await as_owner("SELECT token_hash, quote_id::text FROM quote_share_tokens")
    assert rows == [(sha(token), quote["id"])]
    async with public(app) as anon:
        assert (await anon.get(f"{URL}/{token}")).json()["status"] == "viewed"


def test_access_log_redacts_share_tokens(app, caplog):
    """uvicorn's access log prints every request path; a quote link's path is its token."""
    token = "Zx9-secretToken_abcdefghijklmnopqrstuvwxyz0123"
    caplog.set_level(logging.INFO)
    access = logging.getLogger("uvicorn.access")
    line = '%s - "%s %s HTTP/%s" %d'
    access.info(line, "203.0.113.7:50000", "GET", f"{URL}/{token}", "1.1", 200)
    access.info(line, "203.0.113.7:50000", "POST", f"{URL}/{token}/decision?x=1", "1.1", 200)
    access.info(f"GET {URL}/{token}")
    access.info(line, "203.0.113.7:50000", "GET", "/api/v1/quotes?status=sent", "1.1", 200)
    messages = [record.getMessage() for record in caplog.records]
    assert all(token not in m for m in messages)
    assert messages == [
        f'203.0.113.7:50000 - "GET {URL}/[redacted] HTTP/1.1" 200',
        f'203.0.113.7:50000 - "POST {URL}/[redacted]/decision?x=1 HTTP/1.1" 200',
        f"GET {URL}/[redacted]",
        '203.0.113.7:50000 - "GET /api/v1/quotes?status=sent HTTP/1.1" 200',
    ]
    # Building the app again doesn't stack filters.
    from travelmind.main import create_app

    create_app()
    filters = [f for f in access.filters if type(f).__name__ == "ShareTokenFilter"]
    assert len(filters) == 1
