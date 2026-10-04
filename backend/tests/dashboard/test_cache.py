"""The Command Center's summary and pipeline are read through the per-agency Redis cache: served
from it until the agency's data changes, never shared between agencies, and fresh on the very
next read after any write."""

import os
import time
from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from redis.asyncio import Redis

from tests.helpers import make_client, signup
from tests.workspace.test_public_quotes import URL, overdue, public, sent_quote, setup
from travelmind.config import get_settings
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


SEARCH = "/api/v1/flights/search"
TRIP = {"origin": "DEL", "destination": "GOI", "departure_date": "2027-01-15"}
STAY = {"destination": "BOM", "checkin": "2027-01-15", "checkout": "2027-01-17"}


async def test_searches_show_on_the_dashboard_at_once_and_keep_the_cache(seeded, airports, redis):
    """The "searches" KPI is computed on every read, so each search shows on the very next one,
    and searching retires nothing: the other cards and the pipeline stay cached."""
    client, agency, _ = seeded
    before, before_stages = await kpis(client), await stages(client)
    version = await agency_version(redis, agency)
    await sneak_enquiry(agency)  # only a cache retirement would reveal it
    searches = (
        lambda: client.post(SEARCH, json=TRIP),
        lambda: client.post(SEARCH, json=TRIP),
        lambda: client.post("/api/v1/hotels/search", json=STAY),  # hotel searches count too
    )
    for n, search in enumerate(searches, start=1):
        assert (await search()).status_code == 200
        r = await client.get("/api/v1/dashboard/summary")
        cards = {k["key"]: k for k in r.json()["kpis"]}
        assert cards["searches"]["value"] == before["searches"] + n
        assert cards["searches"]["series"][-1]["value"] >= n  # today's point moves too
        assert cards["open_enquiries"]["value"] == before["open_enquiries"]  # still cached
    assert await stages(client) == before_stages
    assert await agency_version(redis, agency) == version
    assert await redis.keys("tm:sb:*") == []


async def test_searches_reprices_and_seen_notifications_do_not_bump(client, airports, redis):
    await signup(client)
    agency = await agency_id_of(client)
    await kpis(client)
    version = await agency_version(redis, agency)
    offers = (await client.post(SEARCH, json=TRIP)).json()["offers"]
    assert (await client.post("/api/v1/hotels/search", json=STAY)).status_code == 200
    unknown = await client.post(SEARCH, json=TRIP | {"origin": "ZZZ"})
    assert unknown.status_code == 422
    priced = await client.post(f"/api/v1/flights/offers/{offers[0]['id']}/price")
    assert priced.status_code == 200, priced.text
    assert (await client.post("/api/v1/notifications/seen")).status_code == 204
    assert await agency_version(redis, agency) == version


# The searches card as two queries computed it before it became one (count, then daily series).
OLD_SEARCHES = """
    SELECT count(*) FILTER (WHERE occurred_at >= :start) AS value,
           count(*) FILTER (WHERE occurred_at < :start) AS previous
    FROM activity_events
    WHERE agency_id = :agency AND kind IN ('search.flights', 'search.hotels')
      AND occurred_at >= :prev_start AND occurred_at < :end
"""
OLD_SEARCHES_DAILY = """
    SELECT g.day::date AS day, COALESCE(agg.value, 0) AS value
    FROM generate_series(CAST(:first AS date)::timestamp, CAST(:today AS date)::timestamp,
                         interval '1 day') AS g(day)
    LEFT JOIN (
        SELECT (occurred_at AT TIME ZONE :tz)::date AS day, count(*) AS value
        FROM activity_events
        WHERE agency_id = :agency AND kind IN ('search.flights', 'search.hotels')
          AND occurred_at >= :start AND occurred_at < :end
        GROUP BY 1
    ) AS agg ON agg.day = g.day::date
    ORDER BY 1
"""


@pytest.mark.parametrize("range_", ["7d", "30d", "90d"])
async def test_the_live_searches_card_counts_as_before(seeded, range_):
    """The fixture's searches span both windows of every range."""
    from sqlalchemy import text

    client, agency, _ = seeded
    r = await client.get("/api/v1/dashboard/summary", params={"range": range_})
    card = next(k for k in r.json()["kpis"] if k["key"] == "searches")
    now = datetime.now(UTC)
    span = metrics.window(now, "Asia/Kolkata", metrics.RANGE_DAYS[range_])
    params = {
        "agency": agency,
        "tz": "Asia/Kolkata",
        "first": span.first,
        "today": span.today,
        "start": span.start,
        "end": span.end,
        "prev_start": span.prev_start,
    }
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        totals = (await db.execute(text(OLD_SEARCHES), params)).one()
        daily = (await db.execute(text(OLD_SEARCHES_DAILY), params)).all()
    assert (card["value"], card["previous"]) == (totals.value, totals.previous)
    assert totals.value > 0
    if range_ == "7d":
        assert totals.previous > 0  # searches 10 days ago: in the 7d range's previous window
    assert card["series"] == [{"date": d.isoformat(), "value": v} for d, v in daily]


def test_the_summary_body_is_the_model_s_json():
    from travelmind.dashboard.router import summary_body
    from travelmind.dashboard.schemas import Kpi, SeriesPoint, SummaryOut

    day = datetime(2026, 10, 4, tzinfo=UTC).date()
    co2 = Kpi(
        key="co2_quoted",
        label="CO₂ quoted",
        value=1.5,
        unit="kg",
        previous=None,
        series=[SeriesPoint(date=day, value=2)],
    )
    sent = Kpi(
        key="quotes_sent", label='Quotes "sent"', value=3, unit="count", previous=1, series=[]
    )
    searches = Kpi(
        key="searches",
        label="Searches",
        value=0,
        unit="count",
        previous=0,
        series=[SeriesPoint(date=day, value=0)],
    )
    for cached in ([], [co2], [co2, sent]):
        raw = TypeAdapter(list[Kpi]).dump_json(cached)
        expected = SummaryOut(range="30d", currency="INR", kpis=[*cached, searches])
        assert summary_body("30d", "INR", raw, searches) == expected.model_dump_json().encode()


async def test_a_search_succeeds_when_redis_is_down(client, airports, monkeypatch):
    await signup(client)
    monkeypatch.setenv("TM_REDIS_URL", "redis://127.0.0.1:1/0")
    from travelmind import cache

    await cache.close_redis()
    get_settings.cache_clear()
    try:
        assert (await client.post(SEARCH, json=TRIP)).status_code == 200
        assert (await client.post("/api/v1/hotels/search", json=STAY)).status_code == 200
    finally:
        await cache.close_redis()
        get_settings.cache_clear()


async def test_a_hung_redis_adds_at_most_one_short_timeout_per_request(seeded, app):
    from tests.test_readcache import HungRedis
    from travelmind.cache import get_redis

    client, _, _ = seeded
    hung = HungRedis()

    async def hung_redis():
        yield hung

    app.dependency_overrides[get_redis] = hung_redis
    try:
        for call in (
            lambda: client.get("/api/v1/dashboard/summary"),
            lambda: client.get("/api/v1/dashboard/pipeline"),
            lambda: client.post(
                "/api/v1/enquiries",
                json={"origin": "DEL", "destination": "GOI", "depart_date": "2027-01-15"},
            ),
        ):
            waited = hung.waited
            started = time.perf_counter()
            r = await call()
            assert r.status_code in (200, 201), r.text
            assert hung.waited - waited < 0.2  # one 150 ms timeout at most
            assert time.perf_counter() - started < 2.0  # not the socket timeout (2 s per call)
    finally:
        app.dependency_overrides.pop(get_redis)


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
