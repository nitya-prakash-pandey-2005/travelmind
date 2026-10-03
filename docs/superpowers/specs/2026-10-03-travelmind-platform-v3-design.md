# TravelMind Platform v3 — Themes, Scale, AI Agent, Travellers

Date: 2026-10-03 · Status: approved design (owner approved the sectioned design in conversation)
Builds on: `2026-09-29-travelmind-saas-design.md`, `2026-09-30-travelmind-product-experience-design.md`, `docs/design/design-direction-v2.md`.

## 1. Intent

**Owner said:** a very advanced SaaS; full system design so it can handle 1000 simultaneous user requests; a product for normal travellers where an agent manages everything for their travel, every plan; mobile and web friendly and adaptable; complete sci-fi visualisation; very smooth end-to-end workflow; a multi-theme switcher taking colour ideas from a supplied brief (not its names).

**Decisions:**
- Agent scope for travellers: **plan + prepare + hand-off**. The agent builds the whole trip and makes it booking-ready; the final "Book" step hands off to the airline/hotel (or a supplier's test mode). Real paid booking waits for business registration, a payment gateway and supplier live-mode approval.
- One platform, two front doors: **Agencies** (existing) and **Travellers** (new), sharing search, fare intelligence and one AI agent engine.
- Real data only; illustrative content labelled; no AI/assistant attribution anywhere; nothing published to any claude.ai account — every doc stays in the repo.

**Build order:** (1) themes → (2) finish Plan 5 → (3) scale foundation + first load test → (4) agent engine → (5) traveller app → (6) final 1000-user load test and review. Each step: plan → reviewed build → running app for the owner.

## 2. Theme system

Six themes, original names; colour ideas adapted from the brief, tuned for AA contrast.

| id | Name | Tagline | Modes | Fonts (heading / body / data) |
|---|---|---|---|---|
| `orbital` | Orbital (default) | Graphite console, cyan telemetry | dark / light, + high-contrast | Inter / Inter / JetBrains Mono |
| `nebula` | Nebula | Violet night with teal and violet glow | dark / light, + high-contrast | Sora / Sora / JetBrains Mono |
| `ember` | Ember | Deep indigo with saffron and amber warmth | dark / light, + high-contrast | Fraunces / Inter / IBM Plex Mono |
| `clearsky` | Clearsky | Bright and clean, for projectors and daylight | fixed light | Inter / Inter / IBM Plex Mono |
| `terminal` | Terminal | Amber monochrome console, all monospace | fixed dark | IBM Plex Mono (all) |
| `contrast` | Contrast | Black, white and yellow; maximum legibility | fixed | Inter / Inter / IBM Plex Mono |

**Tokens:** every colour is a CSS custom property set on `html[data-theme][data-mode][data-contrast]`, mapped onto the existing Tailwind theme tokens (`bg`, `surface`, `surface-2`, `line`, `line-strong`, `ink`, `dim`, `faint`, `primary`, `primary-ink`, `accent-2`, `ok`, `warn`, `danger`, `info`, `ai`, `chart-1..6`, `chart-grid`, `chart-axis`, `glow`, `shadow`, `radius-panel`, `radius-control`). No colour literals in components.

Palettes (dark default look; light/high-contrast variants defined in the theme module):
- **Orbital**: bg `#0A0C10`, surface `#0F1217`, surface-2 `#151920`, line `#222833`, ink `#E7EAF0`, dim `#9AA3B2`, primary `#3CC6F0`, accent-2 `#F0B429`; light: bg `#F6F7F9`, surface `#FFFFFF`, ink `#0E131B`, primary `#0875AF`.
- **Nebula**: bg `#070619`, surface `#120F2E`, surface-2 `#1A1540`, line `#3A3470`, ink `#EEF0FF`, dim `#A5A3CF`, primary `#8EF3FF`, accent-2 `#C9A7FF`; light: bg `#F4F2FB`, ink `#1B1640`, primary `#0B6F84`, accent-2 `#6B3FC9`.
- **Ember**: bg `#080B1C`, surface `#0F1430`, surface-2 `#151B3D`, line `#2E3870`, ink `#F4F1E8`, dim `#AFAAC0`, primary `#FF9933`, accent-2 `#3FB950`; light: bg `#F7F9FC`, ink `#14213D`, primary `#A65200`, accent-2 `#0F6B0F`.
- **Clearsky**: bg `#FFFFFF`, surface `#F6F8FB`, surface-2 `#EDF1F6`, line `#C3CCD8`, ink `#0B1220`, dim `#334155`, primary `#0B57D0`, accent-2 `#7A3E00`.
- **Terminal**: bg `#0A0700`, surface `#110C02`, surface-2 `#181104`, line `#5C400C`, ink `#FFB000`, dim `#E09A12`, primary `#FFD27A`, accent-2 `#FF8C1A`.
- **Contrast**: bg `#000000`, surface `#000000`, surface-2 `#111111`, line `#FFFFFF`, ink `#FFFFFF`, dim `#F0F0F0`, primary `#FFE600`.
- High-contrast variant (orbital/nebula/ember): bg `#000000`/`#FFFFFF`, surfaces `#060606`/`#101010` (light `#FFFFFF`/`#F0F0F0`), line `#BDBDBD`/`#3A3A3A`, ink `#FFFFFF`/`#000000`, dim `#E8E8E8`/`#1C1C1C`; accents kept.
- Status colours fixed per look: dark `ok #3FB950 warn #FFD166 danger #FF6B6B info #6FA8FF`; light `ok #0F6B0F warn #7E5300 danger #B3261E info #1F4FB8`.

**Extras:** Nebula/Orbital page titles get a subtle glow (`text-shadow 0 0 18px var(--glow)`); Ember title gradient primary→ink→accent-2 and a faint warm tint on the top bar; Clearsky softer radii, no ambient effects; Terminal monospace everywhere, square corners, scanlines + vignette + 5 s faint flicker (off under reduced motion); Contrast: no shadows/glow/translucency/gradients/blur, solid panels with strong borders, 3px yellow focus ring. High-contrast mode on any theme disables glow/scanlines/vignette.

**Switcher:** top-bar dropdown (and in the user menu on phones) listing the six themes with name, tagline and a 4-colour swatch; arrow/Enter/Esc; light/dark and high-contrast toggles enabled only for orbital/nebula/ember. Persisted in `localStorage` key `tm.theme` (`{theme, mode, contrast}`), applied before first paint by an inline `<head>` script; the existing `tm-theme` dark/daylight value migrates to orbital dark/light. A JS palette export (`useThemePalette()`) re-reads tokens on change for the globe/charts/canvas. Fonts self-hosted via `@fontsource` (no CDN). Landing and public pages follow the same theme.

**Tests:** token completeness per theme × mode; switcher keyboard/persistence/first paint; AA contrast checker over ink/dim/primary pairs; every page renders in all themes (smoke).

## 3. Scale and system design (target: 1000 concurrent users)

**Topology (docker compose `deploy/`, production-like):** nginx (TLS-ready reverse proxy, gzip, static frontend, `/api` → upstream) → N API containers (gunicorn + uvicorn workers, stateless) → PgBouncer (transaction pooling; tenant binding uses transaction-local `set_config`, which is compatible) → Postgres 16; Redis 7 for cache, rate limits, offer cache, pub/sub (agent run streaming) and the job queue; **worker** containers (arq) for slow jobs.

**Performance work:**
- DB: per-process pool sizing against PgBouncer limits; `statement_timeout` (5 s API, 60 s workers); index review of hot queries (EXPLAIN in tests for dashboard/market-pulse/enquiries list); no N+1.
- Cache: Redis read-through for airport index lookups, platform facts, supplier statuses, dashboard summary/pipeline per agency (30 s, invalidated on writes), reference data.
- Concurrency: per-supplier semaphores and circuit breakers; outbound HTTP connection pooling (shared httpx clients).
- Jobs: demo generation, agent runs, price watches, quote expiry sweeps, cleanup move to the queue; HTTP returns 202 + job id where appropriate.
- Limits: existing per-agency/per-IP rate limits kept; global concurrency guard for AI runs per tenant.
- Observability: `/metrics` (Prometheus format: request count/latency histograms by route, DB pool, queue depth, supplier latency), structured JSON logs with request/trace ids, `/health` (liveness) and `/ready` (DB + Redis).

**Load test:** k6 scripts (run via docker) with a mixed scenario — public landing/facts, sign-in, Command Center reads, lists, flight searches (sandbox), quote reads, public quote page, agent runs at a lower rate — ramping to **1000 concurrent virtual users**. Targets: read endpoints p95 < 300 ms, searches p95 < 2.5 s (sandbox), error rate < 1%, no DB connection exhaustion. Results saved to `docs/perf/` with the machine spec; if the local machine is the bottleneck, the report says so and records per-container numbers.

## 4. AI agent engine (shared by agencies and travellers)

- **Provider interface** `LLMProvider.generate(messages, tools, …)` with a Gemini implementation (key from env `TM_GOOGLE_API_KEY`, falling back to the existing `GOOGLE_API_KEY`); provider choice per environment; no keys in logs.
- **Loop:** native tool calling, max 12 steps, per-step timeout, total budget; runs as a queued job; every step streamed to the client over SSE (run trace: tool name, inputs summary, timing, result summary).
- **Tools (typed):** `lookup_airport`, `search_flights`, `search_hotels`, `price_check`, `fare_insight`, `weather_forecast` (Open-Meteo, no key), `find_places` (OpenTripMap with key, fallback OpenStreetMap/Overpass), `build_itinerary`, `estimate_budget` (from tool results only), `ask_user`; agency-only: `find_client`, `create_enquiry`, `draft_quote`; traveller-only: `save_trip`, `add_reminder`, `watch_fare`.
- **Grounding guard:** every money amount, flight number, date and IATA code in assistant prose must appear in this run's tool results; otherwise re-prompt once with the violations, then fall back to structured results without prose. Badge "All prices verified against live results".
- **Safety:** supplier/place data passed as data, never instructions; tools scoped by role/tenant; actions that spend money are never available (hand-off only).
- **Budget:** per-tenant monthly token budget + per-run cap; usage recorded per run.
- **Evals:** ≥50 cases (extraction, clarification, tool choice, grounding = 100%, latency/cost), deterministic on sandbox data; CI job.

## 5. TravelMind for travellers

- **Accounts:** sign-up "For myself" creates a personal workspace (`agencies.kind = 'personal'`, single owner) — reuses tenancy/RLS; agency features hidden for personal workspaces.
- **Data (RLS):** `trips` (title, travellers, origin, destinations, dates, budget, status draft/planned/ready/travelling/done), `trip_items` (flight option, hotel option, day activity, transfer, note — each with source provenance and price snapshot), `trip_days` (date, weather snapshot), `checklist_items` (documents/visa/vaccination/packing — official-source links, no guarantees), `reminders`, `fare_watches` (route/date/threshold; worker checks and notifies).
- **Experience (mobile-first PWA):** bottom nav (Plan · Trips · Alerts · Profile) on phones, sidebar on desktop; home = agent chat ("Where to next?") with suggested prompts; the agent asks for missing details, runs tools with a visible trace, and produces a **trip board**: mission timeline (days → items), route globe/map, flight & hotel option cards (provenance, fare insight, CO₂), weather strip, budget breakdown, checklist, "Book" hand-off buttons; edit by chatting ("cheaper hotel", "add a beach day") or directly; share link (read-only); offline view of saved trips (service worker cache); installable (manifest, icons).
- **Notifications:** in-app alerts for fare drops and reminders (email/push later).

## 6. Quality bar
As previous specs: RLS isolation tests for every new table; exact money; plain-language errors; WCAG AA in every theme; reduced motion; keyboard; 375 px; e2e journeys per product (traveller: plan a trip with the agent on sandbox data → board → share); agent evals in CI; load-test report checked in.

## 7. Out of scope (for now)
Real paid booking/ticketing and payments; email/SMS/push providers (in-app only); native mobile apps (PWA instead); multi-region deployment.
