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
| `nginx` | `frontend/Dockerfile` (node:22-alpine build → nginx:1.29-alpine) | Serves the SPA, proxies `/api/`, `/health`, `/ready`. Config: `deploy/nginx/`. |
| `api` | `backend/Dockerfile` | `gunicorn 'travelmind.main:create_app()' -k uvicorn_worker.UvicornWorker -c gunicorn.conf.py`, non-root. |
| `worker` | same image | `arq travelmind.worker.WorkerSettings`: demo cleanup, quote expiry, queued jobs. |
| `migrate` | same image | `alembic upgrade head`, then exits. The api and worker wait for it. |
| `pgbouncer` | `edoburu/pgbouncer:v1.26.0-p0` | Transaction pooling, SCRAM auth, users `travelmind_app` and `travelmind_owner`. |
| `postgres` | `pgvector/pgvector:pg16` | Roles from `deploy/postgres/init.sql`. |
| `redis` | `redis:7-alpine` | `--maxmemory 256mb --maxmemory-policy volatile-lru`. |

## Run it

```bash
cp deploy/.env.example deploy/.env        # then change the passwords and the metrics token
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
bash deploy/smoke.sh                      # all checks must pass
docker compose -f deploy/docker-compose.yml down        # stop; keeps the data volumes
```

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

Only nginx publishes a port: **host 8080 → nginx 80**. Postgres, PgBouncer, Redis and the api
are reachable only on the compose network. That keeps clear of other stacks on this machine:
5432 and 6379 (another project), 5433 and 6380 (dev Postgres and Redis), 8010 and 5173 (dev API
and Vite).

### Secrets

Everything secret comes from `deploy/.env`, which is git-ignored. `deploy/.env.example` is the
committed template with dev placeholders only. The API containers get the app role's database
URL only; the owner (DDL) credentials go only to `migrate`, PgBouncer and Postgres.

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
              40 (travelmind_app) + at most 40 (travelmind_owner) = 80          ≤  200 − headroom
```

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

PgBouncer's admin console, for pool stats:

```bash
docker compose -f deploy/docker-compose.yml exec postgres \
  sh -c 'PGPASSWORD="$OWNER_DB_PASSWORD" psql -h pgbouncer -U travelmind_owner -d pgbouncer -c "SHOW POOLS"'
```

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
| `ready`, `health` | 200 through nginx |
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

Then run k6 (in a `grafana/k6` container on the `travelmind-prod_default` network):

```bash
K6_STAGES=smoke bash loadtest/run.sh     # 50 VUs, about 2 minutes
K6_STAGES=full bash loadtest/run.sh      # the 1000-VU ramp
K6_STAGES=200:1m,200:3m,0:30s bash loadtest/run.sh   # any "target:duration" list
```

Results go to `loadtest/results/` (only `*-summary.json` is committed). Reports live in
`docs/perf/`.
