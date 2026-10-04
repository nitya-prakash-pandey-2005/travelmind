"""The per-agency offer store: what a search returned, kept compact and bounded per agency, for
price checks and quote versions."""

import os
import zlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from redis.asyncio import Redis
from structlog.testing import capture_logs

from tests.offers.offer_factory import make_offer
from travelmind.offers import cache as offer_store
from travelmind.offers.cache import offer_key, recall_offer, remember_offers


@pytest.fixture
async def redis():
    client = Redis.from_url(os.environ["TM_REDIS_URL"])
    yield client
    await client.aclose()


def offer(ref: str, *, minutes: int = 30, **overrides):  # type: ignore[no-untyped-def]
    return make_offer(
        [
            ("DEL", "BOM", "ZZ", "1", "2026-11-20T06:00"),
            ("BOM", "GOI", "ZZ", "2", "2026-11-20T10:00"),
        ],
        offer_ref=ref,
        expires_at=datetime.now(UTC) + timedelta(minutes=minutes),
        **overrides,
    )


async def test_an_offer_comes_back_exactly(redis):
    agency = uuid4()
    original = offer("exact", owner_name=None, co2_kg_per_passenger=91, co2_source="supplier")
    await remember_offers(redis, agency, [original])
    back = await recall_offer(redis, agency, original.id)
    assert back == original
    assert (
        back is not None
        and back.stops == 1
        and back.total_duration_minutes == original.total_duration_minutes
    )


async def test_offers_are_stored_compressed(redis):
    agency = uuid4()
    original = offer("small")
    await remember_offers(redis, agency, [original])
    raw = await redis.get(offer_key(agency, original.id))
    assert raw is not None and not raw.startswith(b"{")
    assert len(raw) < len(original.model_dump_json()) / 2
    assert zlib.decompress(raw).startswith(b"{")


async def test_nulls_are_stored_so_no_default_can_replace_them(redis):
    """Fields left out of an entry would come back as their defaults, so a None is stored as
    null rather than trusted to every field defaulting to None (zlib squeezes the nulls)."""
    agency = uuid4()
    original = offer("nulls", owner_name=None)
    await remember_offers(redis, agency, [original])
    raw = await redis.get(offer_key(agency, original.id))
    assert b'"owner_name":null' in zlib.decompress(raw)


async def test_an_entry_written_as_plain_json_is_still_read(redis):
    """Entries written before the compact encoding (plain JSON under the raw id, during a
    rolling deploy) stay readable."""
    agency = uuid4()
    original = offer("legacy")
    await redis.set(f"offer:{agency}:{original.id}", original.model_dump_json(), ex=600)
    assert await recall_offer(redis, agency, original.id) == original


async def test_an_unreadable_entry_counts_as_gone(redis):
    agency = uuid4()
    await redis.set(f"offer:{agency}:stub~bad", b"\x78\x9cnot-zlib", ex=600)
    assert await recall_offer(redis, agency, "stub~bad") is None


async def test_an_offer_lives_as_long_as_the_supplier_sells_it(redis):
    agency = uuid4()
    original = offer("ttl", minutes=10)
    await remember_offers(redis, agency, [original])
    assert 590 <= await redis.ttl(offer_key(agency, original.id)) <= 600


async def _recallable(redis, agency, offers) -> list[str]:  # type: ignore[no-untyped-def]
    return [o.id for o in offers if await recall_offer(redis, agency, o.id) is not None]


async def test_each_agency_keeps_at_most_its_cap_dropping_the_oldest_stored(redis, monkeypatch):
    monkeypatch.setattr(offer_store, "max_offers_per_agency", lambda: 3)
    agency, other = uuid4(), uuid4()
    first = [offer("a", minutes=5), offer("b", minutes=6)]
    later = [offer("c", minutes=30), offer("d", minutes=31), offer("e", minutes=32)]
    await remember_offers(redis, agency, first)
    await remember_offers(redis, other, first)
    await remember_offers(redis, agency, later)
    assert await _recallable(redis, agency, first + later) == [o.id for o in later]
    assert await redis.zcard(f"offers:idx:{agency}") == 3
    assert await redis.zcard(f"offers:exp:{agency}") == 3
    # Another agency's offers are never touched by this one's cap.
    assert [await recall_offer(redis, other, o.id) for o in first] == first
    assert 1790 <= await redis.ttl(f"offers:idx:{agency}") <= 1920
    assert 1790 <= await redis.ttl(f"offers:exp:{agency}") <= 1920


async def test_the_cap_never_drops_the_search_being_stored(redis, monkeypatch):
    """At the cap, a new search whose offers expire sooner than the stored ones keeps every one
    of its offers (its price checks and quote versions need them); the offers stored longest
    ago go instead, however long they would still live."""
    monkeypatch.setattr(offer_store, "max_offers_per_agency", lambda: 3)
    agency = uuid4()
    stored = [offer("a", minutes=110), offer("b", minutes=100), offer("c", minutes=90)]
    for each in stored:  # three searches, oldest first
        await remember_offers(redis, agency, [each])
    fresh = [offer("d", minutes=5), offer("e", minutes=6)]
    await remember_offers(redis, agency, fresh)
    assert await _recallable(redis, agency, fresh) == [o.id for o in fresh]
    assert await _recallable(redis, agency, stored) == [stored[2].id]
    assert await redis.zcard(f"offers:idx:{agency}") == 3


async def test_a_search_bigger_than_the_cap_is_kept_whole(redis, monkeypatch):
    monkeypatch.setattr(offer_store, "max_offers_per_agency", lambda: 2)
    agency = uuid4()
    old = offer("old", minutes=60)
    await remember_offers(redis, agency, [old])
    big = [offer(ref, minutes=5) for ref in ("p", "q", "r")]
    await remember_offers(redis, agency, big)
    assert await _recallable(redis, agency, big) == [o.id for o in big]
    assert await recall_offer(redis, agency, old.id) is None


async def test_expired_offers_leave_the_index_and_free_their_place(redis, monkeypatch):
    """An offer past its expiry no longer counts against the cap (its entry lapsed already)."""
    monkeypatch.setattr(offer_store, "max_offers_per_agency", lambda: 2)
    agency = uuid4()
    keep = offer("keep", minutes=60)
    await remember_offers(redis, agency, [keep])
    gone = offer_store._digest("stub~gone")
    await redis.zadd(f"offers:idx:{agency}", {gone: 1})
    await redis.zadd(f"offers:exp:{agency}", {gone: 1})  # expired long ago
    fresh = offer("fresh", minutes=30)
    await remember_offers(redis, agency, [fresh])
    assert await _recallable(redis, agency, [keep, fresh]) == [keep.id, fresh.id]
    members = {m.decode() for m in await redis.zrange(f"offers:idx:{agency}", 0, -1)}
    assert gone not in members and len(members) == 2
    assert await redis.zscore(f"offers:exp:{agency}", gone) is None


async def test_the_index_is_scored_by_redis_time(redis):
    agency = uuid4()
    await remember_offers(redis, agency, [offer("t", minutes=10)])
    seconds, micros = await redis.time()
    [(_, inserted)] = await redis.zrange(f"offers:idx:{agency}", 0, -1, withscores=True)
    [(_, expires)] = await redis.zrange(f"offers:exp:{agency}", 0, -1, withscores=True)
    now_us = seconds * 1_000_000 + micros
    assert now_us - 5_000_000 <= inserted <= now_us
    assert seconds + 590 <= expires <= seconds + 600


async def test_storing_the_same_offer_again_does_not_count_twice(redis, monkeypatch):
    monkeypatch.setattr(offer_store, "max_offers_per_agency", lambda: 2)
    agency = uuid4()
    a, b = offer("a"), offer("b")
    await remember_offers(redis, agency, [a, b])
    await remember_offers(redis, agency, [a])  # a price check stores the fresh offer again
    assert await recall_offer(redis, agency, a.id) == a
    assert await recall_offer(redis, agency, b.id) == b


async def test_a_failing_store_is_logged_not_raised():
    down = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.1)
    try:
        with capture_logs() as logs:
            await remember_offers(down, uuid4(), [offer("x")])
            assert await recall_offer(down, uuid4(), "stub~x") is None
    finally:
        await down.aclose()
    assert [entry["event"] for entry in logs] == ["offer_cache_unavailable"] * 2


async def test_keys_stay_short_whatever_the_supplier_id(redis):
    agency = uuid4()
    original = offer("x" * 400)
    await remember_offers(redis, agency, [original])
    keys = [k.decode() for k in await redis.keys(f"offer*{agency}*")]
    expected = [
        len(f"offer:{agency}:") + 22,
        len(f"offers:idx:{agency}"),
        len(f"offers:exp:{agency}"),
    ]
    assert sorted(len(k) for k in keys) == sorted(expected)
    members = await redis.zrange(f"offers:idx:{agency}", 0, -1)
    assert [len(m) for m in members] == [22]
    assert await recall_offer(redis, agency, original.id) == original


async def test_an_entry_under_a_colliding_key_is_not_another_offer(redis):
    agency = uuid4()
    original = offer("real")
    stored = zlib.compress(original.model_dump_json().encode())
    await redis.set(offer_key(agency, "stub~other"), stored)
    assert await recall_offer(redis, agency, "stub~other") is None
