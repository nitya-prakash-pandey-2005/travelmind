# TravelMind

AI copilot for travel agencies and corporate travel: quotes from live supplier inventory,
every price verified against real offers, fare intelligence, policy and approvals.

> Status: Milestone 1 in progress. Plans 1 (backend foundation), 2 (Mission Control frontend), 3 (offers engine),
> 4 (workspace and Command Center) and 5 (pipeline, quotes and clients) are complete.

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
   and quotes, the theme menu and notifications; the account menu signs out.
4. **Pipeline** (`/app/pipeline`): every enquiry on a board by stage (New, Quoting, Quoted, Won, Lost) or
   as a list, with totals (open value, won value, win rate, oldest open), search and filters by assignee
   and route. Cards move by drag and drop or, from the keyboard, with their Move menu; marking one lost
   asks for the reason. Each enquiry has its own page (`/app/enquiries/:id`) with the trip, its quotes, the
   client and assignee, an activity timeline, **Scan fares** for its route and **Create quote**.
5. **Quote builder** (`/app/quotes`, `/app/quotes/:id`): a quote answers one enquiry and carries a markup,
   either a percentage of each fare or a fixed amount per option, which any option can override. The
   editor searches fares for the enquiry's trip; tick **Add to quote** on up to three offers billed in the
   agency's currency and **Save version**. TravelMind prices every option on the server from the supplier
   fare and the markup (the browser never sends a price), and **Re-price and save** confirms fares first.
   Earlier versions are kept and can be previewed. **Send to client** creates a link valid for 14 days,
   shown once, with a ready-to-paste WhatsApp message; sending again replaces the link. The quote list
   shows each quote's status (draft, sent, viewed, accepted, declined, expired), and an agent can record a
   decision the client gave by phone or email.
6. **Client quote page** (`/q/:token`): what the client opens, with no sign-in. It shows the agency's name
   and brand colour, the agent's note and the options that were sent: flights and times, baggage, refund
   and change terms, CO₂ and the price. Sandbox and cached fares are labelled "Indicative price — confirm
   with your travel agent"; live ones "Live fare at the time of quoting". The client accepts one option,
   or declines, after a confirmation step; the agency sees the decision straight away, and an accepted
   quote marks its enquiry won. The page prints cleanly and has its own theme menu.
7. **Clients** (`/app/clients`): records for individuals and companies, with search and a tag filter, and a
   page per client with contact details, figures (enquiries, quotes, won value, last trip), their
   enquiries and quotes, and a timeline. **New enquiry for this client** opens a prefilled enquiry. A
   client who has quotes can't be deleted.
8. **Route intel** (`/app/routes`): pick a route and cabin to see its daily median fare over the last 60
   days with the typical range (middle half of fares), fares by days before departure, carriers and the
   agency's own searches. The data is labelled "Market data" or "Sandbox data — for demonstration"; a
   route with no history yet links to a fare scan.
9. **Settings** (`/app/settings`): agency name and time zone, and the brand colour used on client quote
   pages, with a live preview and a contrast check that blocks colours below 3:1 in either light or dark;
   plus workspace facts, the team, appearance and data handling. Owners and admins can edit; agents and
   demo workspaces see the form read-only.
10. **Start free** (`/signup`): creates your own agency. The country (India or the United States for now)
    sets its currency and time zone. A new agency starts empty with a six-step setup checklist on the
    Command Center.

Fare scan, hotel scan, suppliers and the crew roster live under `/app/fares`, `/app/hotels`,
`/app/suppliers` and `/app/team`; the old top-level addresses (`/fares`, …) redirect there.

### Themes

Six themes, picked from the theme menu in the top bar, in Settings under Appearance, or on the client quote
page:

| Theme | Look | Modes |
|---|---|---|
| **Orbital** (default) | Graphite console, cyan telemetry | Dark or light, optional high contrast |
| **Nebula** | Violet night with teal and violet glow | Dark or light, optional high contrast |
| **Ember** | Deep indigo with saffron and amber warmth | Dark or light, optional high contrast |
| **Clearsky** | Bright and clean, for projectors and daylight | Light only |
| **Terminal** | Amber monochrome console, all monospace | Dark only |
| **Contrast** | Black, white and yellow; maximum legibility | Dark only |

Every theme meets WCAG AA contrast, and charts and the route globe take its colours. The choice is saved in
the browser on that device; it doesn't change the agency's brand colour or what other people see.

### API added for the workspace

All under `/api/v1` (browse them at http://localhost:8010/docs). Apart from `POST /demo` and
`GET /platform/facts`, each needs a session and sees only the signed-in user's agency.

| Endpoints | What |
|---|---|
| `GET, PATCH /agency` | Agency profile: name, country, currency, time zone, brand colour |
| `/clients`, `/enquiries`, `/quotes` | Clients, trip enquiries (with status changes) and quotes (versions, sending, the client's decision) |
| `GET /{enquiries,clients,quotes}/{id}/activity` | Activity timelines |
| `GET /routes/intel` | Route fare intelligence: daily median and range, days-out buckets, carriers, the agency's searches |
| `GET /public/quotes/{token}`, `POST /public/quotes/{token}/decision` | The client quote page and the client's accept or decline (no session) |
| `GET /dashboard/{summary,pipeline,activity,market-pulse,supplier-health,team,departures}` | Command Center panels |
| `GET /onboarding`, `GET /notifications`, `POST /notifications/seen`, `GET /search?q=` | Setup checklist, notifications, record search |
| `POST /demo`, `POST /demo/exit` | Start a demo workspace (signs in as its presenter); leave it |
| `GET /platform/facts` | Public figures for the landing page |

**Public quote API.** Sending a quote creates a random share token; only its hash is stored, and sending
again replaces it, so the earlier link stops working. `/public/quotes/{token}` finds the agency by an exact
hash match and reads the quote under that agency's row-level security. It returns only the version the
client was sent: the agency's name and brand colour, the client's first name, the agent's message and, per
option, the flights, baggage, conditions, CO₂, sell price and price label. It never returns supplier
references, costs, markups, agent names or emails, other versions, activity or internal ids. Unknown,
replaced and malformed tokens all get the same 404, overdue quotes read as expired and can't be accepted,
and a second decision gets a 409. Each request counts against a per-network and a per-link limit of 60 a
minute (`TM_PUBLIC_QUOTE_MAX_PER_MINUTE`), and every response carries `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`.

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
npm run e2e              # Playwright: demo, Command Center, golden path, sandbox fare scan and the quote
                         # journey (enquiry, quote, client link, acceptance). Needs the API
                         # running (on :8010, or set TM_API_TARGET) with TM_SIGNUP_MAX_PER_IP=1000 and
                         # TM_DEMO_MAX_PER_IP=1000 (tests sign up and start demos; the defaults are 10
                         # and 5 an hour). CI also sets TM_FX_ENABLED=false.
```

First e2e run: `npx playwright install chromium`, or set `PLAYWRIGHT_CHANNEL=chrome` to use an installed
Chrome. To test against a second dev server (for example Vite on :5174 proxying to a dedicated API), set
`PLAYWRIGHT_BASE_URL=http://localhost:5174` and add that origin to the API's `TM_ALLOWED_ORIGINS`.

Reset the local database completely: `docker compose down -v && docker compose up -d --wait`.

## Security model (short)

- Tenant data tables use Postgres row-level security (forced); the app connects as a role
  that cannot bypass it. Identity tables are only accessed through `travelmind.identity`.
- Sessions are opaque, revocable, httpOnly cookies; passwords use Argon2.
- Cross-site state-changing requests are rejected; login is rate limited.
