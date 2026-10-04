"""A short-lived, per-process cache of signed-in sessions: token hash → the signed-in user.

Every authenticated request used to look its session up in Postgres (a transaction and a join)
before doing any work of its own. This cache answers repeat requests from memory.

What is cached, and for how long:
- Only sessions that resolved to an active user. An unknown, revoked or expired token always goes
  to the database, so a stream of bad tokens can't fill the cache.
- Keyed by the token's SHA-256 (what the `sessions` table stores); the raw token is never kept.
- An entry lives `SESSION_CACHE_TTL_SECONDS` (30 s) at most, and never past the session's own
  `expires_at`. While the eviction listener isn't subscribed (starting up, or Redis away), other
  processes' evictions can't arrive, so entries stored meanwhile live only
  `SESSION_CACHE_UNSUBSCRIBED_TTL_SECONDS` (5 s). The cache holds at most
  `SESSION_CACHE_MAX_ENTRIES` entries (least recently used goes first).

Revocation:
- Logout (and leaving a demo, which is a logout) evicts the token in this process at once, then
  publishes `token:<hash>` on `EVICT_CHANNEL`. Every API process runs `listen_for_evictions`
  (started in the app's lifespan), which applies what is published, so the other processes
  drop the entry within a Redis round trip.
- Deleting expired demo agencies evicts every session of those agencies the same way, one
  message per committed batch (`agency:<id>,<id>,...`; a `user` message may list several ids
  too). A run stops publishing after its first failed publish.
- Signing in, or accepting an invitation, in a browser that already holds a live session revokes
  that session (`token:<hash>`): the browser drops its cookie, and the session must not live on.
- The app has no endpoint that changes a user's role, deactivates a user, deletes one, or
  changes their profile (email, full name: the cached value carries both). Any such change added
  later must call `evict_and_publish(redis, "user", str(user_id))` (`evict_user` here and
  `user:<id>` for the others) after its commit.
- Staleness that remains, documented and accepted: when Redis is unreachable a publish is lost
  (logged as `session_eviction_unpublished`), and other processes may serve the revoked session
  until their entry lapses, 30 s at most. A listener that (re)connects clears its cache, because
  it may have missed evictions while it was away. A session revoked by hand in the database
  (no publish) is also honoured within 30 s.
- The listener never gives up: any error (not only a Redis one) is logged and retried with an
  exponential backoff capped at `LISTENER_BACKOFF_MAX_S` (5 s); a subscription that just ends
  is retried the same way. Its connection pings Redis every `LISTENER_HEALTH_CHECK_S` (15 s)
  while idle, so a dead connection is noticed.
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
SESSION_CACHE_UNSUBSCRIBED_TTL_SECONDS = 5.0
SESSION_CACHE_MAX_ENTRIES = 10_000
EVICT_CHANNEL = "tm:auth:evict"
PUBLISH_TIMEOUT_SECONDS = 0.5
LISTENER_BACKOFF_FIRST_S = 0.5
LISTENER_BACKOFF_MAX_S = 5.0
LISTENER_HEALTH_CHECK_S = 15.0
# A subscription that lasted this long was healthy: the next retry starts from the first delay.
LISTENER_STABLE_S = 30.0

EvictionKind = Literal["token", "user", "agency"]


@dataclass(frozen=True, slots=True)
class _Entry[T]:
    value: T
    user_id: UUID
    agency_id: UUID
    deadline: float  # on the cache's monotonic clock


class SessionCache[T]:
    """Token hash → value, with a TTL, an LRU bound and evictions by token, user or agency.

    `listening` is set by the eviction listener while it is subscribed; until then new entries
    get the short `unsubscribed_ttl_s`."""

    def __init__(
        self,
        *,
        ttl_s: float = SESSION_CACHE_TTL_SECONDS,
        unsubscribed_ttl_s: float = SESSION_CACHE_UNSUBSCRIBED_TTL_SECONDS,
        max_entries: int = SESSION_CACHE_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_s
        self._unsubscribed_ttl = min(ttl_s, unsubscribed_ttl_s)
        self._max = max_entries
        self._clock = clock
        self._entries: OrderedDict[str, _Entry[T]] = OrderedDict()
        self.generation = 0
        self.listening = False

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
        ttl = self._ttl if self.listening else self._unsubscribed_ttl
        self._entries[token_hash] = _Entry(value, user_id, agency_id, now + min(ttl, left))
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
        """Apply a published eviction (`token:<hash>`, `user:<id>[,<id>...]` or
        `agency:<id>[,<id>...]`); anything else is ignored."""
        kind, _, value = message.partition(":")
        try:
            if kind == "token" and value:
                self.evict_token(value)
            elif kind in ("user", "agency"):
                ids = {UUID(part) for part in value.split(",")}
                self.generation += 1
                if kind == "user":
                    self._drop(lambda entry: entry.user_id in ids)
                else:
                    self._drop(lambda entry: entry.agency_id in ids)
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


async def publish_eviction(redis: Redis, kind: EvictionKind, value: str) -> bool:
    """Tell the other processes to evict; True once published. Never raises: a failure is
    logged, and the other processes' entries then lapse on their TTL."""
    try:
        async with asyncio.timeout(PUBLISH_TIMEOUT_SECONDS):
            await redis.publish(EVICT_CHANNEL, f"{kind}:{value}")
    except (RedisError, OSError) as exc:  # a missed deadline is a TimeoutError, an OSError
        log.warning("session_eviction_unpublished", kind=kind, error_type=type(exc).__name__)
        return False
    return True


async def evict_and_publish(redis: Redis, kind: EvictionKind, value: str) -> None:
    """Evict here at once, then publish for the other processes. Call after the commit."""
    session_cache().apply(f"{kind}:{value}")
    await publish_eviction(redis, kind, value)


def listener_backoff(attempt: int) -> float:
    """The pause before the listener's `attempt`-th retry in a row (0 first): doubling from
    `LISTENER_BACKOFF_FIRST_S`, at most `LISTENER_BACKOFF_MAX_S`."""
    return float(min(LISTENER_BACKOFF_MAX_S, LISTENER_BACKOFF_FIRST_S * 2 ** min(attempt, 16)))


async def listen_for_evictions(*, ready: asyncio.Event | None = None) -> None:
    """Apply published evictions to this process's cache until cancelled.

    Uses its own connection (not the shared pool: a subscription holds its connection for
    good), pinged while idle. On every (re)subscribe it clears the cache, since evictions
    published while it was away were missed, and marks the cache `listening` until the
    subscription ends. Any error, or the subscription ending, is logged and retried after
    `listener_backoff`. Sets `ready` once subscribed (tests)."""
    loop = asyncio.get_running_loop()
    attempt = 0
    while True:
        settings = get_settings()
        client = Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=settings.redis_socket_timeout_s,
            health_check_interval=LISTENER_HEALTH_CHECK_S,
        )
        subscribed_at: float | None = None
        reason = "subscription_ended"
        try:
            async with client.pubsub(ignore_subscribe_messages=True) as pubsub:
                await pubsub.subscribe(EVICT_CHANNEL)
                cache = session_cache()
                cache.clear()
                cache.listening = True
                subscribed_at = loop.time()
                if ready is not None:
                    ready.set()
                while pubsub.subscribed:
                    # A bounded wait, so the connection's health check runs while idle.
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=LISTENER_HEALTH_CHECK_S
                    )
                    data = message.get("data") if message else None
                    if isinstance(data, bytes):
                        session_cache().apply(data.decode(errors="replace"))
        except Exception as exc:  # never die: the cache would serve revoked sessions for good
            reason = type(exc).__name__
        finally:
            session_cache().listening = False
            with contextlib.suppress(Exception):
                await client.aclose()
        if subscribed_at is not None and loop.time() - subscribed_at >= LISTENER_STABLE_S:
            attempt = 0
        delay = listener_backoff(attempt)
        attempt += 1
        log.warning("session_eviction_listener_down", error_type=reason, retry_in_s=delay)
        await asyncio.sleep(delay)
