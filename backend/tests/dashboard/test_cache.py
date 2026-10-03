"""The Command Center's summary and pipeline are read through the per-agency Redis cache: served
from it until the agency's data changes, never shared between agencies, and fresh on the very
next read after any write."""

import os
from datetime import UTC, datetime
from uuid import UUID

import pytest
from redis.asyncio import Redis

from tests.helpers import make_client, signup
from tests.workspace.test_public_quotes import URL, overdue, public, sent_quote, setup
from travelmind.dashboard import metrics
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.identity import service as identity_service
from travelmind.readcache import agency_version
from travelmind.workspace.enquiries import EnquiryCreate, create_enquiry


@pytest.fixture
async def redis():
    client = Redis.from_url(os.environ["TM_REDIS_URL"])
    yield client
    await client.aclose()


async def kpis(client) -> dict:
    r = await client.get("/api/v1/dashboard/summary")
    assert r.status_code == 200, r.text
    return {k["key"]: k["value"] for k in r.json()["kpis"]}


async def stages(client) -> dict:
    r = await client.get("/api/v1/dashboard/pipeline")
    assert r.status_code == 200, r.text
    return {s["status"]: s["count"] for s in r.json()["stages"]}


async def agency_id_of(client) -> UUID:
    return UUID((await client.get("/api/v1/agency")).json()["id"])


async def sneak_enquiry(agency: UUID) -> None:
    """An enquiry written behind the API's back (no invalidation), to see what a read serves."""
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        await create_enquiry(db, agency, None, EnquiryCreate(origin="DEL", destination="BOM"))
        await db.commit()


async def uncached_summary(agency: UUID) -> dict:
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        settings = await identity_service.get_agency_settings(db, agency)
        out = await metrics.summary(db, settings, "30d", now=datetime.now(UTC))
    return {k.key: k.value for k in out.kpis}


async def test_summary_and_pipeline_are_served_from_the_cache(seeded):
    client, agency, _ = seeded
    first, first_stages = await kpis(client), await stages(client)
    await sneak_enquiry(agency)
    assert await kpis(client) == first  # cached: the sneaked row is not seen yet
    assert await stages(client) == first_stages


async def test_cache_keys_are_tenant_scoped(seeded, app, redis):
    client, alpha, _ = seeded
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        beta = await agency_id_of(other)
        a1, b1 = await kpis(client), await kpis(other)
        a2, b2 = await kpis(client), await kpis(other)  # both from the cache now
        assert a1 == a2 and b1 == b2
        assert a1 != b1
        assert a1 == await uncached_summary(alpha)
        assert b1 == await uncached_summary(beta)
        assert a1["open_enquiries"] == 3 and b1["open_enquiries"] == 0
        assert (await stages(other))["new"] == 0
    keys = sorted(k.decode() for k in await redis.keys("tm:rc:a:*"))
    assert any(f":{alpha}:" in k and ":summary:" in k for k in keys)
    assert any(f":{beta}:" in k and ":summary:" in k for k in keys)
    assert all(f":{alpha}:" in k or f":{beta}:" in k for k in keys)


async def test_write_invalidates_agency_cache(seeded):
    client, _, _ = seeded
    before, before_stages = await kpis(client), await stages(client)
    created = await client.post(
        "/api/v1/enquiries",
        json={"origin": "DEL", "destination": "GOI", "depart_date": "2027-01-15"},
    )
    assert created.status_code == 201
    after, after_stages = await kpis(client), await stages(client)
    assert after["open_enquiries"] == before["open_enquiries"] + 1
    assert after_stages["new"] == before_stages["new"] + 1
    moved = await client.post(
        f"/api/v1/enquiries/{created.json()['id']}/status", json={"status": "quoting"}
    )
    assert moved.status_code == 200, moved.text
    final = await stages(client)
    assert final["new"] == before_stages["new"]
    assert final["quoting"] == before_stages["quoting"] + 1


async def test_a_search_invalidates_the_searches_kpi(client, airports):
    enquiry, _ = await setup(client)  # one search so far
    assert enquiry
    before = await kpis(client)
    r = await client.post(
        "/api/v1/flights/search",
        json={"origin": "DEL", "destination": "GOI", "departure_date": "2027-01-15"},
    )
    assert r.status_code == 200
    assert (await kpis(client))["searches"] == before["searches"] + 1


async def test_public_decision_invalidates(client, app, airports):
    enquiry, offers = await setup(client)
    _, token = await sent_quote(client, enquiry, offers)
    before, before_stages = await kpis(client), await stages(client)
    assert before["win_rate"] is None and before_stages["won"] == 0
    async with public(app) as anon:
        accept = {"decision": "accept", "option_index": 0}
        r = await anon.post(f"{URL}/{token}/decision", json=accept)
        assert r.status_code == 200, r.text
    after, after_stages = await kpis(client), await stages(client)
    assert after["win_rate"] == 100.0
    assert after_stages["won"] == 1 and after_stages["quoted"] == before_stages["quoted"] - 1


async def test_public_first_view_invalidates(client, app, airports, redis):
    enquiry, offers = await setup(client)
    _, token = await sent_quote(client, enquiry, offers)
    agency = await agency_id_of(client)
    version = await agency_version(redis, agency)
    async with public(app) as anon:
        assert (await anon.get(f"{URL}/{token}")).json()["status"] == "viewed"
        assert await agency_version(redis, agency) > version
        version = await agency_version(redis, agency)
        await anon.get(f"{URL}/{token}")  # a repeat view changes nothing
    assert await agency_version(redis, agency) == version


async def test_dashboard_expiry_refreshes_before_the_cached_read(client, airports):
    enquiry, offers = await setup(client)
    quote, _ = await sent_quote(client, enquiry, offers)
    agency = await agency_id_of(client)
    before = await kpis(client)
    assert before["pipeline_value"] > 0
    await overdue(str(agency), quote["id"])
    assert (await kpis(client))["pipeline_value"] == 0


async def test_lazy_expiry_elsewhere_invalidates(client, airports):
    enquiry, offers = await setup(client)
    quote, _ = await sent_quote(client, enquiry, offers)
    agency = await agency_id_of(client)
    assert (await kpis(client))["pipeline_value"] > 0
    await overdue(str(agency), quote["id"])
    # The quotes list expires it first; the dashboard's own expiry then finds nothing to do.
    listed = (await client.get("/api/v1/quotes")).json()["items"]
    assert [q["status"] for q in listed] == ["expired"]
    assert (await kpis(client))["pipeline_value"] == 0


async def test_reads_that_change_nothing_keep_the_cache(seeded, redis):
    client, agency, _ = seeded
    await kpis(client)
    version = await agency_version(redis, agency)
    for path in ("/api/v1/quotes", "/api/v1/enquiries", "/api/v1/dashboard/activity"):
        assert (await client.get(path)).status_code == 200
    await client.get("/api/v1/search", params={"q": "E-0001"})
    await kpis(client)
    assert await agency_version(redis, agency) == version


async def test_dashboard_works_when_redis_is_down(seeded, monkeypatch):
    client, _, _ = seeded
    monkeypatch.setenv("TM_REDIS_URL", "redis://127.0.0.1:1/0")
    from travelmind import cache
    from travelmind.config import get_settings

    await cache.close_redis()
    get_settings.cache_clear()
    try:
        values = await kpis(client)
        assert values["open_enquiries"] == 3
        assert (await stages(client))["new"] == 2
        created = await client.post(
            "/api/v1/enquiries",
            json={"origin": "DEL", "destination": "GOI", "depart_date": "2027-01-15"},
        )
        assert created.status_code == 201
        assert (await kpis(client))["open_enquiries"] == 4
    finally:
        await cache.close_redis()
        get_settings.cache_clear()
