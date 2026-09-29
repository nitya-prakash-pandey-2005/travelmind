# TravelMind

AI copilot for travel agencies and corporate travel: quotes from live supplier inventory,
every price verified against real offers, fare intelligence, policy and approvals.

> Status: Milestone 1 in progress. Plans 1 (backend foundation) and 2 (Mission Control frontend) are complete.

## Layout

| Path | What |
|---|---|
| `backend/` | FastAPI app (`src/travelmind`), Alembic migrations, tests |
| `frontend/` | React + TypeScript Mission Control app (Vite, Tailwind, TanStack Router/Query, react-globe.gl) |
| `infra/postgres/init.sql` | Creates DB roles (`travelmind_owner`, `travelmind_app`) and databases |
| `docker-compose.yml` | Postgres 16 + pgvector (port 5433), Redis 7 (port 6380) |
| `docs/superpowers/specs/` | Product/architecture spec |
| `docs/superpowers/plans/` | Implementation plans |

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
npm run e2e              # Playwright golden path; needs the API running on :8010
```

First e2e run: `npx playwright install chromium`.

Reset the local database completely: `docker compose down -v && docker compose up -d --wait`.

## Security model (short)

- Tenant data tables use Postgres row-level security (forced); the app connects as a role
  that cannot bypass it. Identity tables are only accessed through `travelmind.identity`.
- Sessions are opaque, revocable, httpOnly cookies; passwords use Argon2.
- Cross-site state-changing requests are rejected; login is rate limited.
