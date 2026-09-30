from datetime import date, timedelta

from tests.helpers import make_client, signup

KEYS = [
    "open_enquiries",
    "quotes_sent",
    "win_rate",
    "pipeline_value",
    "response_time",
    "co2_quoted",
    "searches",
]


async def _kpis(client, range_=None):
    params = {"range": range_} if range_ else None
    r = await client.get("/api/v1/dashboard/summary", params=params)
    assert r.status_code == 200
    return r.json(), {k["key"]: k for k in r.json()["kpis"]}


async def test_summary_values(seeded):  # seeded = (client, agency_id, now) fixture from fixtures.py
    client, _, _ = seeded
    kpis = {
        k["key"]: k
        for k in (await client.get("/api/v1/dashboard/summary", params={"range": "30d"})).json()[
            "kpis"
        ]
    }
    assert list(kpis) == KEYS
    assert kpis["open_enquiries"]["value"] == 3
    assert kpis["quotes_sent"]["value"] == 2
    assert kpis["win_rate"]["value"] == 50.0
    assert kpis["pipeline_value"]["value"] == 600000 and kpis["pipeline_value"]["unit"] == "money"
    assert len(kpis["searches"]["series"]) == 30


async def test_summary_details_30d(seeded):
    client, _, _ = seeded
    body, kpis = await _kpis(client, "30d")
    assert body["range"] == "30d" and body["currency"] == "INR"
    units = {k: kpis[k]["unit"] for k in KEYS}
    assert units == {
        "open_enquiries": "count",
        "quotes_sent": "count",
        "win_rate": "percent",
        "pipeline_value": "money",
        "response_time": "minutes",
        "co2_quoted": "kg",
        "searches": "count",
    }
    assert all(kpis[k]["label"] for k in KEYS)
    # Everything in the fixture is under 30 days old, so the previous period is empty.
    previous = {k: kpis[k]["previous"] for k in KEYS}
    assert previous == {
        "open_enquiries": 0,
        "quotes_sent": 0,
        "win_rate": None,
        "pipeline_value": None,
        "response_time": None,
        "co2_quoted": None,  # no option quoted before the range carried CO2
        "searches": 0,
    }
    # E-0003 first quoted after 180 min, E-0004 after 60 min.
    assert kpis["response_time"]["value"] == 120.0
    # Q-0001: 100 kg x 1 traveller (its second option has no CO2); Q-0003: 150 kg x 3.
    assert kpis["co2_quoted"]["value"] == 550
    # 13 flight searches + 1 hotel search (which has no supplier row but is still a search).
    assert kpis["searches"]["value"] == 14
    for key in KEYS:
        series = kpis[key]["series"]
        assert len(series) == 30
        days = [date.fromisoformat(point["date"]) for point in series]
        assert days == [days[0] + timedelta(days=i) for i in range(30)]
    sums = {k: sum(p["value"] for p in kpis[k]["series"]) for k in KEYS}
    assert sums["open_enquiries"] == 5  # enquiries created per day
    assert sums["quotes_sent"] == 2
    assert sums["win_rate"] == 1  # closed-won per day
    assert sums["pipeline_value"] == 1400000  # Q-0001 and Q-0003 on the days first sent
    assert sums["co2_quoted"] == 550
    assert sums["searches"] == 14
    assert sorted(p["value"] for p in kpis["response_time"]["series"] if p["value"]) == [60, 180]


async def test_summary_7d_compares_with_the_week_before(seeded):
    client, _, _ = seeded
    _, kpis = await _kpis(client, "7d")
    assert len(kpis["searches"]["series"]) == 7
    # As of the range start only E-0001 was open (E-0004/E-0005 closed 8 and 9 days ago).
    assert (kpis["open_enquiries"]["value"], kpis["open_enquiries"]["previous"]) == (3, 1)
    assert (kpis["quotes_sent"]["value"], kpis["quotes_sent"]["previous"]) == (1, 1)
    assert (kpis["win_rate"]["value"], kpis["win_rate"]["previous"]) == (None, 50.0)
    assert (kpis["response_time"]["value"], kpis["response_time"]["previous"]) == (180.0, 60.0)
    assert (kpis["co2_quoted"]["value"], kpis["co2_quoted"]["previous"]) == (100, 450)
    # Last 7 days: 4 DEL-BOM, 2 BOM-DEL and the hotel search; the week before: 3 searches.
    assert (kpis["searches"]["value"], kpis["searches"]["previous"]) == (7, 3)


async def test_summary_range_is_validated(seeded):
    client, _, _ = seeded
    bad = await client.get("/api/v1/dashboard/summary", params={"range": "1y"})
    assert bad.status_code == 422
    assert (await client.get("/api/v1/dashboard/summary")).json()["range"] == "30d"


async def test_empty_agency_dashboard(client):
    await signup(client)
    body = (await client.get("/api/v1/dashboard/summary")).json()
    values = {k["key"]: k["value"] for k in body["kpis"]}
    assert values == {
        "open_enquiries": 0,
        "quotes_sent": 0,
        "win_rate": None,
        "pipeline_value": 0,
        "response_time": None,
        "co2_quoted": None,  # nothing quoted with CO2: unknown, not zero
        "searches": 0,
    }
    co2 = next(k for k in body["kpis"] if k["key"] == "co2_quoted")
    assert co2["previous"] is None and all(p["value"] == 0 for p in co2["series"])
    for path in ("pipeline", "activity", "market-pulse", "supplier-health", "team", "departures"):
        assert (await client.get(f"/api/v1/dashboard/{path}")).status_code == 200


async def test_dashboard_requires_sign_in(client):
    for path in ("dashboard/summary", "dashboard/pipeline", "notifications", "onboarding"):
        assert (await client.get(f"/api/v1/{path}")).status_code == 401
    assert (await client.get("/api/v1/search", params={"q": "abc"})).status_code == 401


async def test_dashboard_counts_only_own_agency(seeded, app):
    _, _, _ = seeded
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        values = {
            k["key"]: k["value"]
            for k in (await other.get("/api/v1/dashboard/summary")).json()["kpis"]
        }
        assert values["open_enquiries"] == 0 and values["searches"] == 0
        assert (await other.get("/api/v1/dashboard/activity")).json()["items"] == []
        assert (await other.get("/api/v1/search", params={"q": "E-0001"})).json()["enquiries"] == []
        assert (await other.get("/api/v1/dashboard/market-pulse")).json()["routes"] == []
        assert (await other.get("/api/v1/dashboard/supplier-health")).json()["suppliers"] == []
        stages = (await other.get("/api/v1/dashboard/pipeline")).json()["stages"]
        assert all(s["count"] == 0 for s in stages)
        assert (await other.get("/api/v1/dashboard/departures")).json()["items"] == []
