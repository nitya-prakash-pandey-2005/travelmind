"""Prometheus metrics: request counts and latency by route template, DB pool and queue gauges,
and outbound supplier latency. Also the one structured log line per request.

Labels are bounded. Routes are templates (`/api/v1/public/quotes/{token}`), never raw paths,
which carry ids and share tokens; an unrouted request is `unmatched`. No label ever holds a key.

Multiprocess (gunicorn): with `PROMETHEUS_MULTIPROC_DIR` set before the workers start, each
worker writes its values to files there and a scrape merges them with a `MultiProcessCollector`.
The directory must be empty at startup, and the server should call
`prometheus_client.multiprocess.mark_process_dead(pid)` when a worker exits.
"""

import asyncio
import hmac
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Request, Response
from prometheus_client import (
    CONTENT_TYPE_PLAIN_0_0_4,
    REGISTRY,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from prometheus_client.multiprocess import MultiProcessCollector
from redis.exceptions import RedisError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from travelmind.cache import get_shared_redis
from travelmind.config import get_settings
from travelmind.db import get_engine
from travelmind.offers.suppliers.base import SupplierError

log = structlog.get_logger()

MULTIPROC_ENV = "PROMETHEUS_MULTIPROC_DIR"
UNMATCHED_ROUTE = "unmatched"
_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
# arq's default queue (a Redis sorted set). Add queues here as workers get their own.
QUEUES = ("arq:queue",)
QUEUE_SAMPLE_TIMEOUT_SECONDS = 1.0
# Probe and scrape routes: their one `request` line per hit logs at debug, everything else at info.
QUIET_ROUTES = frozenset({"/health", "/ready", "/metrics"})

HTTP_REQUESTS = Counter(
    "http_requests_total",
    "HTTP requests by method, route template and status.",
    ["method", "route", "status"],
)
HTTP_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency by method and route template.",
    ["method", "route"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5, 10),
)
SUPPLIER_DURATION = Histogram(
    "supplier_request_duration_seconds",
    "Outbound supplier and feed call latency by outcome.",
    ["supplier", "outcome"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30),
)
# `cache` is one of the read-through caches' fixed names (readcache.CacheName); `result` is
# `hit`, `miss` or `error` (Redis unreachable: the read fell through to the database).
CACHE_REQUESTS = Counter(
    "cache_requests_total",
    "Read-through cache lookups by cache and result.",
    ["cache", "result"],
)
# Each process reports its own pool; across workers the live values add up.
DB_POOL_CHECKED_OUT = Gauge(
    "db_pool_checked_out",
    "Database connections checked out of this process's pool.",
    multiprocess_mode="livesum",
)
# One shared Redis: the most recent sample from any worker is the answer.
QUEUE_DEPTH = Gauge(
    "queue_depth",
    "Jobs waiting in a background queue (-1 when Redis can't be read).",
    ["queue"],
    multiprocess_mode="mostrecent",
)


def observe_supplier(supplier: str, outcome: str, seconds: float) -> None:
    """Record one outbound call. `outcome` is `ok`, `error`, `timeout` or `cancelled`, or
    `circuit_open` when the supplier's guard refused the call (`travelmind.resilience`; the
    seconds are the time spent waiting for a slot)."""
    SUPPLIER_DURATION.labels(supplier=supplier, outcome=outcome).observe(seconds)


def _outcome(exc: BaseException) -> str:
    # Call sites put their asyncio.timeout / wait_for inside supplier_call, so a deadline reaches
    # here already converted to TimeoutError. A bare CancelledError is the caller going away
    # (client disconnect, shutdown), which says nothing about the supplier's speed.
    if isinstance(exc, asyncio.CancelledError):
        return "cancelled"
    if isinstance(exc, TimeoutError | httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, SupplierError) and exc.code == "timeout":
        return "timeout"
    return "error"


@contextmanager
def supplier_call(supplier: str) -> Iterator[None]:
    """Time the enclosed outbound call: `ok` when it completes, otherwise `timeout`, `cancelled`
    or `error` from the exception, which is always re-raised unchanged."""
    started = time.perf_counter()
    outcome = "ok"
    try:
        yield
    except BaseException as exc:
        outcome = _outcome(exc)
        raise
    finally:
        observe_supplier(supplier, outcome, time.perf_counter() - started)


def _sample_db_pool() -> None:
    """Best effort: it runs in the request middleware's `finally`, where an error of its own
    would replace the request's exception and skip the request log line."""
    try:
        checked_out = getattr(get_engine().pool, "checkedout", None)  # NullPool (tests) has none
        if checked_out is not None:
            DB_POOL_CHECKED_OUT.set(checked_out())
    except Exception as exc:
        log.debug("db_pool_sample_failed", error_type=type(exc).__name__)


async def _queue_depth(queue: str) -> int:
    try:
        async with asyncio.timeout(QUEUE_SAMPLE_TIMEOUT_SECONDS):
            return int(await get_shared_redis().zcard(queue))
    except (RedisError, OSError, TimeoutError) as exc:
        log.warning("queue_depth_unavailable", queue=queue, error_type=type(exc).__name__)
        return -1


async def sample_gauges() -> None:
    """Refresh the gauges that are read at scrape time."""
    _sample_db_pool()
    for queue in QUEUES:
        QUEUE_DEPTH.labels(queue=queue).set(await _queue_depth(queue))


def exposition_registry() -> CollectorRegistry:
    """The registry a scrape reads: every worker's files in multiprocess mode, else this
    process's default registry."""
    if os.environ.get(MULTIPROC_ENV):
        registry = CollectorRegistry()
        MultiProcessCollector(registry)
        return registry
    return REGISTRY


def _authorized(request: Request) -> bool:
    settings = get_settings()
    if settings.metrics_token:
        supplied = request.headers.get("authorization", "")
        return hmac.compare_digest(supplied.encode(), f"Bearer {settings.metrics_token}".encode())
    return settings.environment != "production"


metrics_router = APIRouter()


@metrics_router.get("/metrics", include_in_schema=False)
async def metrics(request: Request) -> Response:
    """Prometheus text format. With TM_METRICS_TOKEN set it needs that bearer token; without
    one it is only served outside production. Refusals look like any unknown path (404)."""
    if not _authorized(request):
        raise HTTPException(status_code=404, detail="Not Found")
    await sample_gauges()
    body = await asyncio.to_thread(generate_latest, exposition_registry())
    return Response(body, media_type=CONTENT_TYPE_PLAIN_0_0_4)


class MetricsMiddleware:
    """Counts and times every HTTP request by method, route template and status, and writes one
    structured `request` log line. Pure ASGI, and registered outermost so the timing covers the
    whole middleware stack; the route is read after the app returns, once routing has set it."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status = 500  # what the server answers if the app raises before responding

        async def send_tracking_status(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_tracking_status)
        finally:
            elapsed = time.perf_counter() - started
            route = getattr(scope.get("route"), "path", None) or UNMATCHED_ROUTE
            method = scope["method"] if scope["method"] in _METHODS else "OTHER"
            HTTP_REQUESTS.labels(method=method, route=route, status=str(status)).inc()
            HTTP_DURATION.labels(method=method, route=route).observe(elapsed)
            # Keeps each worker's pool gauge current between scrapes (multiprocess sums them).
            _sample_db_pool()
            emit = log.debug if route in QUIET_ROUTES else log.info
            emit(
                "request",
                method=method,
                route=route,
                status=status,
                duration_ms=round(elapsed * 1000, 1),
                request_id=scope.get("state", {}).get("request_id"),
            )
