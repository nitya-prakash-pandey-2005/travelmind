# Production-like stack

A local copy of the production topology, used for smoke checks and load tests:

```text
browser ──► nginx :8080 ──► api × API_REPLICAS ──► pgbouncer ──► postgres
            (SPA + proxy)    gunicorn, WEB_CONCURRENCY   (transaction   (pgvector pg16,
                             uvicorn workers each        pooling)        max_connections 200)
                                   │
                                   └──► redis (cache, rate limits, job queue) ◄── worker (arq)
migrate (one-shot): alembic upgrade head, owner role, straight to postgres
```

| Service | Image | Role |
|---|---|---|
| `nginx` | `frontend/Dockerfile` (node:24-alpine build → nginxinc/nginx-unprivileged:1.29-alpine) | Serves the SPA, proxies `/api/` and `/health`, answers `/ready` with a bare status. Runs as uid 101 on port 8080. Config: `deploy/nginx/`. |
| `api` | `backend/Dockerfile` | `gunicorn 'travelmind.main:create_app()' -k uvicorn_worker.UvicornWorker -c gunicorn.conf.py`, non-root. |
| `worker` | same image (built once, by `api`) | `arq travelmind.worker.WorkerSettings`: demo cleanup, quote expiry, queued jobs. |
| `migrate` | same image (built once, by `api`) | `alembic upgrade head`, then exits. The api and worker wait for it. |
| `pgbouncer` | `edoburu/pgbouncer:v1.26.0-p0` | Transaction pooling, SCRAM auth. Users: `travelmind_app`, and the read-only console user `travelmind_stats`. |
| `postgres` | `pgvector/pgvector:pg16` | Roles from `deploy/postgres/init.sql`. `shared_buffers` 256 MB, `work_mem` 8 MB, `pg_stat_statements`. |
| `redis` | `redis:7-alpine` | `--maxmemory 256mb --maxmemory-policy volatile-lru`. |

## Run it

```bash
cp deploy/.env.example deploy/.env        # then change the passwords and the metrics token
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
bash deploy/smoke.sh                      # all checks must pass
docker compose -f deploy/docker-compose.yml down        # stop; keeps the data volumes
```

**Low-memory machine:** build the images one at a time, then start without `--build`. A
parallel build (the Python install and the Vite build at once) can exhaust the Docker VM's memory
and take Docker Desktop down with every other container on it:

```bash
docker compose -f deploy/docker-compose.yml build api      # travelmind-prod/api:local
docker compose -f deploy/docker-compose.yml build nginx    # travelmind-prod/web:local
docker compose -f deploy/docker-compose.yml up -d
```

Only `api` and `nginx` have a `build:` section. `migrate` and `worker` run the api image
(`image: travelmind-prod/api:local`, `pull_policy: never`), so the image is built once, not three
times in parallel. If it hasn't been built yet, `up` without `--build` fails on those two instead
of pulling: run `build api` first.

- The compose project is `travelmind-prod`, with its own volumes (`travelmind-prod_pgdata`,
  `travelmind-prod_redisdata`). It shares nothing with the dev stack (`docker-compose.yml` at
  the repo root, project `travelmind`).
- `docker compose -f deploy/docker-compose.yml down -v` also deletes this stack's database and
  Redis data. The roles in `init.sql` are only created on a fresh volume.
- Reference data (airports and countries) is optional. To load it:
  `docker compose -f deploy/docker-compose.yml run --rm migrate python -m travelmind.reference.cli import-ourairports`
  (the migrate service has the owner URL; the import downloads the OurAirports CSVs).
- Real supplier keys go in `deploy/.env`. Without them the sandbox supplier serves demo flights
  (`TM_SANDBOX_SUPPLIER=true` in the template).
- Session cookies are not `Secure` here (`TM_COOKIE_SECURE=false`), because the stack is plain
  HTTP on localhost. Anywhere else, put HTTPS in front of nginx, set `TM_COOKIE_SECURE=true` and
  change `TM_ALLOWED_ORIGINS` in the compose file.

### Ports

Only nginx publishes a port: **host 8080 → nginx 8080** (the unprivileged nginx listens on 8080;
on the compose network it is `http://nginx:8080`). Postgres, PgBouncer, Redis and the api
are reachable only on the compose network. That keeps clear of other stacks on this machine:
5432 and 6379 (another project), 5433 and 6380 (dev Postgres and Redis), 8010 and 5173 (dev API
and Vite).

### Secrets

Everything secret comes from `deploy/.env`, which is git-ignored. `deploy/.env.example` is the
committed template with dev placeholders only. The API containers get the app role's database
URL only; the owner (DDL) credentials go only to `migrate` and Postgres. PgBouncer gets the app
password and its own console password (`PGBOUNCER_STATS_PASSWORD`).

`deploy/postgres/init.sql` stops with an error if `APP_DB_PASSWORD` or `OWNER_DB_PASSWORD` is
missing or empty (compose refuses to start without them too); it never falls back to dev
passwords. A failed init leaves the volume half-created and later starts skip the script, so fix
`deploy/.env` and recreate the volume (`down -v`).

### Container hardening

- `api`, `worker`, `migrate`, `pgbouncer` and `nginx` run as non-root users from the start, with
  `cap_drop: [ALL]` and `no-new-privileges` (the `x-hardening` block in the compose file).
- nginx is `nginxinc/nginx-unprivileged`: uid 101, port 8080, pid and temp files in `/tmp`.
- Postgres and Redis keep Docker's defaults: their entrypoints start as root to chown the data
  directory, then drop to their own user.

## Scaling

- `API_REPLICAS` (default 2): api containers. nginx re-resolves `api` through Docker's DNS every
  10 s, so `docker compose ... up -d --scale api=N` is picked up without a reload.
- `WEB_CONCURRENCY`: gunicorn workers per container. Empty means `min(2 × CPUs + 1, 8)`.
- On a low-memory machine: `API_REPLICAS=1 WEB_CONCURRENCY=2` (shell variables override
  `deploy/.env`).
- The arq worker runs one container. Its cron jobs are unique per tick, so more worker
  containers would not run a schedule twice.

## Connection pool math

Each process (gunicorn worker or arq worker) has its own SQLAlchemy pool of
`TM_DB_POOL_SIZE + TM_DB_MAX_OVERFLOW` (10 + 5) connections to PgBouncer. PgBouncer multiplexes
them onto a small number of Postgres connections, holding a server connection only for the length
of a transaction.

```text
client side:  API_REPLICAS × WEB_CONCURRENCY × (pool + overflow) + worker pool  ≤  MAX_CLIENT_CONN
              2 × 8 × (10 + 5) + 15 = 255                                       ≤  2000
server side:  DEFAULT_POOL_SIZE per (database, user)                            ≤  max_connections − headroom
              40 (travelmind_app)                                               ≤  200 − headroom
```

Only `travelmind_app` goes through PgBouncer: the owner is not in its userlist (migrations connect
straight to Postgres), and the stats user only reaches the `pgbouncer` console database.

Headroom covers Postgres's reserved superuser slots, migrations (which connect directly) and admin
sessions. When you raise replicas or workers, check the first line. When you raise
`DEFAULT_POOL_SIZE`, check the second line, and remember that Postgres throughput stops improving
well before 200 busy connections.

Transaction pooling rules the app follows (`TM_DB_PGBOUNCER=true`):

- The tenant is bound per transaction (`set_config('app.agency_id', ..., true)`), never with a
  session-level `SET`.
- asyncpg's and SQLAlchemy's prepared statement caches are off, and statements get unique names.
- `statement_timeout` can't be sent as a startup parameter through PgBouncer, so it is set on the
  role: `ALTER ROLE travelmind_app SET statement_timeout = '5s'` (`init.sql`). The arq worker
  raises it per transaction (`SET LOCAL`).

`QUERY_WAIT_TIMEOUT=10`: a client that waits 10 s for a server connection gets an error instead
of queueing for PgBouncer's default 120 s. The app's own pool gives up after 5 s, so this only
bounds clients that are already stuck.

PgBouncer's console, for pool stats, as the read-only stats user (`STATS_USERS`). It can run
`SHOW ...` but not `PAUSE`, `RELOAD` or `SHUTDOWN`; there is no admin user. The pgbouncer
container has `psql` and the password:

```bash
docker compose -f deploy/docker-compose.yml exec pgbouncer \
  sh -c 'PGPASSWORD="$PGBOUNCER_STATS_PASSWORD" psql -h 127.0.0.1 -U travelmind_stats -d pgbouncer -c "SHOW POOLS"'
```

## Postgres settings

Set as command flags in the compose file, sized for a laptop that runs the whole stack plus k6:

| Setting | Value | Why |
|---|---|---|
| `max_connections` | 200 | PgBouncer uses at most 40 for the app; the rest is headroom. |
| `shared_buffers` | 256 MB (`PG_SHARED_BUFFERS`) | Up from the 128 MB default: more of the hot tables stay in Postgres's own cache, still within a laptop's memory. |
| `work_mem` | 8 MB (`PG_WORK_MEM`) | Per sort or hash step, per connection: 40 pooled connections × 8 MB = 320 MB in the unusual case that all of them sort at once. |
| `shm_size` | 256 MB | Parallel query workers share memory through `/dev/shm` (Docker's default is 64 MB). |
| `shared_preload_libraries` | `pg_stat_statements` | Per-query statistics (below). |

On a real server, size `shared_buffers` to about a quarter of the database host's RAM and keep
`work_mem × pooled connections` well inside what is left. Changing a flag needs a container
restart (`up -d` recreates it), not a new volume.

### pg_stat_statements

The server preloads the library and `init.sql` creates the extension in `travelmind`. On a volume
created before that, create it once:

```bash
docker compose -f deploy/docker-compose.yml exec postgres \
  psql -U postgres -d travelmind -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
```

Read it as the `postgres` superuser (the app role only sees its own statements' text):

```bash
docker compose -f deploy/docker-compose.yml exec postgres psql -U postgres -d travelmind -c "
  SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms,
         rows, left(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query
  FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20"
# Before a load test, start from zero:
docker compose -f deploy/docker-compose.yml exec postgres \
  psql -U postgres -d travelmind -c 'SELECT pg_stat_statements_reset()'
```

Queries are stored normalised (`$1` in place of literals), so no parameter values are kept.

## Client IP and rate limits

The per-IP limits (login, signup, demo, public quote) key on `request.client.host`. Behind nginx
that is the visitor's address because:

- nginx sets `X-Forwarded-For $remote_addr`, which **replaces** anything the client sent
  (`deploy/nginx/proxy.conf`);
- gunicorn's `forwarded_allow_ips = "*"` (`backend/gunicorn.conf.py`) lets the uvicorn workers
  apply that header. Trusting every peer is safe only because nothing but nginx can reach the api.
  Narrow `FORWARDED_ALLOW_IPS` if that ever changes.

`smoke.sh` (`nginx_forwards_real_ip`) sends a spoofed `X-Forwarded-For: 1.2.3.4` and checks that
the login limiter key carries the address nginx logged, not the spoofed one and not nginx's own.

**Behind a load balancer or CDN**, the address that connects to nginx is the balancer's, so every
visitor would share one set of per-IP limits. Uncomment the `real_ip` block in
`deploy/nginx/nginx.conf` and list the balancer's own addresses:

```nginx
set_real_ip_from 10.0.0.0/8;          # only the balancer's addresses, never 0.0.0.0/0
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

nginx then takes the visitor's address from the balancer's `X-Forwarded-For` (only when the
request comes from a listed address), and `proxy.conf` passes that address on. A CDN may use its
own header instead (for example `CF-Connecting-IP`); use that as `real_ip_header` and list the
CDN's published ranges.

**Docker Desktop (Windows, macOS):** published ports go through Docker Desktop's port proxy, so
every client of `localhost:8080` reaches nginx from the same gateway address (for example
`172.x.0.1` or `192.168.65.1`). All local clients then share the per-IP limits. On a Linux host,
published ports keep the client address.

## Public endpoints and logs

- **`/ready`** through nginx answers only `200 ok` or `503 not ready` (plain text, `no-store`).
  nginx runs the api's real `/ready` as an `auth_request` subrequest and drops its JSON, which
  names the dependency that is down. The compose healthcheck calls the api's own `/ready` inside
  the container. `/health` is proxied as before.
- **Share tokens never reach nginx's logs.** The access log writes `/q/<token>` and
  `/api/v1/public/quotes/<token>` for the two token locations (chosen by location, so encoded or
  doubled slashes are masked too). nginx's error log copies the request line into every entry,
  so those two locations send their error log to `/dev/null`. The global error log stays at
  `warn`, because upstream errors elsewhere (connect failures, timeouts) are worth seeing. The
  choice against a global `crit` level: it would hide those too, while a per-location
  `/dev/null` covers exactly the token paths. Errors nginx logs before a location is chosen
  (malformed request lines, oversized headers) are `info` level, below `warn`.

## Metrics

nginx answers `/metrics` with 404. Prometheus metrics are scraped inside the network, with the
token from `deploy/.env` (gunicorn workers are merged through `PROMETHEUS_MULTIPROC_DIR`):

```bash
docker compose -f deploy/docker-compose.yml exec api \
  sh -c 'python -c "import os,urllib.request as u; print(u.urlopen(u.Request(\"http://127.0.0.1:8000/metrics\", headers={\"Authorization\": \"Bearer \" + os.environ[\"TM_METRICS_TOKEN\"]})).read().decode())"'
```

## Smoke checks

`bash deploy/smoke.sh [base_url]` (default `http://localhost:8080`). It needs bash, curl and
docker, and exits non-zero on any failure.

| Check | Expectation |
|---|---|
| `spa_root` | `/` → 200 with `<div id="root">` |
| `security_headers` | `nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-cache` on the shell |
| `static_assets` | a hashed `/assets/*.js` is `immutable` and gzipped |
| `ready` | 200 through nginx, body exactly `ok` |
| `health` | 200 through nginx |
| `metrics_hidden` | `/metrics` → 404 |
| `quote_link_headers` | `/q/<token>` → 200 SPA with `X-Robots-Tag: noindex, nofollow` and a single `Referrer-Policy: no-referrer` |
| `nginx_forwards_real_ip` | see above |
| `pgbouncer_tenant_isolation` | `pgbouncer_smoke.sh`: two agencies signed up through nginx, one client each, 50 alternating reads plus 50 concurrent reads. Every read is 200 and each agency sees only its own client. `SHOW POOLS` shows a transaction-mode `travelmind_app` pool. |

Each run signs up two throwaway agencies (`smoke-*@example.com`). The default signup limit is 10
per IP per hour, so about five runs an hour fit.

## Load tests

All virtual users come from one source IP, so the per-IP limits (and the per-agency search and
price-check budgets) must be raised for a load test, and only then. The overrides live in a
separate env file passed after the main one. `deploy/.env.loadtest.example` is the committed
template; the copy you run with, `deploy/.env.loadtest`, is git-ignored. Test only: never use it
in a real deployment.

```bash
cp deploy/.env.loadtest.example deploy/.env.loadtest
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --env-file deploy/.env.loadtest up -d
```

The compose file passes these `TM_*` overrides (and `TM_DB_POOL_SIZE` / `TM_DB_MAX_OVERFLOW`)
through to the api and worker only when they are set.

Seed the load-test accounts (50 agencies × 4 users, each agency with a month of clients,
enquiries, quotes and activity, plus one client share link). The database is only reachable on
the compose network, so the script runs in a worker container. It refuses to run against
`TM_ENVIRONMENT=production` without `--i-know`:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --env-file deploy/.env.loadtest   run --rm --no-deps -v "$PWD/loadtest:/loadtest" worker   python /loadtest/seed.py --i-know --agencies 50 --users-per-agency 4 --out /loadtest/users.json
```

The password is `LOADTEST_PASSWORD` (default `loadtest-pass-2026`, test only). The script writes
`loadtest/users.json` (git-ignored): emails and share tokens, never the password. Run it again
to reuse the same agencies and mint fresh share links.

Then run k6 (in a `grafana/k6` container on the `travelmind-prod_default` network). nginx listens
on 8080 inside the network, so the target is `http://nginx:8080`; until `loadtest/` defaults to
it, pass `BASE_URL=http://nginx:8080` to `run.sh`:

```bash
export BASE_URL=http://nginx:8080
K6_STAGES=smoke bash loadtest/run.sh     # 50 VUs, about 2 minutes
K6_STAGES=full bash loadtest/run.sh      # the 1000-VU ramp
K6_STAGES=200:1m,200:3m,0:30s bash loadtest/run.sh   # any "target:duration" list
```

`run.sh` also samples `SHOW POOLS` as the owner role, which PgBouncer no longer accepts; that
sample now prints an authentication error (the run carries on) until it switches to the
`travelmind_stats` command above.

Results go to `loadtest/results/` (only `*-summary.json` is committed). Reports live in
`docs/perf/`.
