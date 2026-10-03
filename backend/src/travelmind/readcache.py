"""A small Redis read-through cache for hot reads, with per-agency invalidation.

Keys:
- Tenant data lives under `agency_key(agency, version, name, ...)`. The version is a per-agency
  counter (`tm:av:<agency>`), so one `INCR` retires every cached entry of that agency at once;
  old entries simply age out on their TTL. The agency id is in every tenant key, so one agency's
  entry can never be served to another.
- Tenant-free data (the supplier list, airport search, route fare aggregates) uses plain
  `tm:rc:<name>:...` keys.

Redis is an optimisation, never a dependency: any Redis error makes the call fall through to the
loader (logged once per call, with the error type only) and the request still succeeds. A short
`SET NX` lock stops a stampede of identical loads; waiters poll for the value for at most
`LOCK_WAIT_SECONDS` and then load it themselves, so a lock holder that dies never blocks anyone.

Invalidation: a request that changes an agency's data bumps its version after it commits. Routers
that write take the `InvalidatesAgencyCache` dependency, which, once the endpoint has returned and
before the response is sent, bumps:
- the session's bound agency (RLS lets a session write only that agency's rows) on any POST, PUT,
  PATCH or DELETE, and
- every agency a read marked with `mark_agency_changed` (lazy quote expiry, a client's first view
  of a shared quote).
Over-invalidating (say, a write that failed after a partial commit) only costs a cache miss.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from uuid import UUID

import structlog
from fastapi import Depends, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.cache import RedisClient
from travelmind.db import DbSession
from travelmind.metrics import CACHE_REQUESTS

__all__ = [
    "CACHE_PREFIX",
    "LOCK_PREFIX",
    "LOCK_TTL_MS",
    "InvalidatesAgencyCache",
    "agency_key",
    "agency_version",
    "bump_agency_version",
    "cached_json",
    "invalidate_agency",
    "mark_agency_changed",
    "publish_agency_changes",
    "publish_agency_changes_after",
]

log = structlog.get_logger()

CACHE_PREFIX = "tm:rc:"
LOCK_PREFIX = "tm:rcl:"
VERSION_PREFIX = "tm:av:"
LOCK_TTL_MS = 3000  # longer than a normal load; a crashed holder's lock lapses on its own
LOCK_WAIT_SECONDS = 0.25
LOCK_POLL_SECONDS = 0.025
# Agencies' versions go unused once nobody reads them; let them lapse eventually.
VERSION_TTL_SECONDS = 7 * 24 * 3600

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_CHANGED = "tm_changed_agencies"  # AsyncSession.info key

# Redis-py raises RedisError subclasses; a socket can also surface a bare OSError (TimeoutError
# included).
_REDIS_ERRORS = (RedisError, OSError)


def _unavailable(cache: str, exc: BaseException) -> None:
    CACHE_REQUESTS.labels(cache=cache, result="error").inc()
    log.warning("read_cache_unavailable", cache=cache, error_type=type(exc).__name__)


async def cached_json[T](
    redis: Redis,
    key: str,
    ttl_s: int,
    loader: Callable[[], Awaitable[T]],
    *,
    encode: Callable[[T], str],
    decode: Callable[[str | bytes], T],
    cache: str = "other",
) -> T:
    """Read-through cache. Redis failures fall through to the loader (logged once per call);
    a short SET NX lock stops a stampede of identical loads (waiters retry the read for ≤250 ms,
    then load themselves). `cache` is the metrics label: a fixed name, never part of the key."""
    try:
        raw = await redis.get(key)
    except _REDIS_ERRORS as exc:
        _unavailable(cache, exc)
        return await loader()
    if raw is not None:
        cached = _decoded(decode, raw)
        if cached is not None:
            CACHE_REQUESTS.labels(cache=cache, result="hit").inc()
            return cached[0]
    CACHE_REQUESTS.labels(cache=cache, result="miss").inc()
    lock = LOCK_PREFIX + key
    try:
        locked = bool(await redis.set(lock, "1", nx=True, px=LOCK_TTL_MS))
        if not locked:
            waited = await _wait_for(redis, key, decode)
            if waited is not None:
                return waited[0]
    except _REDIS_ERRORS as exc:
        _unavailable(cache, exc)
        return await loader()
    try:
        loaded = await loader()
        try:
            await redis.set(key, encode(loaded), ex=ttl_s)
        except _REDIS_ERRORS as exc:
            _unavailable(cache, exc)
            locked = False  # Redis is gone for this call: don't touch it again
        return loaded
    finally:
        if locked:  # released early on success and on a failed load alike
            with contextlib.suppress(*_REDIS_ERRORS):
                await redis.delete(lock)


def _decoded[T](decode: Callable[[str | bytes], T], raw: str | bytes) -> tuple[T] | None:
    """The decoded entry, or None for one this code can't read (say, written by an older
    release with another shape): it is then reloaded and overwritten."""
    try:
        return (decode(raw),)
    except ValueError:  # json.JSONDecodeError and pydantic.ValidationError are ValueErrors
        return None


async def _wait_for[T](
    redis: Redis, key: str, decode: Callable[[str | bytes], T]
) -> tuple[T] | None:
    """Poll for another caller's load for at most LOCK_WAIT_SECONDS."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + LOCK_WAIT_SECONDS
    while loop.time() < deadline:
        await asyncio.sleep(LOCK_POLL_SECONDS)
        raw = await redis.get(key)
        if raw is not None:
            value = _decoded(decode, raw)
            if value is not None:
                return value
    return None


def agency_key(agency_id: UUID, version: int, name: str, *parts: str) -> str:
    return f"{CACHE_PREFIX}a:{agency_id}:v{version}:{name}:" + ":".join(parts)


async def agency_version(redis: Redis, agency_id: UUID) -> int:
    """The agency's cache version: 0 when unset or when Redis can't be read (a later cache read
    then fails the same way and falls through)."""
    try:
        raw = await redis.get(f"{VERSION_PREFIX}{agency_id}")
    except _REDIS_ERRORS as exc:
        log.warning("read_cache_unavailable", cache="version", error_type=type(exc).__name__)
        return 0
    try:
        return int(raw) if raw is not None else 0
    except ValueError:
        return 0


async def bump_agency_version(redis: Redis, agency_id: UUID) -> None:
    """Retire every cached entry of the agency. Redis errors are logged and swallowed: entries
    then live out their (short) TTL."""
    key = f"{VERSION_PREFIX}{agency_id}"
    try:
        async with redis.pipeline(transaction=False) as pipe:
            pipe.incr(key)
            pipe.expire(key, VERSION_TTL_SECONDS)
            await pipe.execute()
    except _REDIS_ERRORS as exc:
        log.warning("read_cache_unavailable", cache="version", error_type=type(exc).__name__)


async def invalidate_agency(redis: Redis, agency_id: UUID) -> None:
    """Call after a successful commit that changed the agency's data."""
    await bump_agency_version(redis, agency_id)


def mark_agency_changed(db: AsyncSession, agency_id: UUID) -> None:
    """Note that this request changed the agency's data, for a read that writes (a GET that
    expires quotes, say). `publish_agency_changes` bumps it after the request's commits."""
    db.info.setdefault(_CHANGED, set()).add(agency_id)


async def publish_agency_changes(db: AsyncSession, redis: Redis, *, write: bool = False) -> None:
    """Bump every agency marked on the session, plus its bound agency when `write`; clears the
    marks. Call after the commit."""
    changed: set[UUID] = db.info.pop(_CHANGED, set())
    bound: Any = db.info.get("agency_id")
    if write and bound is not None:
        changed.add(bound)
    for agency_id in changed:
        await invalidate_agency(redis, agency_id)


async def publish_agency_changes_after(
    request: Request, db: DbSession, redis: RedisClient
) -> AsyncIterator[None]:
    """Router dependency (function scope: runs after the endpoint, before the response is sent,
    so the client's next read already sees fresh data)."""
    try:
        yield
    finally:
        await publish_agency_changes(db, redis, write=request.method in MUTATING_METHODS)


InvalidatesAgencyCache = Depends(publish_agency_changes_after, scope="function")
