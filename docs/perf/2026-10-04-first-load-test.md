# First load test: production-like stack on a laptop

Date: 2026-10-04. Scope: v3 step 3, Task 7 (spec §3 load-test targets).

## Summary

- **The stack held 500 concurrent virtual users and met every target there.**
  - Read p95 was 242 ms, search p95 272 to 276 ms, and there were no errors.
  - This was reproduced in two runs (runs 5 and 6 below).
- **1000 users is not reachable on this machine.**
  - At 750 VUs the four API workers were pinned at about 390% CPU. Read p95 rose to 2.4 s.
  - At 1000 VUs read p95 was 5.0 s and 1.5% of requests failed. The failures were 503s when the app's SQLAlchemy pools (60 of 60) timed out after 5 s.
  - Each 1000-VU attempt was stopped by the memory guard once host free RAM fell below 400 MB. The best one held 1000 VUs for about 60 s.
- **The limiting resource is API CPU.** Gunicorn's worker count is in turn capped by the laptop's RAM.
  - Only 1 replica × 4 workers fit next to the dev stack, k6 and the owner's desktop apps.
  - Postgres was not the bottleneck: at most about 1.5 cores, and about 1.3 ms of execution time per HTTP request.
  - PgBouncer queues stayed short: at most 19 waiting clients in any sample, and the longest wait was 75 ms.
- **No code fixes were made.** The profile shows no single hotspot that a small change would move. The knee comes from the number of workers. Findings are listed as next work.

## Machine

| | |
|---|---|
| CPU | Intel Core i7-1355U (13th gen, 15 W U-series): 10 cores (2 performance + 8 efficient), 12 threads, 1.7 GHz base |
| RAM | 15.7 GB total. **About 1 to 2 GB free** during the tests, because the owner's desktop apps (browsers, editor) stayed open. |
| OS | Windows 11 Home Single Language 10.0.26300 |
| Docker | Docker Desktop, engine 29.6.1, WSL2 kernel 6.18.33.2. The VM had 12 CPUs and 7.6 GiB. |
| Also running | The dev stack: Postgres and Redis containers (Postgres used 150 to 190 MiB), the dev API on :8010 and Vite on :5173. All kept running. |

Everything ran on the one laptop and shared its CPU and RAM: the stack, k6 and the dev stack. A
15 W laptop CPU also throttles under sustained load. Treat the absolute numbers as a lower bound.

## Stack configuration

- `deploy/docker-compose.yml` (Task 6) unchanged, started with `API_REPLICAS=1 WEB_CONCURRENCY=4`
  and `--env-file deploy/.env --env-file deploy/.env.loadtest`, without `--build`.
- **nginx** proxies to one api container: gunicorn with 4 uvicorn workers.
- **SQLAlchemy pool:** 10 + 5 overflow per process, so 60 client connections from the API and 15 from the arq worker.
- **PgBouncer:** transaction mode, `DEFAULT_POOL_SIZE=40`, `MAX_CLIENT_CONN=2000`, default `query_wait_timeout` (120 s).
- **Postgres** 16 (pgvector image): `max_connections=200`, defaults otherwise (`shared_buffers` 128 MB, `work_mem` 4 MB). The app role has `statement_timeout` 5 s.
- **Redis** 7: `maxmemory 256mb`, `volatile-lru`.
- **Sandbox flight supplier** only: no outbound supplier calls.
- **Load-test overrides** (`deploy/.env.loadtest.example`): every per-IP limit and the per-agency search and price-check budgets set to 100000, because all VUs share one source IP. Test only.
- **pg_stat_statements:**
  - Enabled for runs 5 and 6 only, with `ALTER SYSTEM` and a Postgres restart, not in the compose file.
  - Afterwards it was reset and the extension dropped.
  - The deploy fix round should decide whether compose enables it.

## Data and workload

- **Seed:** `loadtest/seed.py`, 50 agencies × 4 users.
  - Each agency got a month of work through the services. Agency 000 got 40 clients, 60 enquiries, 35 quotes, 89 sandbox searches and 517 activity events. The plan is seeded per agency, so the others are similar.
  - Each agency also got one client share link.
  - Seeding took 81 s.
- **Data at the end** (it grows with every run's writes): 56 agencies, 206 users, 2,006 clients, 22,184 enquiries, 1,750 quotes, 178,743 activity events, 61,674 flight searches and 270,664 fare snapshots.
- **k6 v2.3.0** in a `grafana/k6` container on `travelmind-prod_default`, targeting `http://nginx`.
  - Docker was used because k6 isn't installed natively.
  - Docker avoids Docker Desktop's Windows port proxy.
  - The memory is the same either way, because k6's memory is its VUs.
- **The mix** (`loadtest/k6/mixed.js`): one action per iteration, then 1 to 3 s of think time.

  | Share | Kind | Requests |
  |---|---|---|
  | 30% | public | `/`, platform facts, client quote page |
  | 45% | read | dashboard summary, pipeline and activity; quotes, enquiries and clients lists; airport lookup |
  | 15% | search | sandbox flight search, then one reprice (tagged `reprice`) |
  | 10% | write | create enquiry or update client |

  - Steady state was about 0.52 requests/s per VU.
  - The VUs share 200 sessions, signed in during `setup()`.
- **Thresholds:**
  - `http_req_duration{kind:read}` p(95)<300
  - `{kind:public}` p(95)<300
  - `{kind:search}` p(95)<2500
  - `http_req_failed` rate<0.01
  - no 401 or 429 responses
- **Memory guard:** `loadtest/run.sh` stops k6 (SIGTERM, so the summary is still written) when host free RAM drops below 400 MB.

## Runs

The plan's single ramp (0→200→500→1000, then a 5 min hold) cannot finish here. Instead, VU levels
were held in steps, with holds shortened to 2 to 3 min. Every request is tagged with the hold level it ran in.

| # | Run (`loadtest/results/…-summary.json`) | Stages | Outcome |
|---|---|---|---|
| 1 | `smoke` | 50 VUs, 1 min hold | All thresholds pass. No 401 or 429. |
| 2 | `steps-w4` (no summary) | 200 / 500 / 1000, 3 min holds | Guard killed k6 at about 800 VUs on the ramp, with 377 MB free. The guard then used SIGKILL, so no summary. Changed to SIGTERM. |
| 3 | `ladder-w4` | 200 / 500 / 750 | 200 passes. **500 fails** (read p95 1,360 ms). Guard stopped it about 64 s into 750, with 258 MB free. |
| 4 | `ladder2-w4` | 300 / 400 | 300 passes p95 (read 214 ms), but a 30 s stall at the start gave 0.15% errors. **400 fails** (read p95 572 ms). |
| 5 | `ladder3-w4` | 200 / 300 / 400 / 500, 2.5 min holds | **All pass at every level.** k6 exit 0. |
| 6 | `high-w4` | 500 / 750 / 1000, 2 to 2.5 min holds | 500 passes again. **750 fails. 1000 fails.** Guard stopped it about 60 s into the 1000 hold, with 392 MB free. |

**Runs 3 and 4 were much slower than runs 5 and 6 at the same VU level.**
- At 500 VUs, read p95 was 1,360 ms in run 3 and 242 ms in runs 5 and 6.
- The API spent about 17 ms of CPU per request in run 3, against about 11.6 ms in run 5.
- Runs 3 and 4 had less host memory free: 500 to 900 MB, against 1.2 to 1.7 GB.
- Run 3 also had k6 preallocating 1000 VUs.
- Run 5 started on a freshly restarted Postgres.

I can't separate host memory pressure, laptop throttling and the Postgres restart. The verdict
below uses runs 5 and 6, which agree with each other. Runs 3 and 4 show how much worse it gets when
the machine is contended.

### Results per kind at the highest stable level: 500 VUs (run 5, 150 s hold)

Total: 38,725 requests, **258 requests/s**, 0 errors. Run 6's 500-VU hold matched it: 259.5 requests/s, read p95 242 ms, search p95 276 ms, every p95 within 15%, 0 errors.

| Kind | p50 | p95 | p99 | Errors | RPS |
|---|---:|---:|---:|---:|---:|
| public | 5 ms | 173 ms | 422 ms | 0% | 67.6 |
| read | 43 ms | **242 ms** | 442 ms | 0% | 100.7 |
| search | 65 ms | **272 ms** | 437 ms | 0% | 33.7 |
| reprice | 39 ms | 203 ms | 326 ms | 0% | 33.7 |
| write | 59 ms | 285 ms | 437 ms | 0% | 22.5 |

### Lower levels (run 5)

| VUs | RPS | read p95 | search p95 | public p95 | write p95 | Errors |
|---:|---:|---:|---:|---:|---:|---:|
| 50 (smoke, run 1) | 26.9 | 41 ms | 38 ms | 29 ms | 29 ms | 0% |
| 200 | 106.1 | 67 ms | 60 ms | 46 ms | 56 ms | 0% |
| 300 | 157.6 | 81 ms | 86 ms | 58 ms | 77 ms | 0% |
| 400 | 210.8 | 97 ms | 88 ms | 71 ms | 81 ms | 0% |
| 500 | 258.2 | 242 ms | 272 ms | 173 ms | 285 ms | 0% |

### Beyond the knee: 750 and 1000 VUs (run 6)

| Kind | 750: p50 / p95 / p99 | 750 errors | 1000: p50 / p95 / p99 | 1000 errors |
|---|---|---:|---|---:|
| public | 17 / 1,394 / 2,205 ms | 0.009% | 18 / 3,097 / 4,895 ms | 0.58% |
| read | 686 / **2,431** / 3,792 ms | 0.041% | 1,883 / **5,037** / 6,813 ms | 1.83% |
| search | 641 / **1,810** / 2,726 ms | 0% | 1,753 / **4,322** / 5,036 ms | 1.78% |
| reprice | 571 / 1,688 / 2,623 ms | 0% | 1,655 / 3,990 / 5,027 ms | 1.68% |
| write | 654 / 1,833 / 2,899 ms | 0.08% | 1,778 / 4,339 / 5,039 ms | 2.55% |
| **total** | **293.6 requests/s** | **0.025%** | **about 280 requests/s** | **1.53%** |

- **Throughput peaked at about 290 requests/s.** Above 500 VUs, extra users only added latency.
- **The 1000-VU RPS is estimated:**
  - The hold ran about 62 s of its planned 150 s: 17,444 requests in about 62 s.
  - This run's summary file divides by the planned 150 s.
  - Summaries written after run 6 use the observed hold length (`hold_seconds`).
  - Run 3's 750 figure in its JSON has the same caveat. It actually ran about 64 s, which gives about 265 requests/s.
- **The errors at 1000 VUs** were 270 HTTP 503s in the last 90 s, all `db_pool_exhausted`: the SQLAlchemy `pool_timeout` of 5 s expired.

## Database pool and PgBouncer at each stage

PgBouncer's `SHOW POOLS` (`travelmind_app`) and the app's `db_pool_checked_out` gauge were sampled every ~19 s.
`maxwait` was 0 s in every sample. The `maxwait_us` column is the microsecond part.

| Stage | cl_waiting | maxwait | sv_active / 40 | Postgres client connections (of 200) | App pools checked out (of 60) |
|---|---|---|---|---|---|
| 200 (run 5) | 0 | 0 | 0–2 | ≤ 41 | 0–3 |
| 300 (run 5) | 0, plus one sample of 7 at the ramp to 400 | ≤ 41 ms | ≤ 6 (33 in that sample) | ≤ 41 | 0 |
| 400 (run 5) | 0 | 0 | ≤ 21 | ≤ 41 | 1–2 |
| 500 (runs 5 and 6) | 0, plus one sample of 19 | ≤ 24 ms | 4–40 | ≤ 41 | 15–26 |
| 750 (run 6) | 14–17 in every sample | 21–50 ms | **40/40** | ≤ 41 | **59–60** |
| 1000 (run 6) | 15–18 | 16–17 ms | **40/40** | 41: **36 "idle in transaction"**, 5 active | **59–60** |

Postgres client connections are PgBouncer's 40 server connections plus the sampler's own `psql`.
The app pool numbers come from `/metrics`, scraped about once a minute.

At the 1000-VU peak, `SHOW POOLS` read: `cl_active 45, cl_waiting 17, sv_active 40, sv_idle 0, maxwait 0, maxwait_us 16363, transaction`.

PgBouncer did **not** queue clients for long. The concern from the Task 6 review (overload as long
PgBouncer waits under the 120 s `query_wait_timeout`) did not occur. Overload showed up in three other places:
- the API workers' event loops;
- the app-side SQLAlchemy pools, which waited up to 5 s and then returned 503;
- server connections held "idle in transaction" while their CPU-starved workers did other work.

## CPU and memory per container

These are single `docker stats` samples. `api` is one container running 4 workers, so 400% is its ceiling.

| Container | 500 VUs (run 5) | 750 VUs (run 6) | 1000 VUs (run 6) |
|---|---|---|---|
| api (4 workers) | 303% · 428 MiB | **392%** · 465 MiB | **397%** · 467 MiB |
| postgres | 86% · 552 MiB | 156% · 599 MiB | 153% · 607 MiB |
| pgbouncer | 63% · 10.7 MiB | 62% · 10.7 MiB | 63% · 10.8 MiB |
| nginx | 11% · 31 MiB | 11% · 35 MiB | 10% · 41 MiB |
| redis | 6% · 283 MiB | 10% · 285 MiB | 7% · 286 MiB |
| worker (arq) | 0.1% · 70 MiB | 0.1% · 70 MiB | 0.1% · 71 MiB |
| k6 | 34% · 391 MiB | 107% · 690 MiB | 37% · 735 MiB |
| host free RAM | 1,605 MB | 735 MB | 721 MB, then 480, then **392 (guard)** |

In run 5, `pg_stat_statements` counted 1.36 M statements and 197.5 s of execution time over the
whole ladder (about 150 k HTTP requests). That is about 9 statements and **about 1.3 ms of database time
per HTTP request**: Postgres averaged well under one core.

## Bottlenecks found

1. **API CPU, and through it the worker count.**
   - The API costs about 11 to 12 ms of CPU per request in clean runs and about 17 ms in contended ones.
   - Four workers therefore top out at about 260 to 290 requests/s. They were pinned from 750 VUs on.
   - A py-spy profile of one worker at about 300 VUs found no single hotspot.
     - Shares below are of the worker's on-CPU samples, inclusive, so they overlap. About 21% of samples were the idle event loop.
     - FastAPI dependency solving: 15%. This includes the session-to-user lookup on every authenticated request, at 8%.
     - SQLAlchemy ORM execute: about 15%.
     - The middleware stack itself: about 6%.
     - asyncpg statement prepare: about 4%. There is no statement cache under PgBouncer, so every statement is prepared again.
     - Building a new `Redis` client object per request (`get_shared_redis`): about 2%.
2. **Transactions span the whole request.**
   - The auth lookup opens the transaction, and the session closes only at the end of the request.
   - When workers are CPU-starved, server connections sit "idle in transaction": 36 of 40 at 1000 VUs.
   - App pools then run dry (60 of 60) and requests fail after `pool_timeout` (5 s) with 503.
   - This is the "DB connection exhaustion" failure. It is in the app pools, not in Postgres, which used at most 41 of 200 connections.
3. **Redis fills with the offer store.**
   - Every search stores each offer (`offer:<agency>:<id>`, about 1.8 KB, TTL 30 min).
   - At 25 to 35 searches/s this fills the 256 MB `maxmemory` in about 8 minutes: 120 k keys and 27 k evictions in the first long run.
   - Under `volatile-lru` the same evictions also take dashboard cache entries.
4. **The dashboard read cache rarely hits under this mix.** Summary had 3,197 hits against 10,050 misses, and pipeline had a similar ratio.
   - A search invalidates its agency's cache at most every 5 s (by design, commit e74d74a).
   - With 50 agencies and 15% search traffic, most dashboard reads land just after an invalidation.
5. **A sign-in burst costs memory.**
   - argon2 uses about 64 MiB per verification, up to 4 at once per worker.
   - With k6 signing in 20 users at a time, the API went from 425 to 745 MiB. In one run, host free RAM fell to about 250 MB during setup.
   - k6 now signs in 4 at a time.
   - A real sign-in storm, for example after a session purge, costs up to about 256 MiB per worker. Container memory limits need to allow for it.
6. **A 30 s stall at the start of run 4.** It happened when traffic resumed after a few minutes of idle, before pg_stat_statements was on, so the cause is still unknown.
   - Postgres jumped to about 1,000% CPU for two samples.
   - 503s followed (`db_pool_exhausted`, 5 s).
   - It did not recur in runs 5 and 6, after a Postgres restart.
7. **k6 itself is heavy here.** It preallocates its VUs: about 0.65 to 0.75 GB at 1000 VUs and 30–40% CPU, on the same laptop as the stack.

## Verdict per target

Spec §3 targets, measured at 1000 VUs. Only about 60 s of the 1000-VU hold was possible here.

| Target | 1000 VUs | 750 VUs | 500 VUs (highest stable) |
|---|---|---|---|
| read p95 < 300 ms | **FAIL** (5,037 ms) | **FAIL** (2,431 ms) | **PASS** (242 ms) |
| search p95 < 2.5 s | **FAIL** (4,322 ms) | PASS (1,810 ms) | **PASS** (272 ms) |
| error rate < 1% | **FAIL** (1.53%) | PASS (0.025%) | **PASS** (0%) |
| no DB connection exhaustion | **FAIL**: app pools 60/60, 503s after 5 s; PgBouncer 40/40 with 15–18 waiting; Postgres 41 of 200 | **FAIL**: app pools 59–60/60, PgBouncer 40/40 with 14–17 waiting | **PASS**: app pools ≤ 26/60, PgBouncer queue at most 19 for ≤ 24 ms |

The 1000-user goal is **not proven** on this hardware. Spec §3 allows reporting the highest stable
level and the limiting resource instead. Those are **500 VUs**, limited by **API CPU (4 gunicorn
workers), which the laptop's free RAM capped**.

## What production-class hardware changes

This section extrapolates linearly from the measurements above. None of it was measured.

- **Worker count is the lever.**
  - The default topology is `API_REPLICAS=2` × 8 workers = 16 workers, 4× this test.
  - 1000 VUs at this mix need about 520 requests/s (0.52 per VU).
  - At about 12 ms of CPU per request that is about 6 busy cores.
  - 16 workers on at least 16 dedicated vCPUs give about 2× headroom, enough that the event loops never starve.
- **The pool math holds once workers aren't starved.**
  - At about 1.3 ms of database time per request, 520 requests/s keeps about 0.7 server connections busy on average.
  - PgBouncer's 40 is ample.
  - Client side: 16 × 15 + 15 = 255 connections, against `MAX_CLIENT_CONN=2000`.
- **Postgres** on its own host or a managed instance, with `shared_buffers` sized to the data. It used only about 1.5 cores here.
- **Redis:** `maxmemory` of at least 1 GB, or a separate offer store, so search traffic doesn't evict the dashboard cache.
- **k6 on a separate machine,** so the generator doesn't share CPU and RAM with the system under test.
- **A clean re-run of the plan's ramp** (to 1000, then a 5 min hold) on that hardware is what would prove the target.

## Next work

These are not fixed here. Each needs a profile-backed change of its own.

1. **Hold a DB connection only while it is needed.** Commit or close the auth lookup's transaction before the endpoint's own work. Also consider a shorter `pool_timeout` together with load shedding (a fast 503 instead of a 5 s wait).
2. **Per-request CPU:**
   - reuse one `Redis` client per process instead of one per request;
   - trim the middleware stack;
   - use Core instead of ORM for the hot read paths (lists, dashboard);
   - cache the session-to-user lookup briefly.
3. **Redis sizing or separation for the offer store** (deploy fix round). Revisit the search-driven dashboard invalidation, which costs most of the cache's hit rate.
4. **Enable `pg_stat_statements` and `log_min_duration_statement` in the deploy compose.** That would catch a stall like run 4's.
5. **The fare-insight percentile query** (`percentile_cont` over `fare_snapshots`) is the top statement by database time: 30%, 6.2 ms mean. It grows with fare history (270 k rows by the end of the test).

## Reproducing

```bash
cp deploy/.env.loadtest.example deploy/.env.loadtest
API_REPLICAS=1 WEB_CONCURRENCY=4 docker compose -f deploy/docker-compose.yml \
  --env-file deploy/.env --env-file deploy/.env.loadtest up -d
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --env-file deploy/.env.loadtest \
  run --rm --no-deps -v "$PWD/loadtest:/loadtest" worker \
  python /loadtest/seed.py --i-know --agencies 50 --users-per-agency 4 --out /loadtest/users.json
K6_STAGES=smoke bash loadtest/run.sh
LT_STAGES=200:1m,200:150s,300:1m,300:150s,400:1m,400:150s,500:1m,500:150s,0:30s \
  RUN_ID=ladder bash loadtest/run.sh
docker compose -f deploy/docker-compose.yml down     # keeps the volumes
```

Raw output stays in `loadtest/results/` and is git-ignored: the k6 log, `docker stats`, `SHOW POOLS`
and Postgres samples, and `/metrics` scrapes. The per-run `*-summary.json` files are committed.
