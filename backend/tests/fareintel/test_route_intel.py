"""Route fare intelligence: percentiles are Postgres percentile_cont (linear interpolation
between the closest ranks) rounded half-up to a whole minor unit."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from tests.helpers import exec_as_tenant, make_client, run_as_owner, signup
from travelmind.db import get_sessionmaker
from travelmind.fareintel.models import FareSnapshot
from travelmind.reference.service import reset_airport_index

URL = "/api/v1/routes/intel"
TODAY = datetime.now(UTC).date()
KOLKATA = ZoneInfo("Asia/Kolkata")  # the agency's time zone (signup default)
KEYS = {
    "origin",
    "destination",
    "cabin",
    "currency",
    "family",
    "daily",
    "by_days_out",
    "carriers",
    "your_searches",
    "updated_at",
}


def ago(days: int) -> date:
    return TODAY - timedelta(days=days)


def at(day: date) -> datetime:
    # 06:00 UTC is 11:30 in Asia/Kolkata (the agency's zone), so the local date is `day`.
    return datetime.combine(day, time(6, 0), tzinfo=UTC)


async def add(
    totals: list[int],
    *,
    day: date | None = None,
    days_out: int = 30,
    carrier: str | None = "AI",
    provenance: str = "LIVE",
    currency: str = "INR",
    cabin: str = "economy",
    origin: str = "DEL",
    destination: str = "BOM",
    observed: datetime | None = None,
) -> None:
    observed = observed or at(day or ago(3))
    async with get_sessionmaker()() as db:
        db.add_all(
            FareSnapshot(
                observed_at=observed,
                origin=origin,
                destination=destination,
                departure_date=observed.date() + timedelta(days=days_out),
                days_to_departure=days_out,
                cabin=cabin,
                carrier=carrier,
                stops=0,
                total_minor=t,
                currency=currency,
                provenance=provenance,
                source="test",
            )
            for t in totals
        )
        await db.commit()


async def intel(client, **params) -> dict:
    r = await client.get(URL, params={"origin": "DEL", "destination": "BOM"} | params)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == KEYS
    return body


async def test_daily_percentiles_are_exact(client, airports):
    await signup(client)
    await add([1000, 2000, 3000, 4000], day=ago(5))
    await add([1001, 1002], day=ago(3))
    await add([5000], day=ago(2))
    body = await intel(client)
    assert (body["origin"], body["destination"], body["cabin"], body["currency"]) == (
        "DEL",
        "BOM",
        "economy",
        "INR",
    )
    assert body["family"] == "market"
    assert body["daily"] == [
        # 1000..4000: p25 1750, median 2500, p75 3250 (linear interpolation).
        {
            "date": ago(5).isoformat(),
            "p25_minor": 1750,
            "median_minor": 2500,
            "p75_minor": 3250,
            "samples": 4,
        },
        # 1001, 1002: p25 1001.25 → 1001, median 1001.5 → 1002 (half-up), p75 1001.75 → 1002.
        {
            "date": ago(3).isoformat(),
            "p25_minor": 1001,
            "median_minor": 1002,
            "p75_minor": 1002,
            "samples": 2,
        },
        {
            "date": ago(2).isoformat(),
            "p25_minor": 5000,
            "median_minor": 5000,
            "p75_minor": 5000,
            "samples": 1,
        },
    ]
    # Truncated to the agency's local hour: 06:00 UTC is 11:30 in Kolkata, shown as 11:00 local.
    assert datetime.fromisoformat(body["updated_at"]) == at(ago(2)) - timedelta(minutes=30)


async def test_medians_round_half_up(client, airports):
    await signup(client)
    await add([1000, 1001])  # median 1000.5: half-up gives 1001 (Python's round() gives 1000)
    await add([2000, 2001], carrier="UK", days_out=100)
    body = await intel(client)
    # p25 1000.75 → 1001, median 1500.5 → 1501 (round() gives 1500), p75 2000.25 → 2000.
    assert [(d["p25_minor"], d["median_minor"], d["p75_minor"]) for d in body["daily"]] == [
        (1001, 1501, 2000)
    ]
    assert [b["median_minor"] for b in body["by_days_out"]] == [1001, 2001]
    assert {c["code"]: c["median_minor"] for c in body["carriers"]} == {"AI": 1001, "UK": 2001}


async def test_updated_at_is_truncated_to_the_local_hour(client, airports):
    await signup(client)
    await add([1000], observed=datetime.combine(ago(4), time(6, 37, 12, 500000), tzinfo=UTC))
    await add([1000], observed=datetime.combine(ago(4), time(6, 41, 3), tzinfo=UTC))
    body = await intel(client)
    # 06:41:03 UTC is 12:11:03 in Kolkata: shown as 12:00 local (06:30 UTC).
    assert datetime.fromisoformat(body["updated_at"]) == datetime.combine(
        ago(4), time(6, 30), tzinfo=UTC
    )


async def test_days_are_local_to_the_agency(client, airports):
    await signup(client)
    # 20:00 UTC is 01:30 the next morning in Kolkata.
    await add([1000], observed=datetime.combine(ago(5), time(20, 0), tzinfo=UTC))
    await add([3000], observed=datetime.combine(ago(5), time(18, 29), tzinfo=UTC))  # 23:59 local
    body = await intel(client)
    assert [(d["date"], d["median_minor"]) for d in body["daily"]] == [
        (ago(5).isoformat(), 3000),
        (ago(4).isoformat(), 1000),
    ]


async def test_window_edges_are_local_days(client, airports):
    await signup(client)
    local_today = datetime.now(KOLKATA).date()
    first = local_today - timedelta(days=59)  # the oldest local day in the window
    await add([1000], observed=datetime.combine(first, time(0, 0), tzinfo=KOLKATA))
    before = datetime.combine(first, time(0, 0), tzinfo=KOLKATA) - timedelta(microseconds=1)
    await add([999999], observed=before)  # the last instant of local day 60 ago
    body = await intel(client)
    assert [(d["date"], d["median_minor"], d["samples"]) for d in body["daily"]] == [
        (first.isoformat(), 1000, 1)
    ]


async def _add_dubai() -> None:
    await run_as_owner(
        "INSERT INTO countries (code, name, continent) VALUES ('AE', 'United Arab Emirates', 'AS')"
    )
    await run_as_owner(
        "INSERT INTO airports (iata_code, ident, name, city, country_code, airport_type, "
        "scheduled_service, latitude, longitude) VALUES ('DXB', 'OMDB', 'Dubai International "
        "Airport', 'Dubai', 'AE', 'large_airport', true, 25.2528, 55.3644)"
    )
    reset_airport_index()


async def test_figures_are_in_the_routes_currency(client, airports):
    """Fares and searches are recorded in the currency of the route's origin (as a fare search
    from there shows), not the agency's: an INR agency sees DXB → DEL in USD."""
    await signup(client)
    await _add_dubai()
    agency = (await client.get("/api/v1/agency")).json()["id"]
    await add([20000, 30000], origin="DXB", destination="DEL", currency="USD")
    await add([1500000], origin="DXB", destination="DEL", currency="INR")  # not the route's
    base = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
    await _log_search(agency, base, origin="DXB", destination="DEL", currency="USD", cheapest=250)
    await _log_search(
        agency, base + timedelta(hours=1), origin="DXB", destination="DEL", cheapest=21000
    )  # logged in INR: not the route's currency
    body = await intel(client, origin="DXB", destination="DEL")
    assert (body["currency"], body["family"]) == ("USD", "market")
    assert [(d["median_minor"], d["samples"]) for d in body["daily"]] == [(25000, 2)]
    assert [(b["median_minor"], b["samples"]) for b in body["by_days_out"]] == [(25000, 2)]
    assert body["carriers"] == [{"code": "AI", "samples": 2, "median_minor": 25000}]
    assert [s["cheapest_minor"] for s in body["your_searches"]] == [250]


async def test_an_indian_route_stays_in_inr_for_a_usd_agency(client, airports):
    await signup(client)
    agency = (await client.get("/api/v1/agency")).json()["id"]
    await run_as_owner("UPDATE agencies SET currency = 'USD' WHERE id = :id", {"id": agency})
    await add([4000, 6000])  # DEL → BOM in INR
    await add([70], currency="USD")
    await _log_search(agency, datetime(2026, 9, 1, 8, 0, tzinfo=UTC), cheapest=4500)  # INR
    await _log_search(agency, datetime(2026, 9, 1, 9, 0, tzinfo=UTC), currency="USD")
    body = await intel(client)
    assert body["currency"] == "INR"
    assert [(d["median_minor"], d["samples"]) for d in body["daily"]] == [(5000, 2)]
    assert [s["cheapest_minor"] for s in body["your_searches"]] == [4500]


async def test_days_out_buckets_and_carriers(client, airports):
    await signup(client)
    await add([100, 300], days_out=0)
    await add([700], days_out=7)
    await add([800], days_out=8)
    await add([2100, 2200], days_out=21)
    await add([2200], days_out=22)
    await add([4500, 4600, 4700], days_out=45)
    await add([9000], days_out=90)
    await add([9100, 9300], days_out=91)
    await add([20000], days_out=300)
    body = await intel(client)
    assert body["by_days_out"] == [
        {"bucket": "0-7", "median_minor": 300, "samples": 3},
        {"bucket": "8-21", "median_minor": 2100, "samples": 3},
        {"bucket": "22-45", "median_minor": 4550, "samples": 4},
        {"bucket": "46-90", "median_minor": 9000, "samples": 1},
        {"bucket": "91+", "median_minor": 9300, "samples": 3},
    ]


async def test_top_eight_carriers_by_samples(client, airports):
    await signup(client)
    for i, code in enumerate(["AI", "6E", "UK", "SG", "QP", "IX", "I5", "G8", "9W"]):
        await add([1000 + 10 * j for j in range(9 - i)], carrier=code)
    await add([1, 2, 3], carrier=None)  # unknown carrier: counted in the daily figures only
    body = await intel(client)
    assert body["carriers"] == [
        {"code": "AI", "samples": 9, "median_minor": 1040},
        {"code": "6E", "samples": 8, "median_minor": 1035},
        {"code": "UK", "samples": 7, "median_minor": 1030},
        {"code": "SG", "samples": 6, "median_minor": 1025},
        {"code": "QP", "samples": 5, "median_minor": 1020},
        {"code": "IX", "samples": 4, "median_minor": 1015},
        {"code": "I5", "samples": 3, "median_minor": 1010},
        {"code": "G8", "samples": 2, "median_minor": 1005},
    ]
    assert body["daily"][0]["samples"] == 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1 + 3


async def test_carrier_ties_break_by_code(client, airports):
    await signup(client)
    await add([500, 600], carrier="UK")
    await add([100, 200], carrier="AI")
    body = await intel(client)
    assert [c["code"] for c in body["carriers"]] == ["AI", "UK"]


async def test_market_fares_beat_sandbox(client, airports):
    await signup(client)
    await add([1000, 3000], provenance="LIVE")
    await add([2000], provenance="CACHED")
    await add([1, 2, 3, 4], provenance="SANDBOX")
    body = await intel(client)
    assert body["family"] == "market"
    assert [(d["median_minor"], d["samples"]) for d in body["daily"]] == [(2000, 3)]
    assert [(b["median_minor"], b["samples"]) for b in body["by_days_out"]] == [(2000, 3)]


async def test_sandbox_only_route_is_labelled_sandbox(client, airports):
    await signup(client)
    await add([1000, 2000, 3000], provenance="SANDBOX")
    await add([50], provenance="LIVE", currency="USD")  # market fares, but not in INR
    await add([70], provenance="LIVE", cabin="business")  # market fares, but another cabin
    body = await intel(client)
    assert body["family"] == "sandbox"
    assert body["daily"] == [
        {
            "date": ago(3).isoformat(),
            "p25_minor": 1500,
            "median_minor": 2000,
            "p75_minor": 2500,
            "samples": 3,
        }
    ]
    business = await intel(client, cabin="business")
    assert business["family"] == "market" and business["daily"][0]["median_minor"] == 70


async def test_only_the_last_sixty_days_count(client, airports):
    await signup(client)
    await add([1000], day=ago(50))
    await add([999999], day=ago(70))
    await add([555], day=ago(70), provenance="CACHED", carrier="UK")
    body = await intel(client)
    assert [d["date"] for d in body["daily"]] == [ago(50).isoformat()]
    assert body["carriers"] == [{"code": "AI", "samples": 1, "median_minor": 1000}]
    assert body["by_days_out"] == [{"bucket": "22-45", "median_minor": 1000, "samples": 1}]


async def test_empty_route_has_no_family(client, airports):
    await signup(client)
    await add([1000], origin="BOM", destination="DEL")  # the reverse direction is another route
    body = await intel(client)
    assert body == {
        "origin": "DEL",
        "destination": "BOM",
        "cabin": "economy",
        "currency": "INR",
        "family": None,
        "daily": [],
        "by_days_out": [],
        "carriers": [],
        "your_searches": [],
        "updated_at": None,
    }


async def _log_search(agency: str, created_at: datetime, **fields) -> None:
    row = {
        "origin": "DEL",
        "destination": "BOM",
        "adults": 1,
        "children": 0,
        "cabin": "economy",
        "currency": "INR",
        "cheapest": 10000,
        "return_date": None,
    } | fields
    await exec_as_tenant(
        agency,
        "INSERT INTO flight_searches (id, agency_id, origin, destination, departure_date, "
        "return_date, adults, children, cabin, offer_count, display_currency, cheapest_minor, "
        "created_at) VALUES (gen_random_uuid(), :agency, :origin, :destination, :departure, "
        ":return_date, :adults, :children, :cabin, 3, :currency, :cheapest, :created_at)",
        row
        | {
            "agency": agency,
            "departure": TODAY + timedelta(days=20),
            "created_at": created_at,
        },
    )


async def test_your_searches_are_the_agencys_latest_per_traveller_fares(client, app, airports):
    await signup(client)
    agency = (await client.get("/api/v1/agency")).json()["id"]
    base = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
    await _log_search(agency, base, adults=2, cheapest=10001)  # 5000.5 → 5001 per traveller
    await _log_search(agency, base + timedelta(hours=1), adults=3, cheapest=30000)
    await _log_search(agency, base + timedelta(hours=2), children=1)  # not adults-only
    await _log_search(agency, base + timedelta(hours=3), currency="USD")  # not DEL's currency
    await _log_search(agency, base + timedelta(hours=4), cheapest=None)  # nothing found
    await _log_search(agency, base + timedelta(hours=5), cabin="business")  # other cabin
    await _log_search(agency, base + timedelta(hours=6), destination="GOI")  # other route
    # A return search prices the round trip: not comparable with one-way fare history.
    await _log_search(
        agency, base + timedelta(hours=6, minutes=30), return_date=TODAY + timedelta(days=25)
    )
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        beta = (await other.get("/api/v1/agency")).json()["id"]
        await _log_search(beta, base + timedelta(hours=7))
        theirs = (await intel(other))["your_searches"]
        assert [
            (datetime.fromisoformat(s["created_at"]), s["cheapest_minor"], s["adults"])
            for s in theirs
        ] == [(base + timedelta(hours=7), 10000, 1)]
    body = await intel(client)
    assert [
        (datetime.fromisoformat(s["created_at"]), s["cheapest_minor"], s["adults"])
        for s in body["your_searches"]
    ] == [(base + timedelta(hours=1), 10000, 3), (base, 5001, 2)]
    assert body["family"] is None  # searches alone are not fare history


async def test_your_searches_keep_the_latest_twenty(client, airports):
    await signup(client)
    agency = (await client.get("/api/v1/agency")).json()["id"]
    base = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)
    for i in range(23):
        await _log_search(agency, base + timedelta(minutes=i), cheapest=1000 + i)
    searches = (await intel(client))["your_searches"]
    assert [s["cheapest_minor"] for s in searches] == [1000 + i for i in range(22, 2, -1)]


async def test_route_must_be_two_known_airports(client, airports):
    await signup(client)
    r = await client.get(URL, params={"origin": "DEL", "destination": "XXX"})
    assert (r.status_code, r.json()["detail"]) == (422, "Unknown airport code XXX.")
    r = await client.get(URL, params={"origin": "del", "destination": "DEL"})
    assert (r.status_code, r.json()["detail"]) == (
        422,
        "Origin and destination must be different airports.",
    )
    assert (await client.get(URL, params={"origin": "DEL"})).status_code == 422
    r = await client.get(URL, params={"origin": "DEL", "destination": "BOM", "cabin": "luxury"})
    assert r.status_code == 422
    lower = await client.get(URL, params={"origin": " del", "destination": "bom"})
    assert lower.status_code == 200 and lower.json()["origin"] == "DEL"


async def test_route_intel_needs_a_session(app, airports):
    async with make_client(app) as anonymous:
        r = await anonymous.get(URL, params={"origin": "DEL", "destination": "BOM"})
        assert r.status_code == 401
