# TravelMind

AI copilot for travel agencies and corporate travel: quotes from live supplier inventory,
every price verified against real offers, fare intelligence, policy and approvals.

> Status: Milestone 1 in progress. Plans 1 (backend foundation), 2 (Mission Control frontend), 3 (offers engine)
> and 4 (workspace and Command Center) are complete.

## Layout

| Path | What |
|---|---|
| `backend/` | FastAPI app (`src/travelmind`), Alembic migrations, tests |
| `frontend/` | React + TypeScript Mission Control app (Vite, Tailwind, TanStack Router/Query, react-globe.gl) |
| `infra/postgres/init.sql` | Creates DB roles (`travelmind_owner`, `travelmind_app`) and databases |
| `docker-compose.yml` | Postgres 16 + pgvector (port 5433), Redis 7 (port 6380) |
| `docs/superpowers/specs/` | Product/architecture spec |
| `docs/superpowers/plans/` | Implementation plans |

## Product tour

With the API and the frontend running (see [Run locally](#run-locally)), open http://localhost:5173/.

1. **Landing page** (`/`): what TravelMind does, with live platform figures (airports loaded, suppliers
   connected, routes with fare history) read from `GET /api/v1/platform/facts`.
2. **Explore live demo** (`/demo`): one click builds a private demo agency with a small team, sample clients,
   enquiries and quotes, priced with real sandbox searches, then opens its Command Center. The workspace is
   labelled "Demo workspace" throughout and is deleted after 7 days; **Exit demo** in the banner signs out
   and returns to the landing page. A demo can't invite people or change agency settings. Each IP can
   start 5 demos an hour (`TM_DEMO_MAX_PER_IP`).
3. **Command Center** (`/app`): key figures for the last 7, 30 or 90 days (open enquiries, quotes sent, win
   rate, pipeline value, response time, CO₂ quoted, searches), the enquiry pipeline, activity trends, a
   route globe, a live activity feed, market pulse (routes with the biggest fare moves), supplier health,
   the team leaderboard and upcoming departures. **New enquiry** captures a trip request and can add the
   client on the spot. The top bar has the command palette (Ctrl+K), which also finds clients, enquiries
   and quotes, and notifications; the account menu switches theme and signs out.
4. **Start free** (`/signup`): creates your own agency. The country (India or the United States for now)
   sets its currency and time zone. A new agency starts empty with a six-step setup checklist on the
   Command Center (agency details and sending quotes are marked as coming in the next release).

Fare scan, hotel scan, suppliers and the crew roster live under `/app/fares`, `/app/hotels`,
`/app/suppliers` and `/app/team`; the old top-level addresses (`/fares`, …) redirect there.

### API added for the workspace

All under `/api/v1` (browse them at http://localhost:8010/docs). Apart from `POST /demo` and
`GET /platform/facts`, each needs a session and sees only the signed-in user's agency.

| Endpoints | What |
|---|---|
| `GET, PATCH /agency` | Agency profile: name, country, currency, time zone, brand colour |
| `/clients`, `/enquiries`, `/quotes` | Clients, trip enquiries (with status changes) and quotes (versions, sending, the client's decision) |
| `GET /dashboard/{summary,pipeline,activity,market-pulse,supplier-health,team,departures}` | Command Center panels |
| `GET /onboarding`, `GET /notifications`, `POST /notifications/seen`, `GET /search?q=` | Setup checklist, notifications, record search |
| `POST /demo`, `POST /demo/exit` | Start a demo workspace (signs in as its presenter); leave it |
| `GET /platform/facts` | Public figures for the landing page |

## Run locally

Prerequisites: Docker Desktop, [uv](https://docs.astral.sh/uv/).

```bash
docker compose up -d --wait
cd backend
cp .env.example .env
uv sync
uv run python -m alembic upgrade head
uv run python -m travelmind.reference.cli import-ourairports
uv run uvicorn travelmind.main:create_app --factory --reload --port 8010
```

API docs: http://localhost:8010/docs

Ports: Postgres on 5433, Redis on 6380, the API on 8010 in development. Run Alembic as
`uv run python -m alembic` (as above).

### Frontend

Prerequisite: Node 24.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 (proxies /api and /health to http://localhost:8010)
```

Set `TM_API_TARGET` in `frontend/.env.local` if the API runs elsewhere.

### Suppliers and data

TravelMind runs without any supplier keys: a deterministic **sandbox** supplier serves demo flights
(labelled "Sandbox · not bookable"). Add keys to `backend/.env` to bring in real data:

| Variable | Source | What it adds |
|---|---|---|
| `TM_DUFFEL_TOKEN` | [Duffel](https://duffel.com) test token (`duffel_test_…`) | Real airline offers (test mode) with re-pricing |
| `TM_LITEAPI_KEY` | [LiteAPI](https://liteapi.travel) sandbox key (`sand_…`) | Hotel rates and cancellation terms |
| `TM_GOOGLE_TIM_API_KEY` | Google Cloud, Travel Impact Model API | Per-flight CO₂ per passenger |
| `TM_TRAVELPAYOUTS_TOKEN` | [Travelpayouts](https://travelpayouts.com) Data API | Market prices that seed fare history |

Every price carries its provenance — `LIVE`, `CACHED` (indicative) or `SANDBOX` — and prices converted
to the agency's currency are marked "≈" (ECB reference rates, display only). The Suppliers page shows
which links are connected. API notes: `docs/research/2026-09-29-supplier-apis.md`.

## Test

```bash
cd backend
uv run pytest            # needs docker compose services running
uv run ruff check . && uv run mypy src
```

```bash
cd frontend
npm test                 # unit + component tests (Vitest)
npm run lint && npm run typecheck
npm run e2e              # Playwright: demo, Command Center, golden path, sandbox fare scan. Needs the API
                         # running (on :8010, or set TM_API_TARGET) with TM_SIGNUP_MAX_PER_IP=1000 and
                         # TM_DEMO_MAX_PER_IP=1000 (tests sign up and start demos; the defaults are 10
                         # and 5 an hour). CI also sets TM_FX_ENABLED=false.
```

First e2e run: `npx playwright install chromium`.

Reset the local database completely: `docker compose down -v && docker compose up -d --wait`.

## Security model (short)

- Tenant data tables use Postgres row-level security (forced); the app connects as a role
  that cannot bypass it. Identity tables are only accessed through `travelmind.identity`.
- Sessions are opaque, revocable, httpOnly cookies; passwords use Argon2.
- Cross-site state-changing requests are rejected; login is rate limited.
