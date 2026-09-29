from tests.helpers import on_event_loop, signup
from travelmind.reference.search import AirportIndex

URL = "/api/v1/reference/airports"


async def test_search_requires_sign_in(client, reference_data):
    r = await client.get(URL, params={"q": "delhi"})
    assert r.status_code == 401


async def test_search_returns_ranked_airports(client, reference_data):
    await signup(client)
    r = await client.get(URL, params={"q": "delhi"})
    assert r.status_code == 200
    first = r.json()[0]
    assert first["iata_code"] == "DEL"
    assert first["country_name"] == "India"
    assert first["city"] == "New Delhi"
    assert isinstance(first["latitude"], float)


async def test_goa_query_returns_indian_airports_first(client, reference_data):
    await signup(client)
    r = await client.get(URL, params={"q": "Goa", "limit": 2})
    assert [a["iata_code"] for a in r.json()] == ["GOI", "GOX"]


async def test_query_validation(client, reference_data):
    await signup(client)
    assert (await client.get(URL, params={"q": "d"})).status_code == 422
    assert (await client.get(URL, params={"q": "delhi", "limit": 100})).status_code == 422


async def test_airport_search_runs_off_the_event_loop(client, reference_data, monkeypatch):
    calls: list[bool] = []
    real_search = AirportIndex.search

    def recording_search(self, query, limit=8):
        calls.append(on_event_loop())
        return real_search(self, query, limit)

    monkeypatch.setattr(AirportIndex, "search", recording_search)
    await signup(client)
    r = await client.get(URL, params={"q": "delhi"})
    assert r.status_code == 200
    assert calls == [False]
