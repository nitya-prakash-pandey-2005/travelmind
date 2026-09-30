# TravelMind — Product Experience Spec (M1 completion)

Date: 2026-09-30 · Status: approved design, written for review
Parent spec: `2026-09-29-travelmind-saas-design.md` (this spec completes its M1 scope — §8 agency workflow, §9 agent, §10 UX — and adds what a buyer expects from a finished SaaS)

## 1. Intent

**What the owner said:** the app is "too empty and very minimal … not looking like a SaaS product — how can I pitch it … build it … real."

**What that means here (agreed):**
- The emptiness is mostly missing product, not missing styling. A new agency lands on a globe and an airport picker with nothing to act on. The core agency workflow — enquiry → search → quote → share — does not exist yet.
- A buyer expects the everyday SaaS fabric: a dense dashboard whose numbers move, a pipeline, clients, quotes with a client-facing page, global search, notifications, settings, onboarding, polished empty/loading states.
- Pitching needs a full-looking workspace on demand → a **one-click, clearly labelled demo workspace** (decision: separate demo agency, fictional clients, real airports, real sandbox searches, 30 days of back-dated history, badged everywhere, deleted after 7 days).
- Keep the sci-fi "Mission Control" identity; make it denser and more finished.

**Success:** in five minutes in front of an agency owner, the presenter opens the landing page, launches the demo (or uses their own account), sees a full Command Center, pastes an enquiry, the Copilot finds labelled fares, a quote is built and a share link opened in the client view — and every number on screen traces to real data or is visibly marked demo/sandbox.

**Non-negotiables carried over:** real data only (demo data is fictional but real-shaped, always labelled, never mixed with a real agency); provenance on every price; tenant isolation (RLS); secrets never exposed; WCAG AA, reduced motion, keyboard; no AI attribution anywhere.

## 2. Delivery: three plans, back to back

| Plan | Outcome (visible) |
|---|---|
| **4 — Workspace & Command Center** | Agency profile (country, currency, branding); clients / enquiries / quotes data model + APIs; activity log; per-supplier search results; dashboard metrics API; one-click demo workspace; new app shell (top bar, grouped nav, notifications, global search, onboarding checklist); Command Center dashboard with charts; public landing page. |
| **5 — Pipeline, Quotes & Clients UI** | Pipeline kanban; Quotes list + editor (options, markup, re-price, versions, share, WhatsApp text); public branded quote page `/q/:token` with view tracking; Clients list + detail; Route Intel page; Settings (agency profile, branding). |
| **6 — AI Copilot** | Gemini provider behind an interface; tools over the existing services; enquiry extraction with clarifying questions; SSE run trace; grounding guard + badge; "Add to quote"; token budget; eval harness (≥50 cases). |

Each plan gets its own implementation plan, subagent-driven execution, per-task reviews, a final review, merge and push.

## 3. Information architecture

**Public**
- `/` — landing page (marketing + pitch): hero with animated route globe, value props, feature tour (Copilot, fare intelligence, provenance, CO₂, multi-tenant security), live platform facts (airports indexed, suppliers connected, routes with fare history — aggregates with no tenant data), "Explore live demo" and "Start free" CTAs, footer.
- `/login`, `/signup`, `/invite/:token` (restyled).
- `/q/:token` — client-facing quote page (Plan 5).

**App (`/app/...`, signed in)**
- **Top bar:** agency name + logo mark, `DEMO WORKSPACE` badge (demo only, with "Exit demo"), global search (Ctrl/⌘+K opens the command palette: navigation, airports, clients, quotes, enquiries), notifications bell (unread count; from activity events relevant to the user), help, theme toggle, user menu (profile, sign out).
- **Sidebar, grouped:** *Operate* — Command Center, Copilot (Plan 6), Pipeline (5), Quotes (5), Clients (5). *Market* — Fare Scan, Hotel Scan, Route Intel (5). *Admin* — Team, Suppliers, Settings (5). Collapsible; icons + labels; active state; keyboard reachable. Items whose plan hasn't shipped are not shown (no dead links).
- **Onboarding checklist** (dismissible card on Command Center until done): add your agency details, connect a supplier (links to Suppliers), invite a teammate, run a fare scan, create a client, send a first quote. Each item is computed from real state.
- **Status bar** kept: API health, clocks (UTC + agency local), active supplier count.
- Old routes redirect (`/` for signed-in users → `/app`; `/fares` → `/app/fares`, etc.).

## 4. Data model (Plan 4, backend)

All tenant tables have `agency_id`, forced RLS via `tenant_rls_statements`, created in one migration `0004_workspace`.

- **agencies** (identity table, extended): `country_code` (ISO-2, default `IN`), `currency` (ISO-4217, default from country via `display_currency_for`), `timezone` (IANA, default `Asia/Kolkata` for IN else `UTC`), `brand_color` (hex, default theme cyan), `is_demo` (bool), `demo_expires_at` (nullable). Signup form gains country (defaults IN). Hotel guest nationality now follows `country_code` (fixes a parked limitation).
- **clients:** id, agency_id, kind (`individual` | `company`), name, email, phone, company_name, home_airport (IATA, nullable), notes, tags (text[]), created_by, created_at, updated_at. Unique (agency_id, lower(email)) when email present.
- **enquiries:** id, agency_id, client_id (nullable), number (per-agency sequence `E-0001`), source (`manual` | `pasted` | `copilot`), raw_text (nullable), origin, destination (IATA), depart_date, return_date, adults, children_ages (int[]), cabin, budget_minor + budget_currency (nullable), notes, status (`new` | `quoting` | `quoted` | `won` | `lost`), lost_reason (nullable), assignee_user_id (nullable), created_by, created_at, updated_at, closed_at.
- **quotes:** id, agency_id, enquiry_id, client_id, number (`Q-0001`), status (`draft` | `sent` | `viewed` | `accepted` | `declined` | `expired`), current_version, markup_kind (`fixed` | `percent`), markup_value, currency, share_token_hash (nullable, sha256), share_expires_at, sent_at, first_viewed_at, decided_at, created_by, created_at, updated_at.
- **quote_versions:** id, agency_id, quote_id, version, message (customer-facing text), options (JSONB: frozen offer snapshots — the `OfferView` JSON incl. provenance, supplier_ref, prices, CO₂ — plus per-option markup and sell price in minor units), totals (JSONB), created_by, created_at. Versions are immutable (app role: no UPDATE/DELETE).
- **activity_events:** id, agency_id, occurred_at, actor_user_id (nullable), kind (enum-like string: `search.flights`, `search.hotels`, `client.created`, `enquiry.created`, `enquiry.status_changed`, `quote.created`, `quote.sent`, `quote.viewed`, `quote.accepted`, `quote.declined`, `team.joined`, `supplier.price_checked`), entity_type, entity_id, summary (short human text, no secrets), data (JSONB, small). Append-only for the app role. Written by services, never by the frontend.
- **search_source_results:** id, agency_id, search_id → flight_searches (and a nullable hotel marker), supplier, status, offer_count, latency_ms, occurred_at. Written by `search_flights`/`search_hotels` for every source.
- **notifications** are derived: unread = activity events relevant to the user (assigned enquiries, their quotes viewed/accepted/declined, teammate joined) after `users.notifications_seen_at` (new nullable column on users).

## 5. APIs (Plan 4)

All under `/api/v1`, signed-in, tenant-bound, plain-language errors, rate-limited where they fan out.
- `GET/PATCH /agency` — profile (name, country, currency, timezone, brand_color); owner/admin to patch.
- `GET/POST /clients`, `GET/PATCH/DELETE /clients/{id}` (delete only when no quotes), list with `q`, `tag`, paging.
- `GET/POST /enquiries`, `GET/PATCH /enquiries/{id}`, `POST /enquiries/{id}/status` (validated transitions: new→quoting→quoted→won|lost; any→lost with reason; reopen lost→new).
- `GET/POST /quotes`, `GET /quotes/{id}` (with versions), `POST /quotes/{id}/versions` (new version from selected offers — offers are re-read from the per-agency offer cache or re-priced; the server computes sell prices from markup; never trusts client prices), `POST /quotes/{id}/send` (creates/rotates share token, sets expiry, status sent), `POST /quotes/{id}/status` (accepted/declined/expired by agent). Plan 5 builds the UI; Plan 4 builds and tests the API because the dashboard and demo need it.
- `GET /public/quotes/{token}` (Plan 5; unauthenticated, rate-limited, returns only the latest sent version, agency name/brand, no internal fields; first view records `quote.viewed`).
- `GET /dashboard/summary?range=30d` — KPIs with previous-period deltas and daily series: open enquiries, quotes sent, win rate (won/(won+lost) in range), pipeline value (sum of sell totals of quotes in sent|viewed, agency currency, native-currency only), median first-response time (enquiry created → first quote sent), CO₂ quoted (sum of per-passenger CO₂ × pax on sent options), searches run.
- `GET /dashboard/pipeline` — counts and values per enquiry status.
- `GET /dashboard/activity?limit=` — recent events (paged).
- `GET /dashboard/market-pulse` — top routes (agency's searched routes first, then market) by % change of median fare this week vs. the prior 4 weeks, from fare_snapshots (market family only; sandbox family only in demo, labelled).
- `GET /dashboard/supplier-health?range=24h` — per supplier: success rate, p50/p95 latency, offers returned, from search_source_results.
- `GET /dashboard/team` — per agent: enquiries handled, quotes sent, won value.
- `GET /dashboard/departures` — next 10 departures from won enquiries.
- `GET /search?q=` — global search across clients, enquiries, quotes (numbers, names, emails, routes) + airports.
- `GET /notifications`, `POST /notifications/seen`.
- `GET /onboarding` — checklist state.
- `POST /demo` (public, rate-limited per IP: 5/hour) — creates a demo agency + demo owner user (random email on a reserved domain `demo.travelmind.invalid`, random password never shown), seeds it (§6), starts a session cookie, returns `/app`. `POST /demo/exit` — signs out. A cleanup routine deletes demo agencies past `demo_expires_at` (runs at app start and hourly via a lightweight in-process scheduler; safe to run concurrently).
- `GET /platform/facts` (public) — airports indexed, suppliers connected (by kind, not keys), routes with fare history.

## 6. Demo workspace generator (Plan 4)

- Deterministic per demo (seeded RNG from the agency id) so tests can assert shapes; fictional clients from a curated name list mixing Indian and international names and fictional companies (e.g. "Nimbus Analytics Pvt Ltd"); emails on `example.com`; phones in reserved ranges.
- ~40 clients, ~60 enquiries across all statuses over the last 30 days, ~35 quotes (1–3 versions), ~250 activity events, back-dated with realistic working-hour timestamps in the agency timezone.
- Routes: a curated list of real popular routes (DEL–BOM, BOM–DXB, BLR–SIN, DEL–LHR, BOM–JFK, MAA–KUL, …) using real OurAirports records.
- Quote options are produced by the **real sandbox supplier** through `search_flights` logic (provenance `SANDBOX`), so cards, CO₂ (sandbox has none unless TIM is configured) and insights behave exactly as live ones; fare snapshots for the demo's sandbox family are generated by running the same searches (not invented rows).
- Everything the generator writes goes through the same services/tables as real use, and demo agencies have `is_demo = true`. Suppliers are platform-level, so a demo workspace runs whatever suppliers are enabled; the generator itself uses only the sandbox supplier, while searches a presenter runs live during a demo may return genuinely LIVE offers, labelled as such.
- Generation must finish in < 8 s (sandbox is in-process); the endpoint shows a "Preparing your demo workspace…" screen meanwhile.

## 7. Visual design system upgrade (Plan 4 foundation, used by 5–6)

- **Layout density:** 12-column grid, 16 px gutters, panels with layered glass (backdrop blur, 1 px gradient border, inner glow on focus), section headers with eyebrow + title + actions, sticky page headers with breadcrumbs.
- **Charts (in-house SVG, theme-token colours, accessible):** `Sparkline`, `AreaTrend` (with previous-period ghost line), `BarList`, `Funnel`, `Donut`, `LatencyBand` (p50/p95), `Heat strip` for activity by hour. Each has a text alternative (`role="img"` + summary, or a visually hidden table), tooltips reachable by keyboard, reduced-motion friendly draw-in. Follow the dataviz skill's colour and mark rules; one categorical palette defined in theme tokens for both themes.
- **Components:** `KpiTile` (value, unit, delta vs. previous period with arrow and colour, sparkline), `DataTable` (sortable columns, sticky header, row actions, empty state, skeleton rows, pagination), `StatusPill`, `Avatar`/`AvatarStack`, `Tabs`, `Drawer`, `Dialog`, `Toast` system, `Skeleton`, `EmptyState` (icon, title, one-line why, primary action), `Kbd`, `Timeline`, `Kanban` (Plan 5), `Menu`/`Popover`.
- **Motion:** 150–250 ms ease-out; panel entrance stagger on first load; number tickers on KPI change; all disabled under `prefers-reduced-motion`.
- **Themes:** dark Mission Control (default) and daylight, both passing WCAG AA; brand colour from agency settings tints accents (never text contrast).
- **Performance:** route-level code splitting; globe lazy-loaded; landing page first load < 2.5 s on 4G; dashboard queries parallel with skeletons.

## 8. Command Center (Plan 4)

Top to bottom (desktop; stacks on tablet/phone):
1. Header: greeting, agency local date/time, range switch (7d / 30d / 90d), "New enquiry" primary action (Plan 5 opens the editor; Plan 4 opens a compact create-enquiry dialog).
2. Onboarding checklist (until complete).
3. KPI row (6 tiles, §5 metrics) with deltas and sparklines.
4. Row: **Pipeline funnel** (counts + value per status) · **Activity trend** (daily enquiries vs. quotes sent, area chart).
5. Row: **Route globe** with the agency's routes (arcs weighted by enquiry count; won routes highlighted) · **Live activity feed** (timeline with actor avatars, relative times, links to entities; polls every 20 s).
6. Row: **Market pulse** (top movers with sparkline and signal pill) · **Supplier health** (success %, latency band, offers) · **Team leaderboard**.
7. Row: **Upcoming departures** table.
Every panel has a designed empty state that explains what fills it and links to the action.

## 9. Pipeline, Quotes, Clients, Route Intel, Settings (Plan 5)

- **Pipeline:** kanban columns by enquiry status with drag-and-drop (keyboard alternative: status menu), cards show client, route, dates, pax, value, assignee, age; filters (assignee, date, route); list view toggle.
- **Enquiry detail:** trip summary, client, timeline of activity, linked quotes, "Scan fares" (prefills Fare Scan) and "Create quote".
- **Quote editor:** pick offers from a Fare Scan run or the offer cache; 1–3 options; per-option markup (fixed/%) with live sell price; customer message; preview; "Re-price all" before send; "Send" → share link + copy-for-WhatsApp text; versions list with diff of prices; status actions.
- **Public quote page `/q/:token`:** agency brand colour and name; options with itinerary, baggage, refundability, CO₂, sell price; provenance shown as "Indicative — confirm with your agent" for SANDBOX/CACHED; expiry; accept/decline buttons that record the decision and notify the agent; no internal data.
- **Clients:** table with search/tags; detail with contact, preferences, enquiries, quotes, total won value, activity.
- **Route Intel:** pick a route → fare history chart (daily median with p25–p75 band, by days-to-departure bucket), carriers seen, CO₂ range, recent searches; empty state explains how history grows.
- **Settings:** agency profile (name, country, currency, timezone), branding (brand colour with live contrast check), team (existing), suppliers (existing).

## 10. AI Copilot (Plan 6)

As the parent spec §9, M1 tool set, using the Plan 3/4/5 services directly: `extract_trip_request`, `search_flights`, `search_hotels`, `price_check` (→ `reprice_offer`), `route_insights`, `lookup_airport`, `find_client`, `create_enquiry`, `draft_quote`, `ask_user`. Gemini provider (key from env) behind a provider interface; SSE run trace; grounding guard (every money amount, flight number, date and airport in prose must appear in the run's tool results; 2 failed attempts → structured results only); per-tenant token budget; eval harness ≥50 cases on the sandbox. UI: three panes — conversation, run trace timeline, result cards with "Add to quote"; Copilot also reachable from the command palette ("quote Mumbai→Dubai for 2 adults next Friday").

## 11. Testing & quality

- Backend: unit + API tests for every endpoint incl. RLS isolation (agency A never sees B's clients/enquiries/quotes/events/notifications; demo agency isolated), transition rules, metric definitions (fixtures with known answers), demo generator (counts, determinism, only fictional domains, everything labelled demo), cleanup, public endpoints' rate limits and data minimisation.
- Frontend: component tests for every new component/page incl. empty/loading/error states, keyboard paths and chart text alternatives; Playwright: landing → demo → Command Center populated; signup → onboarding checklist → first client → enquiry (Plan 4); quote send → public page accept (Plan 5); Copilot golden path on sandbox (Plan 6).
- Visual: manual phone/tablet/desktop check in a real browser at the end of each plan (screenshots in the report).
- All existing suites stay green; no AI attribution in code, docs or commits.

## 12. Out of scope (this spec)

Booking/ticketing, payments/billing, email sending, customer chat widget, knowledge RAG, corporate policy/approvals, SSO — as in the parent spec's later milestones. Marketing site CMS, pricing page with real plans (a "Contact sales" CTA stands in).
