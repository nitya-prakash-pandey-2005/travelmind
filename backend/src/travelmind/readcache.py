"""A small Redis read-through cache for hot reads, with per-agency invalidation.

Keys:
- Tenant data lives under `agency_key(agency, version, name, ...)`. The version is a per-agency
  counter (`tm:av:<agency>`), so one `INCR` retires every cached entry of that agency at once;
  old entries simply age out on their TTL. The agency id is in every tenant key, so one agency's
  entry can never be served to another.
- Tenant-free data (airport search, route fare aggregates) uses plain `tm:rc:<name>:...` keys.

Redis is an optimisation, never a dependency:
- Every cache command (version read, GET, lock SET, SET, bump, lock release) has its own short
  deadline, `read_cache_timeout_ms` (150 ms), far below the shared pool's socket timeout. A hung
  Redis costs a request one such timeout at most: a failed version read skips the cache for that
  request, and a failed GET goes straight to the loader.
- A process-wide circuit breaker (`resilience.CircuitBreaker`, as the supplier guards use):
  after `read_cache_breaker_failures` (3) consecutive errors or timeouts it skips Redis for
  `read_cache_breaker_cooldown_s` (10 s), then lets one trial call through (half-open). The
  trial's success closes it; its failure opens it again. A command admitted before the breaker
  last opened or closed can't move it: its outcome is ignored (the breaker's epoch).
- Any failure, or a call skipped by the open breaker, falls through to the loader and counts as
  `error`. The `read_cache_unavailable` warning (error type only) is logged once per opening.

Serving stored bytes: the hot JSON reads (summary, pipeline, airports) cache the response body
exactly as it is sent (`encode=as_bytes, decode=as_bytes`) and a hit returns it as is
(`json_response`), skipping a decode and a re-serialise. Nothing then checks a stored entry
against the current model, so those keys carry `schema_tag(<response type>)`: a release that
changes the response's shape reads and writes other keys, and never serves the old shape.

A short `SET NX` lock, holding a random owner token, stops a stampede of identical loads; waiters
poll for the value for at most `LOCK_WAIT_SECONDS` and then load it themselves, so a holder that
dies never blocks anyone. The holder releases it with a compare-and-delete, so a holder whose lock
lapsed never releases someone else's.

Invalidation: a request that changes an agency's cached data bumps its version after it commits.
Routers that write take the `InvalidatesAgencyCache` dependency, which, once the endpoint has
returned and before the response is sent, bumps:
- the session's bound agency (RLS lets a session write only that agency's rows) on any POST, PUT,
  PATCH or DELETE, and
- every agency a read marked with `mark_agency_changed` (lazy quote expiry, a client's first view
  of a shared quote).
Over-invalidating (say, a write that failed after a partial commit) only costs a cache miss.

Frequent writes that don't change what the cache holds take `PublishesMarkedAgencyChanges`
instead, which bumps only marked agencies: offer repricing and marking notifications seen.

Flight and hotel searches change nothing the cache holds, so they don't bump at all: the
dashboard's "searches" KPI, the only cached-page figure they move, is computed on every read
instead of cached (dashboard.router). So searching never retires the agency's cached summary
and pipeline, and every search shows on the dashboard's next read.
"""

import asyncio
import contextlib
import hashlib
import json
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Literal, cast
from uuid import UUID

import structlog
from fastapi import Depends, Request
from pydantic import TypeAdapter
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from travelmind.cache import RedisClient
from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.metrics import CACHE_REQUESTS
from travelmind.resilience import CircuitBreaker

__all__ = [
    "CACHE_PREFIX",
    "LOCK_PREFIX",
    "LOCK_TTL_MS",
    "CacheName",
    "CircuitBreaker",
    "InvalidatesAgencyCache",
    "PublishesMarkedAgencyChanges",
    "agency_key",
    "agency_version",
    "as_bytes",
    "bump_agency_version",
    "cached_agency_json",
    "cached_json",
    "discard_agency_changes",
    "invalidate_agency",
    "json_response",
    "mark_agency_changed",
    "publish_agency_changes",
    "publish_agency_changes_after",
    "publish_marked_changes_after",
    "reset_breaker",
    "schema_tag",
]

log = structlog.get_logger()

CacheName = Literal["summary", "pipeline", "airports", "route_intel"]
"""The read-through caches: the fixed values of the `cache` metrics label."""

CACHE_PREFIX = "tm:rc:"
LOCK_PREFIX = "tm:rcl:"
VERSION_PREFIX = "tm:av:"
LOCK_TTL_MS = 3000  # longer than a normal load; a crashed holder's lock lapses on its own
LOCK_WAIT_SECONDS = 0.25
LOCK_POLL_SECONDS = 0.025
# Agencies' versions go unused once nobody reads them; let them lapse eventually.
VERSION_TTL_SECONDS = 7 * 24 * 3600
# Delete the lock only while it still holds this holder's token.
_RELEASE_LOCK = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_CHANGED = "tm_changed_agencies"  # AsyncSession.info key

# Redis-py raises RedisError subclasses; a socket can also surface a bare OSError, and a missed
# deadline is a TimeoutError (an OSError too).
_REDIS_ERRORS = (RedisError, OSError)


_breaker: CircuitBreaker | None = None


def _get_breaker() -> CircuitBreaker:
    global _breaker
    if _breaker is None:
        settings = get_settings()
        _breaker = CircuitBreaker(
            failures=settings.read_cache_breaker_failures,
            cooldown_s=settings.read_cache_breaker_cooldown_s,
        )
    return _breaker


def reset_breaker() -> None:
    """Forget the breaker's state (tests; the next call builds a closed one from settings)."""
    global _breaker
    _breaker = None


class _Unavailable(Exception):
    """Redis failed, timed out or was skipped by the open breaker (already counted and logged)."""


async def _call[R](what: str, command: Callable[[], Awaitable[R]]) -> R:
    """One Redis command under the breaker and the read cache's short deadline."""
    breaker = _get_breaker()
    epoch = breaker.admit()
    if epoch is None:
        raise _Unavailable
    try:
        async with asyncio.timeout(get_settings().read_cache_timeout_ms / 1000):
            result = await command()
    except _REDIS_ERRORS as exc:
        if breaker.record_failure(epoch):
            log.warning(
                "read_cache_unavailable",
                cache=what,
                error_type=type(exc).__name__,
                retry_in_s=get_settings().read_cache_breaker_cooldown_s,
            )
        raise _Unavailable from None
    except BaseException:
        breaker.abandon(epoch)
        raise
    breaker.record_success(epoch)
    return result


def schema_tag(tp: Any) -> str:
    """A short fingerprint of a response type's JSON schema as it is sent (serialisation mode:
    computed fields and serialisers count), for the keys of entries that are served as stored
    bytes (see the module docstring). Their loaders serialise with `by_alias=True`, as FastAPI
    does."""
    schema = json.dumps(TypeAdapter(tp).json_schema(mode="serialization"), sort_keys=True)
    return hashlib.sha256(schema.encode()).hexdigest()[:8]


def as_bytes(raw: str | bytes) -> bytes:
    """`encode` and `decode` for entries kept as the response body itself."""
    return raw if isinstance(raw, bytes) else raw.encode()


def json_response(body: bytes) -> Response:
    """A JSON body serialised already (a cached entry), sent as is. For a model, FastAPI's own
    serialisation sends the same bytes with the same content type."""
    return Response(content=body, media_type="application/json")


def _count(cache: CacheName, result: Literal["hit", "miss", "error"]) -> None:
    CACHE_REQUESTS.labels(cache=cache, result=result).inc()


async def cached_json[T](
    redis: Redis,
    key: str,
    ttl_s: int,
    loader: Callable[[], Awaitable[T]],
    *,
    encode: Callable[[T], str | bytes],
    decode: Callable[[str | bytes], T],
    cache: CacheName,
) -> T:
    """Read-through cache. A Redis failure (or the open breaker) falls through to the loader and
    stops using Redis for the call; a short SET NX lock stops a stampede of identical loads
    (waiters retry the read for ≤250 ms, then load themselves). `cache` is the metrics label."""
    try:
        raw = await _call(cache, lambda: redis.get(key))
    except _Unavailable:
        _count(cache, "error")
        return await loader()
    if raw is not None:
        cached = _decoded(decode, raw)
        if cached is not None:
            _count(cache, "hit")
            return cached[0]
    _count(cache, "miss")
    lock = LOCK_PREFIX + key
    token = secrets.token_hex(16)
    try:
        locked = bool(await _call(cache, lambda: redis.set(lock, token, nx=True, px=LOCK_TTL_MS)))
        if not locked:
            waited = await _wait_for(redis, key, decode, cache)
            if waited is not None:
                return waited[0]
    except _Unavailable:
        return await loader()
    try:
        loaded = await loader()
        try:
            await _call(cache, lambda: redis.set(key, encode(loaded), ex=ttl_s))
        except _Unavailable:
            locked = False  # Redis is struggling: don't touch it again for this call
        return loaded
    finally:
        if locked:  # released early on success and on a failed load alike
            with contextlib.suppress(_Unavailable):
                await _call(cache, lambda: _release(redis, lock, token))


async def _release(redis: Redis, lock: str, token: str) -> Any:
    return await cast(Awaitable[Any], redis.eval(_RELEASE_LOCK, 1, lock, token))


def _decoded[T](decode: Callable[[str | bytes], T], raw: str | bytes) -> tuple[T] | None:
    """The decoded entry, or None for one this code can't read (say, written by an older
    release with another shape): it is then reloaded and overwritten."""
    try:
        return (decode(raw),)
    except ValueError:  # json.JSONDecodeError and pydantic.ValidationError are ValueErrors
        return None


async def _wait_for[T](
    redis: Redis, key: str, decode: Callable[[str | bytes], T], cache: CacheName
) -> tuple[T] | None:
    """Poll for another caller's load for at most LOCK_WAIT_SECONDS."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + LOCK_WAIT_SECONDS
    while loop.time() < deadline:
        await asyncio.sleep(LOCK_POLL_SECONDS)
        raw = await _call(cache, lambda: redis.get(key))
        if raw is not None:
            value = _decoded(decode, raw)
            if value is not None:
                return value
    return None


def agency_key(agency_id: UUID, version: int, name: str, *parts: str) -> str:
    return f"{CACHE_PREFIX}a:{agency_id}:v{version}:{name}:" + ":".join(parts)


async def agency_version(redis: Redis, agency_id: UUID) -> int | None:
    """The agency's cache version (0 when unset), or None when Redis can't say: the caller
    then skips the cache for this request rather than guess a version."""
    try:
        raw = await _call("version", lambda: redis.get(f"{VERSION_PREFIX}{agency_id}"))
    except _Unavailable:
        return None
    try:
        return int(raw) if raw is not None else 0
    except ValueError:
        return 0


async def bump_agency_version(redis: Redis, agency_id: UUID) -> None:
    """Retire every cached entry of the agency. Redis errors are logged and swallowed: entries
    then live out their (short) TTL."""
    key = f"{VERSION_PREFIX}{agency_id}"

    async def bump() -> None:
        async with redis.pipeline(transaction=False) as pipe:
            pipe.incr(key)
            pipe.expire(key, VERSION_TTL_SECONDS)
            await pipe.execute()

    with contextlib.suppress(_Unavailable):
        await _call("version", bump)


async def invalidate_agency(redis: Redis, agency_id: UUID) -> None:
    """Call after a successful commit that changed the agency's data."""
    await bump_agency_version(redis, agency_id)


async def cached_agency_json[T](
    redis: Redis,
    agency_id: UUID,
    parts: tuple[str, ...],
    ttl_s: int,
    loader: Callable[[], Awaitable[T]],
    *,
    encode: Callable[[T], str | bytes],
    decode: Callable[[str | bytes], T],
    cache: CacheName,
) -> T:
    """`cached_json` under the agency's current version (`agency_key(agency, version, cache,
    *parts)`). When the version can't be read, the cache is skipped for this call."""
    version = await agency_version(redis, agency_id)
    if version is None:
        _count(cache, "error")
        return await loader()
    key = agency_key(agency_id, version, cache, *parts)
    return await cached_json(redis, key, ttl_s, loader, encode=encode, decode=decode, cache=cache)


def mark_agency_changed(db: AsyncSession, agency_id: UUID) -> None:
    """Note that this request changed the agency's data, for a read that writes (a GET that
    expires quotes, say). `publish_agency_changes` bumps it after the request's commits."""
    db.info.setdefault(_CHANGED, set()).add(agency_id)


def discard_agency_changes(db: AsyncSession) -> None:
    """Forget the session's marks (its changes were rolled back), so a later publish on the same
    session doesn't bump agencies that didn't change."""
    db.info.pop(_CHANGED, None)


async def publish_agency_changes(db: AsyncSession, redis: Redis, *, write: bool = False) -> None:
    """Bump every agency marked on the session, plus its bound agency when `write`; clears the
    marks. Call after the commit."""
    changed: set[UUID] = db.info.pop(_CHANGED, set())
    bound: Any = db.info.get("agency_id")
    if write and bound is not None:
        changed.add(bound)
    for agency_id in changed:
        await invalidate_agency(redis, agency_id)


async def _close_before_redis(db: AsyncSession) -> None:
    """Close the request's session before the bump talks to Redis, so no connection is held
    meanwhile. `get_db` would close it right after anyway: the endpoint has returned and its
    response is serialised, and uncommitted work is rolled back either way. The marks and the
    bound agency stay in `db.info`."""
    await db.close()


async def publish_agency_changes_after(
    request: Request, db: DbSession, redis: RedisClient
) -> AsyncIterator[None]:
    """Router dependency (function scope: runs after the endpoint, before the response is sent,
    so the client's next read already sees fresh data)."""
    try:
        yield
    finally:
        await _close_before_redis(db)
        await publish_agency_changes(db, redis, write=request.method in MUTATING_METHODS)


async def publish_marked_changes_after(db: DbSession, redis: RedisClient) -> AsyncIterator[None]:
    """Like `publish_agency_changes_after`, but bumps only agencies marked as changed: for
    routers whose writes leave the cached reads alone (or may leave them stale for a TTL)."""
    try:
        yield
    finally:
        await _close_before_redis(db)
        await publish_agency_changes(db, redis)


InvalidatesAgencyCache = Depends(publish_agency_changes_after, scope="function")
PublishesMarkedAgencyChanges = Depends(publish_marked_changes_after, scope="function")
