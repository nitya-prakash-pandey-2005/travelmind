# v3 · Step 3 — Scale Foundation and First Load Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TravelMind API ready for 1,000 concurrent users. It gets a production-like deployment topology, shared connection pools, caching, background jobs, protected outbound calls and metrics. A first k6 load test then proves it, and its report is checked in.

**Architecture:**
- The API stays a stateless FastAPI app, with process-wide shared clients (DB engine, Redis pool, httpx clients) opened and closed in the lifespan.
- Production runs as nginx → gunicorn with uvicorn workers → PgBouncer (transaction pooling) → Postgres, plus Redis and an arq worker container.
- Hot reads go through a small Redis read-through cache whose tenant keys are invalidated by an agency version counter.
- Slow and periodic work moves to arq jobs.

**Tech Stack:** FastAPI, SQLAlchemy 2 async + asyncpg, Redis 7 (redis-py asyncio), arq, prometheus-client, gunicorn, nginx, PgBouncer, Docker Compose, k6.

**Spec:** `docs/superpowers/specs/2026-10-03-travelmind-platform-v3-design.md` §3 (topology, performance work, load test targets).

## Global Constraints
- Targets (spec §3), measured by k6 with the mixed scenario ramping to **1000 concurrent virtual users**:
  - read endpoints p95 < 300 ms
  - searches p95 < 2.5 s (sandbox)
  - error rate < 1%
  - no DB connection exhaustion
- Tenant binding stays transaction-local (`set_config(..., true)`), so it works under PgBouncer transaction pooling. Session-level `SET` is never used, nor anything else that depends on a session: advisory locks, `LISTEN`, or prepared statements held across transactions.
- Existing behaviour and API shapes are unchanged. `/health` keeps its exact current response. All 557+ backend tests stay green.
- Production compose must not use host ports 5432, 6379 (another project's containers), 5433, 6380, 8010 or 5173 (the dev stack). Only nginx publishes a port: host 8080.
- Secrets come only from env. `.env` / `backend/.env` are never read, printed or committed. Supplier keys never appear in logs or metrics labels.
- Metrics labels use route templates (`/api/v1/quotes/{quote_id}`), never raw paths. Raw paths carry ids and share tokens.
- No AI/assistant attribution anywhere. Plain conventional commits.
- Low-memory dev machine: focused tests while working, the full suite once per task.

## Review Focus
1. **Redis or a supplier is down:** the API keeps serving. Cache reads fall through to the DB, rate limiters fail open (existing behaviour), and the circuit breaker opens and returns the existing "supplier unavailable" outcome fast. Pinned in Task 3 `cache_falls_through_when_redis_is_down` and Task 5 `open_breaker_skips_the_supplier`.
2. **Stale tenant data after a write:** the dashboard summary or pipeline must reflect a quote or enquiry change on the very next read. Pinned in Task 3 `write_invalidates_agency_cache`.
3. **Cross-tenant cache bleed:** a cached dashboard for agency A is never served to agency B. Pinned in Task 3 `cache_keys_are_tenant_scoped`.
4. **PgBouncer transaction mode:** asyncpg prepared statements must not break across pooled server connections, and the tenant must not leak between transactions sharing a server connection. Pinned in Task 6 `pgbouncer_smoke.sh` (two agencies alternating requests through PgBouncer, each sees only its own data).
5. **Real client IP behind nginx:** per-IP limits (login, signup, demo, public quote) must key on the visitor, not on nginx's IP, and spoofed `X-Forwarded-For` from outside must not be trusted. Pinned in Task 6 `nginx_forwards_real_ip` (smoke) and the gunicorn `forwarded_allow_ips` config.

---

### Task 1: Shared clients, pool sizing, readiness and lean middleware

**Files:**
- Modify: `backend/src/travelmind/config.py`
  - Add `db_pool_size: int = 10`, `db_max_overflow: int = 5`, `db_pool_timeout_s: float = 5.0`, `db_statement_timeout_ms: int = 5000`, `db_pgbouncer: bool = False`, `redis_max_connections: int = 100`.
- Modify: `backend/src/travelmind/db.py`
  - `get_engine()` uses these settings.
  - Under PgBouncer it disables the asyncpg statement cache and uses unique prepared-statement names.
  - Without PgBouncer it sets `statement_timeout` via `server_settings`.
- Modify: `backend/src/travelmind/cache.py`
  - Add a process-wide `ConnectionPool`. `get_redis()` yields a client on the shared pool and never opens a pool per request.
  - Add `get_shared_redis()` for code outside requests.
  - Add `close_redis()`.
- Create: `backend/src/travelmind/http.py`
  - `get_http_client(name: str, *, timeout: httpx.Timeout, base_url: str = "") -> httpx.AsyncClient`, cached per name and created lazily.
  - `close_http_clients()`.
- Modify: the outbound callers to use `get_http_client(...)` instead of `async with httpx.AsyncClient(...)`. Keep each caller's existing timeouts and deadlines.
  - `offers/suppliers/duffel.py`, `hotels/liteapi.py`, `offers/carbon.py`, `offers/fx.py`, `fareintel/travelpayouts.py`
- Modify: `backend/src/travelmind/health.py`
  - Add `GET /ready`: checks DB `SELECT 1` and Redis `PING` with a 2 s overall timeout.
  - 200 `{"status":"ready","database":"ok","redis":"ok"}`, else 503 with `"unavailable"` on the failing part.
  - `/health` is unchanged.
- Modify: `backend/src/travelmind/middleware.py`
  - Rewrite `RequestIdMiddleware` as a pure ASGI middleware with the same header and contextvar behaviour. `BaseHTTPMiddleware` adds a task and stream copy per request.
- Modify: `backend/src/travelmind/main.py`
  - The lifespan closes the shared Redis pool, the http clients and disposes the engine on shutdown.
  - `demo_cleanup_loop` only starts when the new setting `run_scheduler: bool = True` is true (Task 4 sets it false in production, where the worker owns schedules).
- Test:
  - `backend/tests/test_runtime_clients.py`
  - additions to `backend/tests/test_health.py`
  - existing middleware tests must pass unchanged

**Interfaces:**
- Produces:
  - `travelmind.cache.get_shared_redis() -> Redis`
  - `travelmind.cache.close_redis() -> Awaitable[None]`
  - `travelmind.http.get_http_client(name, *, timeout, base_url="") -> httpx.AsyncClient`
  - `travelmind.http.close_http_clients() -> Awaitable[None]`
  - the `Settings` fields above, plus `run_scheduler`
  - `GET /ready`

Core code:

```python
# db.py — get_engine
@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    if settings.environment == "test":
        return create_async_engine(settings.database_url, poolclass=NullPool)
    connect_args: dict[str, Any]
    if settings.db_pgbouncer:
        # Transaction pooling: a server connection is shared between clients, so asyncpg must not
        # cache prepared statements under fixed names (SQLAlchemy asyncpg docs, "PgBouncer").
        connect_args = {
            "statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
        }
    else:
        connect_args = {"server_settings": {"statement_timeout": str(settings.db_statement_timeout_ms)}}
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_s,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
```

```python
# cache.py
_pool: ConnectionPool | None = None

def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = ConnectionPool.from_url(settings.redis_url, max_connections=settings.redis_max_connections)
    return _pool

def get_shared_redis() -> Redis:
    return Redis(connection_pool=_get_pool())

async def get_redis() -> AsyncIterator[Redis]:
    yield get_shared_redis()  # the pool owns connections; nothing to close per request

async def close_redis() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
```

Under PgBouncer, `statement_timeout` is set per role in the deploy init (Task 6), because PgBouncer rejects unknown startup parameters.

- [ ] **Step 1: Write the failing tests** in `tests/test_runtime_clients.py`:
  - `test_get_redis_reuses_one_pool`: two `get_redis()` iterations yield clients whose `connection_pool` is the same object.
  - `test_http_client_is_shared_per_name`: `get_http_client("x", timeout=...)` returns the same instance twice. After `close_http_clients()` it returns a new open one.
  - `test_engine_pgbouncer_mode_disables_statement_cache`: monkeypatch settings `environment="development", db_pgbouncer=True`, clear the `get_engine` cache, then inspect `engine.dialect`/`url` and `connect_args` via `engine.pool._creator`-independent means. Simplest: patch `create_async_engine` and assert the kwargs.
  - `test_engine_direct_mode_sets_statement_timeout`: the same approach, asserting `server_settings.statement_timeout == "5000"`.

  In `tests/test_health.py`:
  - `test_ready_ok`: 200 and both parts "ok".
  - `test_ready_redis_down`: override `get_redis` with a client whose `ping` raises `RedisError`, giving 503 `{"status":"unavailable","database":"ok","redis":"unavailable"}`.
  - `test_health_shape_unchanged`.
- [ ] **Step 2:** Run `uv run pytest tests/test_runtime_clients.py tests/test_health.py -q`. Expect a failure (missing module/route).
- [ ] **Step 3:** Implement as above. Update the five outbound callers. Each keeps its own `timeout`/deadline by passing `timeout=` per request (`client.get(url, timeout=FETCH_TIMEOUT)`) when the shared client's default differs. `respx` mocks still intercept shared clients. Then:
  - rewrite `RequestIdMiddleware` as ASGI (wrap `send` to append the header; bind/clear contextvars around the call)
  - make the lifespan changes
- [ ] **Step 4:** Run the focused tests, then the full suite: `uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy src`.
- [ ] **Step 5:** Commit `perf(api): shared Redis and HTTP clients, pool sizing, readiness check`.

### Task 2: Metrics and structured request logs

**Files:**
- Add dependency `prometheus-client` (`uv add prometheus-client`).
- Create: `backend/src/travelmind/metrics.py`
  - Registry setup. In multiprocess mode, `PROMETHEUS_MULTIPROC_DIR` set means a `MultiProcessCollector`.
  - Metrics:
    - `http_requests_total{method,route,status}`
    - `http_request_duration_seconds{method,route}` histogram, buckets `.01,.025,.05,.1,.2,.3,.5,1,2.5,5,10`
    - `db_pool_checked_out` gauge (`get_engine().pool.checkedout()`, sampled at scrape)
    - `supplier_request_duration_seconds{supplier,outcome}`
    - `queue_depth{queue}` gauge (arq queue length, sampled at scrape, Redis errors give -1)
  - A pure ASGI `MetricsMiddleware` that labels by route template: `scope["route"].path` after routing, `"unmatched"` otherwise.
  - Route `GET /metrics`. If `TM_METRICS_TOKEN` is set, it requires `Authorization: Bearer <token>`, else 404. If unset, it is only served when `environment != "production"`. nginx never proxies `/metrics` (Task 6).
- Modify: `backend/src/travelmind/config.py` (`metrics_token: str = ""`), `main.py` (add the middleware outermost, include the route).
- Modify: the five outbound callers to observe `supplier_request_duration_seconds` with `outcome ∈ {ok, error, timeout}`.
- Test: `backend/tests/test_metrics.py`.

**Interfaces:**
- Consumes: `get_engine()`, `get_shared_redis()` (Task 1).
- Produces:
  - `travelmind.metrics.observe_supplier(supplier: str, outcome: str, seconds: float) -> None`
  - `travelmind.metrics.metrics_router`
  - `travelmind.metrics.MetricsMiddleware`

- [ ] **Step 1: Failing tests.**
  - `test_request_metrics_use_route_template`: GET `/api/v1/public/quotes/abc123secret` (404 is fine). The `/metrics` body contains `route="/api/v1/public/quotes/{token}"` and does not contain `abc123secret`.
  - `test_metrics_hidden_in_production_without_token`: production gives 404.
  - `test_metrics_token_required`: with the token set, a wrong or missing bearer gives 404 and the right one gives 200 with the `text/plain; version=0.0.4` content type.
  - `test_supplier_latency_recorded`: run a sandbox search, assert `supplier_request_duration_seconds_count{outcome="ok",supplier="sandbox"}` ≥ 1. Sandbox calls are observed too, by the registry wrapper or the call site.
  - `test_no_secret_values_in_metrics`: set `duffel_token="sk_test_canary"` and assert it is absent from the output.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement. Test isolation: create collectors once at import, and read values via `generate_latest(REGISTRY)` in tests (counts only increase).
- [ ] **Step 4:** Focused tests, then the full suite, ruff and mypy.
- [ ] **Step 5:** Commit `feat(api): Prometheus metrics with route-template labels`.

### Task 3: Redis read-through cache with tenant invalidation

**Files:**
- Create: `backend/src/travelmind/readcache.py`

```python
CACHE_PREFIX = "tm:rc:"

async def cached_json(
    redis: Redis, key: str, ttl_s: int, loader: Callable[[], Awaitable[T]],
    *, encode: Callable[[T], str], decode: Callable[[str], T],
) -> T:
    """Read-through cache. Redis failures fall through to the loader (logged once per call);
    a short SET NX lock stops a stampede of identical loads (waiters retry the read for ≤250 ms,
    then load themselves)."""

async def agency_version(redis: Redis, agency_id: UUID) -> int:   # GET tm:av:<agency>, 0 if missing/error
async def bump_agency_version(redis: Redis, agency_id: UUID) -> None:  # INCR, swallow RedisError

def agency_key(agency_id: UUID, version: int, name: str, *parts: str) -> str:
    return f"{CACHE_PREFIX}a:{agency_id}:v{version}:{name}:" + ":".join(parts)
```

- Apply caching. Keep response models unchanged by caching the Pydantic model's `model_dump_json()` and decoding with `Model.model_validate_json`.
  - `dashboard/router.py`: summary (per range) and pipeline, 30 s, key `agency_key(agency, ver, "summary", range)`. Lazy expiry still runs before the cache read. `expire_overdue_quotes` returning >0 bumps the version.
  - `offers/router.py` suppliers list: 30 s, global key `tm:rc:suppliers`.
  - `reference/router.py` airport search: 1 h, key on the normalised query + limit.
  - `fareintel/routes.py` route intel: fare aggregates (tenant-independent) 5 min, key on route, cabin, currency, agency time zone and local date; `your_searches` stays uncached.
  - `platform.py` facts: already Redis-cached. Leave it, but route it through `cached_json` if that makes it simpler.
- Invalidation: every workspace write calls `bump_agency_version` after commit. A single helper `await invalidate_agency(redis, agency_id)` is called from the route layer after successful mutations.
  - enquiries, quotes (create/version/send/decide/expire), clients, public quote decision and first view, agency profile, demo generation
  - Grep for `@*_router.(post|patch|put|delete)` in `workspace/`, `dashboard/`, `demo/`, `identity/` (team changes affect the dashboard team block) to make the list complete.
- Test: `backend/tests/test_readcache.py`, plus additions to `tests/dashboard/`.

**Interfaces:**
- Consumes: `get_redis` / `get_shared_redis` (Task 1).
- Produces: `cached_json`, `agency_version`, `bump_agency_version`, `agency_key`, `invalidate_agency(redis, agency_id)`.

- [ ] **Step 1: Failing tests.**
  - `test_cached_json_loads_once`: two calls run the loader once.
  - `test_cache_falls_through_when_redis_is_down`: a Redis double whose `get`/`set` raise `RedisError`; the loader is called both times and the result is still returned.
  - `test_stampede_lock`: 10 concurrent calls with a slow loader run it 1 time, or at most 2.
  - `test_cache_keys_are_tenant_scoped`: create two agencies with data. Agency A's summary, then agency B's summary, differ and each matches its own uncached computation.
  - `test_write_invalidates_agency_cache`: read the summary, create an enquiry via the API, and the summary's open-enquiries count increases on the very next read.
  - `test_public_decision_invalidates`: accept via the public endpoint, then the agency summary reflects the won quote.
- [ ] **Step 2:** Run and see them fail.
- [ ] **Step 3:** Implement and apply.
- [ ] **Step 4:** Focused tests, then the full suite, ruff and mypy.
- [ ] **Step 5:** Commit `perf(api): Redis read-through cache with per-agency invalidation`.

### Task 4: Background jobs (arq), indexes and query budget

**Files:**
- Add dependency `arq`.
- Create: `backend/src/travelmind/worker.py`
  - arq `WorkerSettings` with `redis_settings` from `TM_REDIS_URL`.
  - `functions = [generate_demo_job]`.
  - `cron_jobs`:
    - `cleanup_expired_demos` hourly, reusing `demo/cleanup.py`'s single-pass function. Extract `cleanup_once()` from the loop if needed.
    - `expire_overdue_quotes_all` every 5 minutes. It iterates agencies via a `SECURITY DEFINER`-free path: the job runs under the owner role connection `TM_MIGRATION_DATABASE_URL`, read-only for the agency list, then binds each tenant on the app engine and calls `expire_overdue_quotes`.
  - `on_startup`/`on_shutdown` open and close shared clients.
  - Worker DB sessions run `SET LOCAL statement_timeout = '60s'` at transaction start (an `after_begin` hook installed only in the worker process).
- Create: `backend/src/travelmind/jobs.py`
  - `async def enqueue(name: str, *args, job_id: str | None = None) -> str` using an arq pool created lazily on the shared Redis URL.
  - `async def job_status(job_id) -> Literal["queued","running","done","failed","unknown"]`.
- Demo generation stays synchronous in this step: its HTTP contract is used by the landing page. Add a global Redis semaphore of 4 concurrent generations (`tm:sem:demo`, with TTL safety) so a burst can't exhaust the DB pool. A blocked request waits ≤ 10 s, then gets 503 "Demo workspaces are busy. Try again in a moment.". `generate_demo_job` is registered for Step 5 (the traveller app) to reuse.
- Create migration `backend/migrations/versions/0008_hot_path_indexes.py` (0007 already added workspace FK and activity-entity indexes in Plan 5). First `EXPLAIN` the hot queries in a scratch session, and only add indexes that are missing:
  - `activity_events (agency_id, entity_type, entity_id, occurred_at DESC)`
  - `activity_events (agency_id, occurred_at DESC)`
  - `fare_snapshots (origin, destination, cabin, currency, observed_at DESC)`
  - `quotes (agency_id, status, valid_until)`
  - `enquiries (agency_id, status, updated_at DESC)`
  - `search_source_results`/search log `(agency_id, origin, destination, created_at DESC)`
  - `sessions (token_hash)` if not unique already
  - Use `CREATE INDEX IF NOT EXISTS`. Plain `CREATE INDEX` is fine at this data size; note in the docstring that production would use `CONCURRENTLY` outside a transaction.
- Create: `backend/tests/test_query_budget.py`. A fixture counts statements via a SQLAlchemy `before_cursor_execute` listener on the sync engine.
- Test: `backend/tests/test_worker.py`.

**Interfaces:**
- Consumes: Task 1 clients, `demo/cleanup.py`, `workspace/quotes.expire_overdue_quotes(db, agency_id=..., now=...)`.
- Produces: `travelmind.jobs.enqueue`, `travelmind.jobs.job_status`, `travelmind.worker.WorkerSettings`, migration `0008_hot_path_indexes`.

- [ ] **Step 1: Failing tests.**
  - `test_expire_sweep_expires_all_agencies`: two agencies, each with an overdue sent quote. Calling the cron function directly with `ctx={}` makes both expired, and each gets one `quote.expired` event.
  - `test_cleanup_job_removes_expired_demo`.
  - `test_demo_semaphore_limits_concurrency`: with the limit patched to 1, a second concurrent generation waits, and with the wait patched to 0.1 s it returns 503.
  - Query budget, each with a seeded agency of 30 clients, 30 enquiries and 30 quotes:
    - `test_clients_list_query_budget`: `GET /api/v1/clients` runs ≤ 6 statements, whatever the row count. Assert the same count for 3 and 30 clients.
    - `test_enquiries_list_query_budget`
    - `test_quotes_list_query_budget`
    - `test_dashboard_summary_query_budget`: cache bypassed, statement count ≤ 25.
  - `test_hot_indexes_exist`: query `pg_indexes` for each index the migration adds.
- [ ] **Step 2:** Run and see them fail.
- [ ] **Step 3:** Implement. If a budget test exposes an N+1, fix it with a joined or aggregated query in the same task.
- [ ] **Step 4:** Run `uv run python -m alembic upgrade head` on the dev DB, then the focused tests, then the full suite, ruff and mypy.
- [ ] **Step 5:** Commit `perf(api): background worker, hot-path indexes and query budgets`.

### Task 5: Outbound resilience — per-supplier concurrency and circuit breakers

**Files:**
- Create: `backend/src/travelmind/resilience.py`

```python
class CircuitOpen(Exception): ...

class SupplierGuard:
    """Per-process guard for one supplier: at most `max_concurrent` calls in flight, and a circuit
    breaker that opens after `failure_threshold` consecutive failures/timeouts and lets one trial
    call through after `reset_after_s` (half-open). Time comes from an injectable clock."""
    def __init__(self, name: str, *, max_concurrent: int, failure_threshold: int = 5,
                 reset_after_s: float = 30.0, acquire_timeout_s: float = 2.0,
                 clock: Callable[[], float] = time.monotonic) -> None: ...
    @asynccontextmanager
    async def call(self) -> AsyncIterator[None]:
        """Raises CircuitOpen when open (or when no slot frees within acquire_timeout_s);
        records success/failure from the body's outcome (exceptions = failure)."""
    @property
    def state(self) -> Literal["closed", "open", "half_open"]: ...

def guard_for(name: str) -> SupplierGuard  # registry with settings-driven limits
```

- Settings: `supplier_max_concurrent: int = 20`, `supplier_breaker_threshold: int = 5`, `supplier_breaker_reset_s: float = 30.0`.
- Wire the guard into the existing supplier call sites: Duffel, LiteAPI, TIM, Travelpayouts, FX. `CircuitOpen` maps to each caller's existing "unavailable/degraded" result, never a 500. For search that is the per-source error status already shown in Fare search's source list. The supplier status endpoint adds `breaker: "closed"|"open"|"half_open"` to `SupplierStatusOut`; the frontend type is extended later, and the additive field is harmless.
- Test: `backend/tests/test_resilience.py`.

**Interfaces:**
- Consumes: `observe_supplier` (Task 2). An open circuit records `outcome="circuit_open"`.
- Produces: `SupplierGuard`, `CircuitOpen`, `guard_for`, and `SupplierStatusOut.breaker`.

- [ ] **Step 1: Failing tests** (fake clock, no sleeps):
  - `test_breaker_opens_after_threshold`
  - `test_open_breaker_skips_the_supplier`: the body is not executed and `CircuitOpen` is raised.
  - `test_half_open_allows_one_trial`, then success closes it or failure reopens it.
  - `test_concurrency_limit`: with `max_concurrent=2`, the third waiter times out with `CircuitOpen`.
  - `test_search_survives_open_duffel_breaker`: Duffel is configured with respx 500s × threshold, and the next search returns sandbox results with Duffel's source marked unavailable and no HTTP call made (respx call count unchanged).
  - `test_supplier_status_shows_breaker`
- [ ] **Step 2:** Run and see them fail.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Focused tests, then the full suite, ruff and mypy.
- [ ] **Step 5:** Commit `feat(api): per-supplier concurrency limits and circuit breakers`.

### Task 6: Production-like deployment topology

**Files:**
- Create: `deploy/docker-compose.yml`
  - Project name `travelmind-prod`. No host ports except nginx `8080:80`.
  - `postgres`: pgvector/pgvector:pg16, its own volume, `deploy/postgres/init.sql`, `max_connections=200`.
  - `pgbouncer`: `edoburu/pgbouncer` with `POOL_MODE=transaction`, `MAX_CLIENT_CONN=2000`, `DEFAULT_POOL_SIZE=40`, `AUTH_TYPE=scram-sha-256`, users for travelmind_app and travelmind_owner.
  - `redis`: redis:7-alpine with `--maxmemory 256mb --maxmemory-policy allkeys-lru`.
  - `migrate`: one-shot `alembic upgrade head` straight to postgres as owner. It runs before the api starts (`depends_on: condition: service_completed_successfully`).
  - `api`: replicas via `deploy.replicas: ${API_REPLICAS:-2}`. `TM_DB_PGBOUNCER=true`, `TM_ENVIRONMENT=production`, `TM_RUN_SCHEDULER=false`, `TM_COOKIE_SECURE=false` (local HTTP only; documented), `TM_ALLOWED_ORIGINS=["http://localhost:8080"]`, `PROMETHEUS_MULTIPROC_DIR=/tmp/prom`. Healthcheck on `/ready`.
  - `worker`: `arq travelmind.worker.WorkerSettings`.
  - `nginx`.
  - All secrets come from `deploy/.env` (git-ignored). `deploy/.env.example` is committed with placeholder dev values and no real keys.
- Create: `deploy/postgres/init.sql`. It is the same as `infra/postgres/init.sql` plus `ALTER ROLE travelmind_app SET statement_timeout = '5s'` and passwords taken from psql variables or env defaults matching `.env.example`.
- Create: `backend/Dockerfile`
  - Multi-stage `ghcr.io/astral-sh/uv:python3.12-bookworm-slim`, `uv sync --locked --no-dev`, non-root user.
  - CMD `gunicorn travelmind.main:create_app() -k uvicorn_worker.UvicornWorker -c gunicorn.conf.py`. Add the `gunicorn` and `uvicorn-worker` deps.
- Create: `backend/gunicorn.conf.py`
  - `workers = int(os.environ.get("WEB_CONCURRENCY", 2 * cpu + 1 capped at 8))`, `bind 0.0.0.0:8000`, `keepalive 5`, `graceful_timeout 20`, `timeout 60`.
  - `forwarded_allow_ips = os.environ.get("FORWARDED_ALLOW_IPS", "*")`. Only nginx can reach the api on the compose network, so `*` there is safe; this is documented in the file.
  - A `child_exit` hook calls `prometheus_client.multiprocess.mark_process_dead`.
  - Pool math in a comment: replicas × workers × (pool_size+overflow) ≤ `MAX_CLIENT_CONN`, and PgBouncer `DEFAULT_POOL_SIZE` ≤ postgres `max_connections` minus headroom. With the defaults: 2 × 8 × 15 = 240 client connections → 40 server connections.
- Create: `frontend/Dockerfile`: node:22-alpine build (`npm ci && npm run build`), then copy `dist` into the nginx stage.
- Create: `deploy/nginx/nginx.conf`
  - `worker_connections 4096`, gzip on for text types/JS/CSS/JSON, long cache for `/assets/*` (immutable) and `no-cache` for `index.html`.
  - SPA fallback, `/api/` and `/health` `/ready` → `upstream api { server api:8000; keepalive 64; }` with `proxy_http_version 1.1`, `proxy_set_header X-Forwarded-For $remote_addr` (overwrite, never append client-supplied) and `X-Forwarded-Proto $scheme`.
  - `location = /metrics { return 404; }`.
  - Security headers: `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin` (the API's public quote responses already send `no-referrer`), `X-Frame-Options DENY`, `Permissions-Policy` minimal.
  - `client_max_body_size 1m`. Rate limiting stays in the app.
- Create: `deploy/README.md`: how to run (`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`), ports, scaling `API_REPLICAS`, pool math, and how to seed load-test users (Task 7).
- Create: `deploy/smoke.sh`, a bash script run after `up`:
  - `curl` `/` (200, contains `<div id="root">`), `/ready` (200), `/metrics` (404 through nginx).
  - **`nginx_forwards_real_ip`**: a request with a spoofed `X-Forwarded-For: 1.2.3.4` header; the API echo check reads the log line or a debug-free assertion via the per-IP login limiter key in Redis (`redis-cli --scan --pattern 'rl:login:ip:*'`, which must not contain `1.2.3.4`).
  - **`pgbouncer_smoke.sh`** (called from smoke.sh): sign up two agencies through nginx, create one client each, alternate 50 reads, and assert each agency only ever sees its own client name.
- Modify: `.github/workflows/backend.yml`: add a `docker build backend` job (build only, no push).
- Modify: the `.gitignore`: `deploy/.env`.

- [ ] **Step 1:** Write `deploy/smoke.sh` and `pgbouncer_smoke.sh` first. Run them against nothing and see them fail.
- [ ] **Step 2:** Write the Dockerfiles, compose, nginx and gunicorn config.
- [ ] **Step 3:** Run `docker compose -f deploy/docker-compose.yml config` (valid), then `up -d --build`, then `bash deploy/smoke.sh`. All checks pass. Keep memory in mind: `API_REPLICAS=1 WEB_CONCURRENCY=2` is acceptable for the smoke run.
- [ ] **Step 4:** `docker compose -f deploy/docker-compose.yml down` (keep volumes). The full backend suite is still green.
- [ ] **Step 5:** Commit `feat(deploy): production-like stack with nginx, gunicorn workers, PgBouncer and worker`.

### Task 7: k6 load test and first report

**Files:**
- Create: `loadtest/seed.py`, run as `uv run python ../loadtest/seed.py --agencies 50 --users-per-agency 4` from backend/, or as a module inside the api container.
  - Creates agencies, users (known password from env `LOADTEST_PASSWORD`, default documented), clients, enquiries and quotes directly through the service layer. It writes a `loadtest/users.json` (git-ignored) with emails and one quote share link per agency.
  - It refuses to run when `TM_ENVIRONMENT=production` unless `--i-know` is given; it targets only the deploy stack.
- Create: `loadtest/k6/mixed.js`.
  - Scenarios with constant-arrival or ramping VUs: stages 0→200 (2 m), →500 (3 m), →1000 (5 m), hold 1000 (5 m), ramp down (1 m).
  - Traffic per VU iteration, weighted:
    - 30% public: `/`, `/api/v1/platform/facts`, `/api/v1/public/quotes/<token>`
    - 45% signed-in reads: Command Center summary/pipeline/activity, quotes/enquiries/clients lists, airport lookup
    - 15% flight search (sandbox) + one reprice
    - 10% writes: create enquiry, update client
  - Each VU signs in once in `setup()` per user. Cookies are shared from a pool of 200 sessions so bcrypt/argon2 doesn't dominate. Logins are throttled to setup only.
  - Thresholds: `http_req_duration{kind:read}` p(95)<300, `http_req_duration{kind:search}` p(95)<2500, `http_req_failed` rate<0.01. Requests are tagged `kind`.
- Create: `loadtest/run.sh`: `docker run --rm --network travelmind-prod_default -v $PWD/loadtest:/scripts grafana/k6 run /scripts/k6/mixed.js --summary-export /scripts/results/<date>.json`. It also samples `docker stats --no-stream` every 15 s into `loadtest/results/<date>-stats.txt`, and scrapes `/metrics` from inside the network at the peak.
- Deploy env for load tests: `deploy/.env.loadtest.example` raises the login, signup, demo and public-quote per-IP limits and `search_max_per_minute`, because all VUs share one source IP. This is documented as test-only.
- Create: `docs/perf/2026-10-03-first-load-test.md`:
  - machine spec (CPU model and cores, RAM, Docker Desktop resources, OS)
  - stack config (replicas, workers, pool sizes)
  - results table per kind: p50, p95, p99, error rate, RPS at peak
  - DB pool and PgBouncer stats at peak (`SHOW POOLS`), CPU and memory per container, bottlenecks found and fixes made
  - a pass/fail verdict per target
  - If the machine can't host 1000 VUs plus the stack, record the highest stable VU count, the limiting resource, and per-container numbers. This is what spec §3 asks for. Results JSON is committed only in summary form; raw output under `loadtest/results/` is git-ignored except the summary.

- [ ] **Step 1:** Seed, then run a 50-VU smoke (`K6_STAGES=smoke`). Thresholds pass and no 4xx/5xx come from auth or limits.
- [ ] **Step 2:** Run the full ramp. If a target fails, profile with `/metrics`, `pg_stat_statements` (enable it in the deploy postgres) and `docker stats`. Fix the cause in the owning module with a test. Re-run. At most 3 fix iterations; each fix is its own commit, `perf(...): ...`.
- [ ] **Step 3:** Write the report with real numbers only.
- [ ] **Step 4:** Commit `docs(perf): first 1000-user load test report` (+ loadtest scripts: `test(load): k6 mixed scenario and seed`).

---

## Self-review notes
- Every item in spec §3 has a task:
  - topology → Task 6
  - pool sizing and statement timeout → Tasks 1 and 6
  - index review / no N+1 → Task 4
  - cache → Task 3
  - semaphores and breakers, shared httpx → Tasks 5 and 1
  - jobs → Task 4
  - limits → existing, plus the demo semaphore
  - `/metrics`, JSON logs and request ids → Task 2 (structlog JSON already exists)
  - `/health` and `/ready` → Task 1
  - load test → Task 7
- Deviations, stated:
  - Demo generation stays synchronous behind a semaphore, because its UI contract is synchronous. Agent runs and price watches become jobs in steps 4 and 5, which reuse `jobs.enqueue`.
  - "AI runs per tenant" concurrency guard belongs to step 4.
- Ordering: 1 → (2, 3, 4, 5, any order, all backend; run sequentially in one checkout) → 6 → 7.
