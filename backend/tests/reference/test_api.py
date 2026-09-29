from tests.helpers import signup

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
