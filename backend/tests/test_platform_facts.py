async def test_platform_facts_are_public_and_tenant_free(client, airports):
    body = (await client.get("/api/v1/platform/facts")).json()
    assert body["airports"] >= 6 and {s["kind"] for s in body["suppliers"]} >= {"flights", "hotels"}
    assert set(body) == {"airports", "suppliers", "routes_with_history"}
