"""Query budgets for the hot list and dashboard reads: a fixed number of SQL statements per
request, whatever the number of rows (no per-row queries), and the hot-path indexes in place.

Statements are counted with a `before_cursor_execute` listener on the engine's sync side, so the
count covers everything the request sends: the tenant binding, lazy quote expiry and the reads
themselves. The session lookup is answered by the (warmed) per-process session cache.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import event

from tests.dashboard.fixtures import view
from tests.helpers import run_as_owner, signup
from travelmind.db import bind_tenant, get_engine, get_sessionmaker
from travelmind.workspace.clients import ClientCreate, create_client
from travelmind.workspace.enquiries import EnquiryCreate, create_enquiry
from travelmind.workspace.quotes import (
    QuoteCreate,
    add_version_from_views,
    create_quote,
    send_quote,
)

DAY = timedelta(days=1)

CLIENTS_BUDGET = 6
ENQUIRIES_BUDGET = 6
QUOTES_BUDGET = 6
SUMMARY_BUDGET = 25


@pytest.fixture
def statements() -> Iterator[list[str]]:
    """Every SQL statement sent while the test runs (clear it before the request you measure)."""
    seen: list[str] = []
    engine = get_engine().sync_engine

    def record(conn, cursor, statement, parameters, context, executemany) -> None:  # type: ignore[no-untyped-def]
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    yield seen
    event.remove(engine, "before_cursor_execute", record)


async def seed_workspace(agency_id: UUID, user_id: UUID, *, first: int, count: int) -> None:
    """`count` clients, each with one enquiry and one quote (a version each; every other quote
    sent), numbered from `first`."""
    now = datetime.now(UTC)
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency_id)
        for n in range(first, first + count):
            person = await create_client(
                db,
                agency_id,
                user_id,
                ClientCreate(name=f"Client {n}", email=f"client{n}@example.com", tags=["vip"]),
                now=now - 20 * DAY,
            )
            enquiry = await create_enquiry(
                db,
                agency_id,
                user_id,
                EnquiryCreate(
                    client_id=person.id,
                    origin="DEL",
                    destination="BOM",
                    depart_date=(now + (10 + n % 20) * DAY).date(),
                    assignee_user_id=user_id,
                ),
                now=now - 10 * DAY,
            )
            quote = await create_quote(
                db,
                agency_id,
                user_id,
                QuoteCreate(enquiry_id=enquiry.id, markup_kind="fixed", markup_value=0),
                now=now - 9 * DAY,
            )
            await add_version_from_views(
                db, quote, [view(f"o{n}", 500000 + n)], "", user_id, now=now - 9 * DAY
            )
            if n % 2:
                await send_quote(db, quote, user_id, now=now - 8 * DAY)
        await db.commit()


async def _owner(client) -> tuple[UUID, UUID]:  # type: ignore[no-untyped-def]
    me = (await signup(client)).json()
    # Warm the session cache: measured requests then see the steady state (no session lookup).
    assert (await client.get("/api/v1/auth/me")).status_code == 200
    return UUID(me["agency"]["id"]), UUID(me["user"]["id"])


async def _count(client, statements: list[str], path: str) -> int:  # type: ignore[no-untyped-def]
    statements.clear()
    r = await client.get(path)
    assert r.status_code == 200, r.text
    return len(statements)


async def _counts_for_3_and_30(client, statements: list[str], path: str) -> tuple[int, int]:  # type: ignore[no-untyped-def]
    agency_id, user_id = await _owner(client)
    await seed_workspace(agency_id, user_id, first=1, count=3)
    small = await _count(client, statements, path)
    await seed_workspace(agency_id, user_id, first=4, count=27)
    large = await _count(client, statements, path)
    return small, large


async def test_clients_list_query_budget(client, airports, statements):
    small, large = await _counts_for_3_and_30(client, statements, "/api/v1/clients")
    assert small == large <= CLIENTS_BUDGET, (small, large)


async def test_enquiries_list_query_budget(client, airports, statements):
    small, large = await _counts_for_3_and_30(client, statements, "/api/v1/enquiries")
    assert small == large <= ENQUIRIES_BUDGET, (small, large)


async def test_enquiries_by_client_query_budget(client, airports, statements):
    """Filtering by client costs no more statements than the plain list."""
    agency_id, user_id = await _owner(client)
    await seed_workspace(agency_id, user_id, first=1, count=30)
    plain = await _count(client, statements, "/api/v1/enquiries")
    people = (await client.get("/api/v1/clients")).json()["items"]
    path = f"/api/v1/enquiries?client_id={people[0]['id']}"
    statements.clear()
    r = await client.get(path)
    assert r.status_code == 200 and r.json()["total"] == 1, r.text
    assert len(statements) == plain <= ENQUIRIES_BUDGET, (plain, len(statements))


async def test_quotes_list_query_budget(client, airports, statements):
    small, large = await _counts_for_3_and_30(client, statements, "/api/v1/quotes")
    assert small == large <= QUOTES_BUDGET, (small, large)


async def test_list_budgets_hold_while_quotes_expire(client, airports, statements):
    """Lazy expiry of many quotes at once is one UPDATE and one batched INSERT, not per quote."""
    agency_id, user_id = await _owner(client)
    await seed_workspace(agency_id, user_id, first=1, count=30)
    baseline = await _count(client, statements, "/api/v1/quotes")
    await run_as_owner("ALTER TABLE quotes NO FORCE ROW LEVEL SECURITY")
    try:
        await run_as_owner(
            "UPDATE quotes SET share_expires_at = now() - interval '1 minute' "
            "WHERE share_expires_at IS NOT NULL"
        )
    finally:
        await run_as_owner("ALTER TABLE quotes FORCE ROW LEVEL SECURITY")
    expiring = await _count(client, statements, "/api/v1/quotes")
    assert expiring <= baseline + 1, (baseline, expiring)


async def test_dashboard_summary_query_budget(client, airports, statements, monkeypatch):
    from travelmind.dashboard import router as dashboard_router

    async def no_cache(redis, agency_id, parts, ttl_s, loader, **kwargs):  # type: ignore[no-untyped-def]
        return await loader()

    monkeypatch.setattr(dashboard_router, "cached_agency_json", no_cache)
    small, large = await _counts_for_3_and_30(client, statements, "/api/v1/dashboard/summary")
    assert small == large <= SUMMARY_BUDGET, (small, large)


# Added by 0008_hot_path_indexes: each lets a hot read walk only the rows it returns.
HOT_INDEXES = {
    "ix_enquiries_agency_created": (
        "enquiries",
        "CREATE INDEX ix_enquiries_agency_created ON public.enquiries "
        "USING btree (agency_id, created_at, number)",
    ),
    "ix_quotes_agency_created": (
        "quotes",
        "CREATE INDEX ix_quotes_agency_created ON public.quotes "
        "USING btree (agency_id, created_at, number)",
    ),
    "ix_clients_agency_updated": (
        "clients",
        "CREATE INDEX ix_clients_agency_updated ON public.clients "
        "USING btree (agency_id, updated_at DESC, id)",
    ),
    "ix_flight_searches_route": (
        "flight_searches",
        "CREATE INDEX ix_flight_searches_route ON public.flight_searches "
        "USING btree (agency_id, origin, destination, created_at)",
    ),
    # 0010: the overdue-quote lookup and lazy expiry probe only live shared quotes.
    "ix_quotes_agency_share_due": (
        "quotes",
        "CREATE INDEX ix_quotes_agency_share_due ON public.quotes "
        "USING btree (agency_id, share_expires_at) "
        "WHERE ((status)::text = ANY ((ARRAY['sent'::character varying, "
        "'viewed'::character varying])::text[]))",
    ),
}


async def test_hot_indexes_exist():
    from tests.helpers import exec_as_tenant

    rows = await exec_as_tenant(
        "00000000-0000-0000-0000-000000000000",
        "SELECT indexname, tablename, indexdef FROM pg_indexes WHERE schemaname = 'public' "
        "AND indexname = ANY(:names)",
        {"names": list(HOT_INDEXES)},
    )
    assert {name: (table, definition) for name, table, definition in rows} == HOT_INDEXES
