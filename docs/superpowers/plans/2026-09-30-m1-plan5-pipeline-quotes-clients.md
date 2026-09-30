# M1 · Plan 5 — Pipeline, Quotes & Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agencies the full quote workflow on top of Plan 4's workspace: a pipeline board, enquiry pages, a quote builder (pick live offers, markup, versions, re-price, send), a branded client-facing quote page with accept/decline, client records, route fare intelligence, and agency settings.

**Architecture:** Backend adds a public quote endpoint that resolves a share token to its agency through a narrow `SECURITY DEFINER` function (then binds the tenant and reads under RLS as usual), lazy expiry of overdue quotes, activity timelines per enquiry/client, and a route-intel read model over fare history. Frontend adds routes under `/app` (pipeline, enquiries, quotes, clients, routes, settings) plus the public `/q/:token` page, reusing Plan 3's Fare Scan components and Plan 4's design system.

**Tech Stack:** as Plans 3–4 (FastAPI, SQLAlchemy async, Postgres RLS, Redis; React 19, TanStack Router/Query, Tailwind 4 tokens, hand-built charts, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-09-30-travelmind-product-experience-design.md` (§2 Plan 5 row, §3, §9, §11).

**How code is specified:** as Plan 4 — backend tasks give migration/SQL/core logic and tests verbatim; frontend tasks give exact contracts (routes, props, accessible names, states) and tests; routine code follows existing modules.

## Global Constraints

- Everything from Plan 4's Global Constraints still applies (real data only; RLS on tenant tables; exact integer money; server-side prices; tokens hashed and returned once; plain-language errors; `HTTP_422_UNPROCESSABLE_CONTENT`; theme tokens only; AA both themes; reduced motion; keyboard; 375 px; loading/empty/error states; no AI/assistant attribution anywhere; memory-constrained sequential runs; local lint skipped by ruling — CI lints).
- The public quote page never exposes internal data: no supplier refs, markups, costs, agent names/emails, other versions, activity, or internal ids beyond the quote number. Only the version recorded in `quotes.sent_version` is shown.
- SANDBOX and CACHED options on the public page are labelled "Indicative price — confirm with your travel agent"; LIVE options show "Live fare at the time of quoting". Nothing says "bookable" (booking is out of scope).
- Public endpoints are rate-limited per IP and per token.

## Review Focus

1. **Token → tenant resolution** must not leak across agencies or allow enumeration: unknown/rotated tokens give the same 404 as a wrong one; the definer function returns only an agency id for an exact hash match — pinned in Task 1 `public_quote_resolves_only_exact_tokens`, `rotated_token_is_dead`.
2. **Public data minimisation** — pinned in Task 1 `public_payload_has_no_internal_fields`.
3. **Expiry** — overdue sent/viewed quotes read as `expired` everywhere (public, list, detail, dashboard) and can't be accepted — pinned in Task 1 `overdue_quotes_expire_lazily`, `expired_quote_cannot_be_accepted`.
4. **Double decisions / races** — a second accept/decline returns 409 with the current state; accept on one quote leaves siblings open but the enquiry won — pinned in Task 1 `decision_is_final`.
5. **Quote builder price integrity in the UI** — the client never sends prices; the preview is computed by the server (version create returns the priced options) — pinned in Task 5 `builder never posts prices`.

---

## Part A — Backend

### Task 1: Public quote page API, lazy expiry and decisions

**Files:**
- Create: `backend/migrations/versions/0006_public_quotes.py`, `backend/src/travelmind/workspace/public_quotes.py` (schemas + service + router `public_quotes_router` at `/api/v1/public/quotes`)
- Modify: `backend/src/travelmind/workspace/quotes.py` (lazy expiry helper; re-send clears `decided_at`), `backend/src/travelmind/dashboard/metrics.py` + `workspace/quotes.py` list/get (call expiry first), `backend/src/travelmind/config.py` (`public_quote_max_per_minute: int = 60`), `backend/src/travelmind/main.py`
- Test: `backend/tests/workspace/test_public_quotes.py`

**Interfaces:**
- Migration 0006 (runs as `travelmind_owner`). `quotes` has FORCE RLS, so even an owner-run function can't find a quote without knowing its agency. The token → agency mapping therefore lives in a small lookup table the app role can never read directly:
  ```sql
  CREATE TABLE quote_share_tokens (
    token_hash text PRIMARY KEY,
    quote_id uuid NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
    agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE
  );
  REVOKE ALL ON quote_share_tokens FROM travelmind_app;

  -- Public read: exact hash match only; returns the agency so the app can bind the tenant.
  CREATE FUNCTION public_quote_agency(p_token_hash text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
    $$ SELECT agency_id FROM quote_share_tokens WHERE token_hash = p_token_hash $$;

  -- Called by send_quote inside the tenant-bound transaction. The quote must be visible under the
  -- caller's RLS context (quotes policy uses app.agency_id), so one agency can't register a token
  -- for another agency's quote.
  CREATE FUNCTION set_quote_share_token(p_quote_id uuid, p_token_hash text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE v_agency uuid := NULLIF(current_setting('app.agency_id', true), '')::uuid;
    BEGIN
      IF v_agency IS NULL OR NOT EXISTS (SELECT 1 FROM quotes WHERE id = p_quote_id AND agency_id = v_agency) THEN
        RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
      END IF;
      DELETE FROM quote_share_tokens WHERE quote_id = p_quote_id;
      INSERT INTO quote_share_tokens (token_hash, quote_id, agency_id) VALUES (p_token_hash, p_quote_id, v_agency);
    END $$;

  REVOKE ALL ON FUNCTION public_quote_agency(text), set_quote_share_token(uuid, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public_quote_agency(text), set_quote_share_token(uuid, text) TO travelmind_app;
  ```
  The migration back-fills `quote_share_tokens` from existing `quotes.share_token_hash` rows. `quotes.share_token_hash` stays as the in-tenant record (tests from Plan 4 keep passing); `send_quote` also calls `set_quote_share_token`. The public read: `agency = SELECT public_quote_agency(:hash)` → 404 if null → `bind_tenant(db, agency)` → load the quote by `share_token_hash` under RLS.
- `expire_overdue_quotes(db, agency_id, *, now) -> int` — `UPDATE quotes SET status='expired', updated_at=:now WHERE status IN ('sent','viewed') AND share_expires_at < :now RETURNING id, number` + one `quote.expired` activity per row ("Q-0004 expired"); called at the start of `list_quotes`, `get_quote`, dashboard summary/pipeline, and the public read (tenant-bound).
- `send_quote` re-send from `expired` clears `decided_at`.
- HTTP (public, no auth; limiter key `rl:pq:<ip>` and `rl:pqt:<token-hash-prefix>` at `public_quote_max_per_minute`; 429 "Too many requests. Please try again in a minute."):
  - `GET /api/v1/public/quotes/{token}` → 200 `PublicQuote{number, status: "sent"|"viewed"|"accepted"|"declined"|"expired", agency: {name, brand_color}, client_first_name: str|null, message, options: [PublicOption], currency, expires_at, decided_at}`; `PublicOption{index, carrier_code, carrier_name, cabin, slices (origin, destination, departing_at, arriving_at, duration_minutes, stops, segments [marketing_carrier, flight_number, origin, destination, departing_at, arriving_at]), baggage, refundable, changeable, co2_kg_per_passenger, price_label: "Indicative price — confirm with your travel agent" | "Live fare at the time of quoting", sell: Money, per_traveller: Money|null}`; unknown/rotated token → 404 "This quote link isn't valid. Ask your travel agent for a new one."; first successful read of a `sent` quote → status `viewed`, `first_viewed_at`, activity `quote.viewed` (actor null, "Client opened Q-0004").
  - `POST /api/v1/public/quotes/{token}/decision` `{decision: "accept"|"decline", option_index?: int (required for accept, must exist)}` → 200 PublicQuote; activities `quote.accepted`/`quote.declined` with `data={"option_index"}` (actor null); expired → 410 "This quote has expired. Ask your travel agent for a fresh one."; already decided → 409 "This quote has already been {accepted|declined}."
- Tests (verbatim names; write them in full):
```python
async def test_public_quote_resolves_only_exact_tokens(...)      # wrong/prefix/uppercased token → 404 same text; other agency's quote unreachable
async def test_rotated_token_is_dead(...)                        # re-send → old token 404, new works
async def test_public_payload_has_no_internal_fields(...)        # no supplier_ref, markup_minor, supplier, created_by, agency id, emails in JSON text
async def test_first_view_marks_viewed_once(...)                 # status viewed, one quote.viewed event after two reads
async def test_overdue_quotes_expire_lazily(...)                 # share_expires_at in the past → public 200 status expired; list/detail expired; one quote.expired event
async def test_expired_quote_cannot_be_accepted(...)             # 410
async def test_decision_is_final(...)                            # accept → enquiry won, activity; second decision 409; decline path → enquiry lost only if no other open quote
async def test_accept_requires_a_valid_option(...)               # 422 missing/out of range
async def test_public_rate_limits(...)                           # monkeypatch limit 2 → third 429
async def test_app_role_cannot_read_token_table(...)             # SELECT on quote_share_tokens as travelmind_app → permission denied
```

- [ ] Steps: failing tests → migration + service + router → full backend checks → migrate dev DB → commit `feat(workspace): public quote page API with share-token lookup, lazy expiry and client decisions`.

### Task 2: Timelines and route intelligence read models

**Files:**
- Create: `backend/src/travelmind/workspace/timelines.py` (router: `GET /api/v1/enquiries/{id}/activity`, `GET /api/v1/clients/{id}/activity`, `GET /api/v1/quotes/{id}/activity`), `backend/src/travelmind/fareintel/routes.py` (router `GET /api/v1/routes/intel?origin=&destination=&cabin=economy`)
- Modify: `backend/src/travelmind/workspace/clients.py` (`ClientOut` gains `won_value_minor`, `currency`, `last_trip: {origin, destination, depart_date}|null`), `backend/src/travelmind/main.py`
- Test: `backend/tests/workspace/test_timelines.py`, `backend/tests/fareintel/test_route_intel.py`, additions to `test_clients_api.py`

**Interfaces:**
- Timelines: newest first, limit 50, items `{id, kind, summary, occurred_at, actor: {id, full_name}|null}`; enquiry timeline = events whose `entity_id` is the enquiry or any of its quotes; client timeline = client + its enquiries + their quotes; quote timeline = the quote. 404 across agencies.
- Route intel (auth; tenant-bound; `origin`/`destination` validated against the index; same airport → 422): `{origin, destination, cabin, currency, family: "market"|"sandbox"|null, daily: [{date, p25_minor, median_minor, p75_minor, samples}] (last 60 days, days with ≥1 sample only), by_days_out: [{bucket: "0-7"|"8-21"|"22-45"|"46-90"|"91+", median_minor, samples}], carriers: [{code, samples, median_minor}] (top 8), your_searches: [{created_at, cheapest_minor (per traveller, adults-only), adults}] (agency's last 20 searches on the route, native currency), updated_at}`. Currency = agency currency; `family` = "market" if any LIVE/CACHED rows exist for the route in that currency, else "sandbox" if sandbox rows exist, else null (all arrays empty). Only that family's rows are used.
- Tests: exact medians/percentiles from inserted fare_snapshots (known values), family selection (market beats sandbox; sandbox labelled), empty route → nulls/empties, timeline composition and isolation, client stats.

- [ ] Steps: failing tests → implement → full checks → commit `feat(workspace): activity timelines, client stats and route fare intelligence`.

---

## Part B — Frontend

### Task 3: Data layer, navigation and routes skeleton

**Files:**
- Create: `frontend/src/api/quotes.ts`, `frontend/src/api/enquiries.ts`, `frontend/src/api/clients.ts`, `frontend/src/api/routeIntel.ts`, `frontend/src/api/publicQuotes.ts` (types mirroring the backend field-for-field incl. Plan 4 `QuoteDetail`, `EnquiryOut`, `ClientOut`; query options; mutations with invalidation of `["dashboard"]`, onboarding, and the entity lists)
- Modify: `frontend/src/router.tsx` (routes `/app/pipeline`, `/app/enquiries/$enquiryId`, `/app/quotes`, `/app/quotes/$quoteId`, `/app/clients`, `/app/clients/$clientId`, `/app/routes`, `/app/settings`, public `/q/$token`; each page initially a titled placeholder replaced by Tasks 4–8), `frontend/src/shell/Sidebar.tsx` (Operate: Command Center, Pipeline, Quotes, Clients; Market: Fare scan, Hotel scan, Route intel; Admin: Crew roster, Suppliers, Settings, Design system), `frontend/src/features/palette/CommandPalette.tsx` (records navigate to their pages; nav commands for new pages), `frontend/src/features/command/OnboardingChecklist.tsx` + backend `metrics.py` onboarding (profile → `/app/settings`, quote → `/app/quotes`, both `available: true`), `frontend/src/features/landing/FeatureGrid.tsx` + HowItWorks (quotes are live: drop "Coming in the next release"; hero copy may mention sending quotes), tests updated accordingly.
- Test: `frontend/src/api/workspaceApis.test.ts`, shell/palette/landing/onboarding test updates.

- [ ] Steps: failing tests → implement → `npm test && npm run typecheck && npm run build` + backend checks (onboarding change) → commit `feat(frontend): quotes, enquiries, clients and route-intel data layer with navigation`.

### Task 4: Pipeline board and enquiry page

**Files:** `frontend/src/features/pipeline/PipelinePage.tsx`, `PipelineColumn.tsx`, `EnquiryCard.tsx`, `features/enquiries/EnquiryPage.tsx`, `EnquiryTimeline.tsx`, `EditEnquiryDrawer.tsx`, tests.

**Contracts:**
- `/app/pipeline`: `<h1>` "Pipeline"; filters (assignee select from `/api/v1/team`, search box, route); columns New / Quoting / Quoted / Won / Lost each a `role="list"` named "<Status> enquiries" with count + total value header; cards (article named "E-0007 DEL → BOM") show client, dates, travellers, assignee avatar, age ("3 d"), latest quote value; drag and drop between columns (HTML5 DnD; only allowed transitions accept a drop — others show a not-allowed cursor) and a keyboard alternative: each card has a "Move" menu listing allowed targets; moving to Lost opens a dialog asking for the reason (required); failures toast the server message and revert; list/board toggle (list = DataTable).
- `/app/enquiries/$enquiryId`: header with number, StatusPill, route, dates, travellers, client link, assignee; actions: "Scan fares" (navigates to `/app/fares?origin=&destination=&depart=&adults=&cabin=`, which Fare Scan now reads to prefill — add search-param support to FareScanPage), "Create quote" (POST quote → navigate to the editor), "Edit" (drawer with the enquiry fields), status Move menu; sections: Trip, Quotes (list with status/value/versions), Timeline (from `/enquiries/{id}/activity`).
- Tests: board renders columns from `/enquiries` data; keyboard move to Quoting posts status; move to Lost requires reason; drop of a disallowed transition does nothing; enquiry page actions (Scan fares URL; Create quote navigates); timeline empty/error states.

- [ ] Commit `feat(frontend): pipeline board with keyboard moves and enquiry pages`.

### Task 5: Quote builder, quotes list and send flow

**Files:** `frontend/src/features/quotes/QuotesPage.tsx`, `QuoteEditorPage.tsx`, `OfferPicker.tsx`, `MarkupControls.tsx`, `VersionHistory.tsx`, `SendQuoteDialog.tsx`, `quoteText.ts` (WhatsApp/plain text composer), tests; modify `features/fares/OfferCard.tsx` (optional `selectable` mode with an "Add to quote" checkbox, max 3).

**Contracts:**
- `/app/quotes`: DataTable (Number, Client, Route, Status, Value, Versions, Sent) with status filter tabs (All, Draft, Sent, Viewed, Accepted, Declined, Expired) and search; row → editor.
- `/app/quotes/$quoteId` editor:
  - Header: number, StatusPill, client, enquiry link, currency; status actions (Mark accepted/declined/expired when sent/viewed).
  - "Find offers" panel: runs the flight search for the enquiry trip (reusing Fare Scan search form prefilled, collapsed) and shows OfferCards in selectable mode; only offers billed in the quote currency are selectable (others show "Billed in USD — can't be added to an INR quote").
  - Markup controls: kind (percent / fixed) and value (percent shown as %, sent as basis points; fixed in major units, sent as minor); per-option override inputs.
  - Message textarea (≤4000).
  - "Save version" → POST versions with `offer_ids`, `message`, `option_markups` (never prices) → shows the returned priced options (sell per option, per traveller, markup) as the preview; "Re-price selected" re-prices each selected offer first (existing reprice endpoint), toasting changes, then saves.
  - Version history: each version with created time, options count, min/max sell, and price difference vs previous version (▲/▼); the sent version badge "Client sees this version".
  - "Send to client" (requires ≥1 version) → SendQuoteDialog shows the share link (absolute URL `${location.origin}/q/<token>`), "Copy link", "Copy WhatsApp message" (text from `quoteText.ts`: greeting with client first name, each option one line "Option 1 · IndiGo · DEL 06:10 → BOM 08:20 · ₹5,760", expiry date, link), note that the link is shown once; re-send warns the old link stops working.
- Tests: builder never posts prices (inspect POST body keys), percent/fixed conversion, currency gating, version preview from server response, send dialog copies link and text (mock clipboard), re-send warning, status actions, list filters.

- [ ] Commit `feat(frontend): quote builder with live offers, server-priced versions and share-to-client flow`.

### Task 6: Public quote page

**Files:** `frontend/src/features/publicQuote/PublicQuotePage.tsx`, `PublicOptionCard.tsx`, `DecisionDialog.tsx`, tests.

**Contracts:** standalone layout (no app shell) themed with the agency `brand_color` accent (contrast-checked; falls back to primary), agency name header, quote number, greeting ("Hello Priya,"), agent message, options as cards (itinerary per slice with times/stops, baggage, refundable/changeable, CO₂ per passenger, price label per the constraints, sell total + per traveller), expiry line ("Valid until 14 Oct 2026"), Accept (choose option → confirm dialog) / Decline (confirm) → success state ("Thanks — Orbit Travel Co. has been notified."), states for expired (410 message), invalid link (404 message), already decided, rate limited; print stylesheet (hides buttons); `<title>` "Quote Q-0004 · <agency>"; no app navigation, no tracking scripts.
- Tests: renders options and labels; accept flow posts `{decision:"accept", option_index}`; decline flow; expired/invalid/decided states; never shows markup or supplier text.

- [ ] Commit `feat(frontend): branded client quote page with accept and decline`.

### Task 7: Clients

**Files:** `frontend/src/features/clients/ClientsPage.tsx`, `ClientPage.tsx`, `ClientFormDrawer.tsx`, tests.

**Contracts:** `/app/clients` DataTable (Name, Company, Email, Tags, Enquiries, Quotes, Won value) with search + tag filter + "New client" (drawer form: kind, name, email, phone, company, home airport picker, tags input, notes; server validation inline); `/app/clients/$clientId` header with name/kind/tags, contact card, stats (enquiries, quotes, won value, last trip), sections Enquiries (links), Quotes (links), Timeline; Edit (drawer) and Delete (confirm dialog; 409 message shown inline when the client has quotes); "New enquiry for this client" opens the Command Center NewEnquiryDialog prefilled with the client.
- Tests: list search/filter, create/edit/delete incl. 409, detail sections, prefilled new enquiry.

- [ ] Commit `feat(frontend): client records with history and inline validation`.

### Task 8: Route Intel, Settings, end-to-end and docs

**Files:** `frontend/src/features/routes/RouteIntelPage.tsx`, `features/settings/SettingsPage.tsx`, `frontend/e2e/quote-flow.spec.ts`, README; modify `ui/charts/AreaTrend.tsx` (optional band series: `band?: {low, high}` points rendered as a shaded range) with tests.

**Contracts:**
- Route Intel: route picker (two AirportPickers, cabin), then: family badge ("Market data" / "Sandbox data — for demonstration"), AreaTrend of daily median with p25–p75 band, BarList by days-out bucket, carriers table, "Your searches" list; empty state "No fares seen on this route yet — run a fare scan to start its history." with a Fare scan link; `?origin=&destination=&cabin=` in the URL.
- Settings: agency profile form (name, time zone select from `Intl.supportedValuesOf("timeZone")` filtered to common zones + current, country read-only with note, currency read-only), brand colour picker with live preview tile and AA contrast check against both themes (blocks save below 3:1 for accents), save → PATCH → toast; demo workspaces show read-only form with the demo note (backend already 403s).
- e2e `quote-flow.spec.ts`: sign up → New enquiry (DEL→BOM, new client) → Pipeline shows it under New → open enquiry → Create quote → Find offers → select 2 sandbox offers → markup 10% → Save version → Send → read share link from the dialog → open it in a new page → accept option 1 → back in the app the quote shows Accepted and the enquiry Won; also the demo spec checks Pipeline and Quotes pages render populated.
- README: product tour updated (pipeline, quotes, client page), public quote API noted.

- [ ] Steps: failing tests → implement → full backend + frontend checks → e2e twice (dedicated API on :8011 with `TM_FX_ENABLED=false TM_SIGNUP_MAX_PER_IP=1000 TM_DEMO_MAX_PER_IP=1000`; stop it after) → commit `feat(frontend): route intelligence, agency settings and the quote-to-acceptance journey`.
