"""Cached JSON reads are served as the stored bytes: a hit is never decoded and re-serialised.

The bytes must be exactly what FastAPI would have produced from the model, and an entry written
for another shape of the response (an older release) must never be served, so these entries are
keyed by a fingerprint of the response schema.
"""

import os
from typing import Any

import pytest
from pydantic import BaseModel, TypeAdapter
from redis.asyncio import Redis

from tests.helpers import signup
from travelmind.dashboard.schemas import Kpi, PipelineOut, SummaryOut
from travelmind.readcache import schema_tag
from travelmind.reference.router import AirportOut


@pytest.fixture
async def redis():
    client = Redis.from_url(os.environ["TM_REDIS_URL"])
    yield client
    await client.aclose()


def as_fastapi_would(tp: Any, body: bytes) -> bytes:
    adapter = TypeAdapter(tp)
    return adapter.dump_json(adapter.validate_json(body), by_alias=True)


@pytest.mark.parametrize(
    ("path", "tp", "name", "stored"),
    [
        # The summary stores its cached cards; the live searches card is added around them.
        ("/api/v1/dashboard/summary", SummaryOut, "summary", list[Kpi]),
        ("/api/v1/dashboard/pipeline", PipelineOut, "pipeline", PipelineOut),
        ("/api/v1/reference/airports?q=del", list[AirportOut], "airports", list[AirportOut]),
    ],
)
async def test_hits_serve_the_stored_bytes(client, airports, redis, path, tp, name, stored):
    await signup(client)
    miss = await client.get(path)
    hit = await client.get(path)
    assert miss.status_code == hit.status_code == 200
    assert hit.headers["content-type"] == miss.headers["content-type"] == "application/json"
    assert hit.content == miss.content == as_fastapi_would(tp, miss.content)
    keys = [k.decode() for k in await redis.keys(f"tm:rc:*{name}*")]
    assert keys and all(schema_tag(stored) in k for k in keys), keys


def test_the_schema_tag_follows_the_shape():
    class Before(BaseModel):
        a: int

    class After(BaseModel):
        a: int
        b: str = ""

    assert schema_tag(Before) != schema_tag(After)
    assert schema_tag(Before) == schema_tag(Before)  # stable across calls (and processes)
    assert len(schema_tag(SummaryOut)) == 8
