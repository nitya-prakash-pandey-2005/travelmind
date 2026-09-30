from tests.helpers import run_as_owner


async def _snapshot(origin: str, destination: str, provenance: str) -> None:
    await run_as_owner(
        """
        INSERT INTO fare_snapshots (origin, destination, departure_date, days_to_departure,
                                    cabin, total_minor, currency, provenance, source)
        VALUES (:o, :d, current_date + 30, 30, 'economy', 500000, 'INR', :p, 'test')
        """,
        {"o": origin, "d": destination, "p": provenance},
    )


async def test_facts_count_market_routes_and_connected_suppliers(client, airports):
    for origin, destination, provenance in [
        ("DEL", "BOM", "LIVE"),
        ("DEL", "BOM", "CACHED"),
        ("BOM", "GOI", "CACHED"),
        ("DEL", "GOI", "SANDBOX"),
    ]:
        await _snapshot(origin, destination, provenance)
    body = (await client.get("/api/v1/platform/facts")).json()
    assert body["routes_with_history"] == 2
    kinds = {s["kind"]: s["connected"] for s in body["suppliers"]}
    # Tests run with the sandbox on and every real key blanked.
    assert kinds["flights"] == 1 and kinds["hotels"] == 0


async def test_facts_are_cached_for_five_minutes(client, airports):
    from redis.asyncio import Redis

    from travelmind.config import get_settings

    first = (await client.get("/api/v1/platform/facts")).json()
    await _snapshot("DEL", "BOM", "LIVE")
    assert (await client.get("/api/v1/platform/facts")).json() == first
    redis = Redis.from_url(get_settings().redis_url)
    try:
        assert 0 < await redis.ttl("platform:facts") <= 300
        await redis.delete("platform:facts")
    finally:
        await redis.aclose()
    assert (await client.get("/api/v1/platform/facts")).json()["routes_with_history"] == 1
