"""Outbound calls for the place and weather tools: shared clients, guards, metrics and caching.

Each feed has its own shared httpx client and supplier guard (`open_meteo`, `nominatim`,
`overpass`, `opentripmap`: the metrics labels too). A failure of any kind (circuit open, timeout,
HTTP error, unreadable JSON) becomes ToolError("unavailable") with our own message; neither the
URL (OpenTripMap's carries its key) nor the feed's text is logged or passed on.

Answers are cached in Redis (`tm:agent:...`) as the parsed, trimmed data; Redis being down only
costs the cache.
"""

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.agent.tools.base import ToolError
from travelmind.config import Settings
from travelmind.http import get_http_client
from travelmind.metrics import supplier_call
from travelmind.resilience import CircuitOpen, guard_for

log = structlog.get_logger()

PRODUCT = "TravelMind/1.0"
TIMEOUT = httpx.Timeout(8.0, connect=3.0)
DAY_S = 24 * 3600
CACHE_PREFIX = "tm:agent:"


def user_agent(settings: Settings) -> str:
    """An identifiable client, as the OpenStreetMap usage policies ask: the product, plus the
    deployment's contact (TM_OSM_CONTACT) when one is set."""
    contact = " ".join(settings.osm_contact.split())[:120]
    return f"{PRODUCT} (+{contact})" if contact else PRODUCT


async def fetch_json(
    supplier: str,
    method: str,
    url: str,
    *,
    unavailable: str,
    deadline_s: float,
    params: dict[str, str] | None = None,
    data: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    """One guarded, timed call; the decoded JSON body, or ToolError("unavailable", unavailable)."""
    try:
        async with guard_for(supplier).call():  # outside the deadline: a timeout is a failure
            with supplier_call(supplier):
                async with asyncio.timeout(deadline_s):
                    client = get_http_client(f"agent-{supplier}", timeout=TIMEOUT)
                    response = await client.request(
                        method, url, params=params, data=data, headers=headers, timeout=TIMEOUT
                    )
                response.raise_for_status()
                return response.json()
    except CircuitOpen as exc:
        log.info("agent_feed_skipped", supplier=supplier, reason=exc.reason)
    except (httpx.HTTPError, TimeoutError, ValueError) as exc:
        status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        log.warning(
            "agent_feed_failed", supplier=supplier, error_type=type(exc).__name__, status=status
        )
    raise ToolError("unavailable", unavailable)


def cache_key(*parts: object) -> str:
    """A cache key from parts; free text is hashed, so a key never carries a user's words."""
    text = ":".join(str(p) for p in parts)
    if len(text) <= 120 and text.isascii() and " " not in text:
        return CACHE_PREFIX + text
    return CACHE_PREFIX + hashlib.sha256(text.encode()).hexdigest()


async def cached[T](
    redis: Redis,
    key: str,
    ttl_s: int,
    load: Callable[[], Awaitable[T]],
) -> T:
    """`load()`'s JSON-safe value, read through Redis for `ttl_s`."""
    try:
        raw = await redis.get(key)
        if raw is not None:
            value: T = json.loads(raw)
            return value
    except (RedisError, ValueError) as exc:
        log.warning("agent_cache_unavailable", error_type=type(exc).__name__)
    value = await load()
    try:
        await redis.set(key, json.dumps(value), ex=ttl_s)
    except RedisError as exc:
        log.warning("agent_cache_unavailable", error_type=type(exc).__name__)
    return value


class Throttle:
    """At most one call per `interval_s` across every process (a Redis key taken with SET NX),
    falling back to this process alone when Redis is down. Callers wait up to `wait_s` for
    their turn, then get ToolError("unavailable")."""

    def __init__(self, key: str, interval_s: float, wait_s: float, busy: str) -> None:
        self.key = key
        self.interval_ms = int(interval_s * 1000)
        self.wait_s = wait_s
        self.busy = busy
        self._lock = asyncio.Lock()
        self._last = 0.0

    async def turn(self, redis: Redis) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.wait_s
        while True:
            try:
                if await redis.set(self.key, "1", nx=True, px=self.interval_ms):
                    return
            except RedisError:
                await self._local_turn(deadline)
                return
            if loop.time() >= deadline:
                raise ToolError("unavailable", self.busy)
            await asyncio.sleep(0.2)

    async def _local_turn(self, deadline: float) -> None:
        loop = asyncio.get_running_loop()
        async with self._lock:
            wait = self._last + self.interval_ms / 1000 - loop.time()
            if loop.time() + max(wait, 0) > deadline:
                raise ToolError("unavailable", self.busy)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = loop.time()
