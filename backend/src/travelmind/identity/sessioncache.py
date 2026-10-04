"""A short-lived, per-process cache of signed-in sessions: token hash → the signed-in user.

Every authenticated request used to look its session up in Postgres (a transaction and a join)
before doing any work of its own. This cache answers repeat requests from memory.

What is cached, and for how long:
- Only sessions that resolved to an active user. An unknown, revoked or expired token always goes
  to the database, so a stream of bad tokens can't fill the cache.
- Keyed by the token's SHA-256 (what the `sessions` table stores); the raw token is never kept.
- An entry lives `SESSION_CACHE_TTL_SECONDS` (30 s) at most, and never past the session's own
  `expires_at`. The cache holds at most `SESSION_CACHE_MAX_ENTRIES` entries (least recently used
  goes first).

Revocation:
- Logout (and leaving a demo, which is a logout) evicts the token in this process at once, then
  publishes `token:<hash>` on `EVICT_CHANNEL`. Every API process runs `listen_for_evictions`
  (started in the app's lifespan), which applies what is published, so the other processes
  drop the entry within a Redis round trip.
- Deleting expired demo agencies evicts every session of those agencies (`agency:<id>`) the same
  way.
- The app has no endpoint that changes a user's role, deactivates a user or deletes one. Any that
  is added must call `evict_user` and publish `user:<id>` after its commit.
- Staleness that remains, documented and accepted: when Redis is unreachable a publish is lost
  (logged as `session_eviction_unpublished`), and other processes may serve the revoked session
  until their entry lapses, 30 s at most. A listener that (re)connects clears its cache, because
  it may have missed evictions while it was away. A session revoked by hand in the database
  (no publish) is also honoured within 30 s.
- A lookup that read the database before a revocation committed must not store what it read: the
  cache's generation counter moves on every eviction, and `put` is a no-op when it moved since
  the lookup began.
"""

import asyncio
import contextlib
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

from travelmind.config import get_settings

__all__ = [
    "EVICT_CHANNEL",
    "SESSION_CACHE_MAX_ENTRIES",
    "SESSION_CACHE_TTL_SECONDS",
    "SessionCache",
    "evict_and_publish",
    "listen_for_evictions",
    "publish_eviction",
    "reset_session_cache",
    "session_cache",
]

log = structlog.get_logger()

SESSION_CACHE_TTL_SECONDS = 30.0
SESSION_CACHE_MAX_ENTRIES = 10_000
EVICT_CHANNEL = "tm:auth:evict"
PUBLISH_TIMEOUT_SECONDS = 0.5
LISTENER_RETRY_SECONDS = (1.0, 2.0, 5.0, 10.0, 30.0)

EvictionKind = Literal["token", "user", "agency"]


@dataclass(frozen=True, slots=True)
class _Entry[T]:
    value: T
    user_id: UUID
    agency_id: UUID
    deadline: float  # on the cache's monotonic clock


class SessionCache[T]:
    """Token hash → value, with a TTL, an LRU bound and evictions by token, user or agency."""

    def __init__(
        self,
        *,
        ttl_s: float = SESSION_CACHE_TTL_SECONDS,
        max_entries: int = SESSION_CACHE_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_s
        self._max = max_entries
        self._clock = clock
        self._entries: OrderedDict[str, _Entry[T]] = OrderedDict()
        self.generation = 0

    def get(self, token_hash: str) -> T | None:
        entry = self._entries.get(token_hash)
        if entry is None:
            return None
        if entry.deadline <= self._clock():
            del self._entries[token_hash]
            return None
        self._entries.move_to_end(token_hash)
        return entry.value

    def put(
        self,
        token_hash: str,
        value: T,
        *,
        user_id: UUID,
        agency_id: UUID,
        expires_at: datetime,
        generation: int,
    ) -> None:
        """Store a lookup's result, unless an eviction happened since the lookup began (it read
        `generation` first) or the session has already expired."""
        if generation != self.generation:
            return
        now = self._clock()
        left = (expires_at - datetime.now(UTC)).total_seconds()
        if left <= 0:
            return
        self._entries[token_hash] = _Entry(value, user_id, agency_id, now + min(self._ttl, left))
        self._entries.move_to_end(token_hash)
        while len(self._entries) > self._max:
            self._entries.popitem(last=False)

    def evict_token(self, token_hash: str) -> None:
        self.generation += 1
        self._entries.pop(token_hash, None)

    def evict_user(self, user_id: UUID) -> None:
        self.generation += 1
        self._drop(lambda entry: entry.user_id == user_id)

    def evict_agency(self, agency_id: UUID) -> None:
        self.generation += 1
        self._drop(lambda entry: entry.agency_id == agency_id)

    def clear(self) -> None:
        self.generation += 1
        self._entries.clear()

    def apply(self, message: str) -> None:
        """Apply a published eviction (`token:<hash>`, `user:<id>` or `agency:<id>`); anything
        else is ignored."""
        kind, _, value = message.partition(":")
        try:
            if kind == "token" and value:
                self.evict_token(value)
            elif kind == "user":
                self.evict_user(UUID(value))
            elif kind == "agency":
                self.evict_agency(UUID(value))
        except ValueError:
            pass

    def _drop(self, matches: Callable[[_Entry[T]], bool]) -> None:
        for key in [key for key, entry in self._entries.items() if matches(entry)]:
            del self._entries[key]


_cache: SessionCache[object] | None = None


def session_cache() -> SessionCache[object]:
    """The process-wide cache."""
    global _cache
    if _cache is None:
        _cache = SessionCache()
    return _cache


def reset_session_cache() -> None:
    """Forget every entry (tests)."""
    global _cache
    _cache = None


async def publish_eviction(redis: Redis, kind: EvictionKind, value: str) -> None:
    """Tell the other processes to evict. Never raises: a failure is logged, and the other
    processes' entries then lapse on their TTL."""
    try:
        async with asyncio.timeout(PUBLISH_TIMEOUT_SECONDS):
            await redis.publish(EVICT_CHANNEL, f"{kind}:{value}")
    except (RedisError, OSError) as exc:  # a missed deadline is a TimeoutError, an OSError
        log.warning("session_eviction_unpublished", kind=kind, error_type=type(exc).__name__)


async def evict_and_publish(redis: Redis, kind: EvictionKind, value: str) -> None:
    """Evict here at once, then publish for the other processes. Call after the commit."""
    session_cache().apply(f"{kind}:{value}")
    await publish_eviction(redis, kind, value)


async def listen_for_evictions(*, ready: asyncio.Event | None = None) -> None:
    """Apply published evictions to this process's cache until cancelled.

    Uses its own connection (not the shared pool: a subscription holds its connection for
    good). On every (re)subscribe it clears the cache, since evictions published while it was
    away were missed. After an error it retries with a growing pause, and sets `ready` once
    subscribed (tests)."""
    attempt = 0
    while True:
        client = Redis.from_url(
            get_settings().redis_url,
            socket_connect_timeout=get_settings().redis_socket_timeout_s,
        )
        try:
            async with client.pubsub(ignore_subscribe_messages=True) as pubsub:
                await pubsub.subscribe(EVICT_CHANNEL)
                session_cache().clear()
                attempt = 0
                if ready is not None:
                    ready.set()
                async for message in pubsub.listen():
                    data = message.get("data")
                    if isinstance(data, bytes):
                        session_cache().apply(data.decode(errors="replace"))
        except (RedisError, OSError) as exc:
            delay = LISTENER_RETRY_SECONDS[min(attempt, len(LISTENER_RETRY_SECONDS) - 1)]
            attempt += 1
            log.warning(
                "session_eviction_listener_down", error_type=type(exc).__name__, retry_in_s=delay
            )
            await asyncio.sleep(delay)
        finally:
            with contextlib.suppress(RedisError, OSError):
                await client.aclose()
