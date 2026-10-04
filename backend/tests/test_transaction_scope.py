"""No request holds a database connection while it waits on something slow.

A pooled connection checked out is a Postgres (or PgBouncer server) connection held: when a
request keeps one while it waits on a supplier, on Redis or on the client, the pool runs dry
under load although Postgres is idle ("idle in transaction"). These tests count connections
checked out of the engine's pool at the moment the slow call happens.
"""

import asyncio
from collections.abc import Iterator

import pytest
from sqlalchemy import event

from tests.helpers import signup
from tests.offers.offer_factory import make_offer
from tests.offers.test_search_api import StubSupplier, trip, use_suppliers
from travelmind.db import get_engine
from travelmind.reference.service import reset_airport_index

SEARCH = "/api/v1/flights/search"


class Checkouts:
    def __init__(self) -> None:
        self.out = 0


@pytest.fixture
def checkouts() -> Iterator[Checkouts]:
    """How many connections are checked out of the app's pool right now."""
    state = Checkouts()
    pool = get_engine().sync_engine.pool

    def checkout(dbapi_conn, record, proxy) -> None:  # type: ignore[no-untyped-def]
        state.out += 1

    def checkin(dbapi_conn, record) -> None:  # type: ignore[no-untyped-def]
        state.out -= 1

    event.listen(pool, "checkout", checkout)
    event.listen(pool, "checkin", checkin)
    yield state
    event.remove(pool, "checkout", checkout)
    event.remove(pool, "checkin", checkin)


class WatchingSupplier(StubSupplier):
    """A slow supplier that notes how many connections were checked out while it worked."""

    def __init__(self, checkouts: Checkouts, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        super().__init__(*args, **kwargs)
        self.checkouts = checkouts
        self.seen: list[int] = []

    async def search(self, request):  # type: ignore[no-untyped-def]
        await asyncio.sleep(0.05)
        self.seen.append(self.checkouts.out)
        return await super().search(request)

    async def price(self, supplier_ref):  # type: ignore[no-untyped-def]
        await asyncio.sleep(0.05)
        self.seen.append(self.checkouts.out)
        return await super().price(supplier_ref)


def offer(ref: str = "watched"):  # type: ignore[no-untyped-def]
    return make_offer([("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00")], offer_ref=ref)


async def test_no_connection_is_held_during_the_supplier_fan_out(
    client, airports, checkouts, monkeypatch
):
    watched = WatchingSupplier(checkouts, "stub", [offer()])
    use_suppliers(monkeypatch, watched)
    await signup(client)
    # The first search looks the session up in the database (nothing cached yet) and reloads
    # the airport index: both are reads that must end before the suppliers are called.
    reset_airport_index()
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    assert watched.seen == [0, 0]
    assert checkouts.out == 0


async def test_no_connection_is_held_during_a_price_check(client, airports, checkouts, monkeypatch):
    watched = WatchingSupplier(checkouts, "stub", [offer()], price=offer())
    use_suppliers(monkeypatch, watched)
    await signup(client)
    assert (await client.post(SEARCH, json=trip())).status_code == 200
    reset_airport_index()  # the price check reloads the index first
    r = await client.post("/api/v1/flights/offers/stub~watched/price")
    assert r.status_code == 200, r.text
    assert watched.seen == [0, 0]


async def test_a_signed_in_request_holds_no_connection_after_the_session_lookup(
    client, airports, checkouts, monkeypatch
):
    """The session lookup's transaction ends before the endpoint runs."""
    from travelmind.reference import router as reference_router

    seen: list[int] = []
    real = reference_router.get_airport_index

    async def watching(db):  # type: ignore[no-untyped-def]
        seen.append(checkouts.out)
        return await real(db)

    monkeypatch.setattr(reference_router, "get_airport_index", watching)
    await signup(client)
    r = await client.get("/api/v1/reference/airports?q=del")  # a cache miss: looked up in the DB
    assert r.status_code == 200
    assert seen == [0]


async def test_the_dashboard_releases_its_connection_before_writing_the_cache(
    client, airports, checkouts, monkeypatch
):
    from travelmind import readcache

    seen: list[int] = []
    real = readcache.cached_json

    async def watching(redis, key, ttl_s, loader, **kwargs):  # type: ignore[no-untyped-def]
        async def load():  # type: ignore[no-untyped-def]
            value = await loader()
            seen.append(checkouts.out)  # what the cache write that follows would hold
            return value

        return await real(redis, key, ttl_s, load, **kwargs)

    monkeypatch.setattr(readcache, "cached_json", watching)
    await signup(client)
    for path in ("/api/v1/dashboard/summary", "/api/v1/dashboard/pipeline"):
        assert (await client.get(path)).status_code == 200
    assert seen == [0, 0]


async def test_writes_publish_their_cache_bump_without_a_connection(
    client, airports, checkouts, monkeypatch
):
    from travelmind import readcache

    seen: list[int] = []
    real = readcache.invalidate_agency

    async def watching(redis, agency_id):  # type: ignore[no-untyped-def]
        seen.append(checkouts.out)
        await real(redis, agency_id)

    monkeypatch.setattr(readcache, "invalidate_agency", watching)
    await signup(client)
    # Creating a client commits, then reads the new client back (a fresh transaction).
    assert (await client.post("/api/v1/clients", json={"name": "Meera"})).status_code == 201
    assert seen == [0]


async def test_every_connection_is_back_once_the_response_is_sent(client, airports, checkouts):
    await signup(client)
    for path in ("/api/v1/clients", "/api/v1/quotes", "/api/v1/dashboard/activity"):
        assert (await client.get(path)).status_code == 200
        assert checkouts.out == 0
