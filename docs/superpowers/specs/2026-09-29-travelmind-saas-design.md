# TravelMind SaaS — Platform Design + Milestone 1 Spec

**Date:** 2026-09-29 · **Status:** Draft for review · **Owner:** Nitya Prakash Pandey

---

## 1. Intent

### What the user asked for
- Turn the existing TravelMind prototype into an advanced, sellable B2B SaaS product that can be pitched to companies.
- Serve **both** travel agencies / TMCs **and** corporates (companies booking travel for employees).
- Markets: **India and global**.
- **Real data**, not mock data.
- An advanced, **sci-fi feel** for the app.
- Constraints: solo founder, 3+ months, moderate budget (a few hundred USD/month is OK), Python + React stack, no industry contacts, no business entity yet (will register).
- The founder delegated detailed product/technical decisions to the build process ("figure out, check and clean everything").

### Assumptions made on the user's behalf (correct any of these)
- **Approach A** is chosen: Agency Copilot first, corporate portal second, both on one multi-tenant core. (Explicitly selected by user.)
- "Beat every existing project" is interpreted as: win decisively on the two things buyers complain about most in incumbents — **trustworthy AI (no invented prices)** and **fast servicing/support** — plus a distinctive, modern UX. Not feature parity with Navan/Concur.
- TravelMind does **not** collect traveler card payments in v1. Agencies pay suppliers from their own balances/wallets and collect from their customers as they do today. This avoids PCI-DSS scope and RBI payment-aggregator licensing.
- Milestone plan targets ~12 weeks of solo work; each milestone ends in something demoable.

### Success criteria
1. A travel agency can take a customer enquiry, have the AI produce a quote priced from **live supplier inventory**, edit/approve it, send it, and (M2) book it — with every price traceable to a supplier response.
2. A corporate client of that agency can (M3) self-book within policy, route out-of-policy trips for approval, and see spend + CO₂ reports.
3. A measurable AI eval suite shows price-grounding accuracy and task success on every change (target: 100% of quoted prices grounded; ≥90% task success on the eval set).
4. The app looks and feels unlike any incumbent: sci-fi "mission control", fast, and readable.

---

## 2. Current state (audit of the prototype)

| Area | Finding | Disposition |
|---|---|---|
| Data | `fares.json` has 9 records (3 mock flights × 3 simulated suppliers A/B/C, derived by multiplying one price). Kaggle download never ran. OpenFlights routes are frozen since 2014. | **Remove.** Replace with real supplier adapters + OurAirports. |
| Search | Semantic vector search (Chroma + BGE-M3) over structured fares. Cannot filter dates/prices exactly. Loads a ~2 GB torch model on CPU. | **Remove** for fares. Vector search kept only for documents (RAG), in pgvector, with API embeddings. |
| Agent | LangChain ReAct text-parsing agent, `gemini-1.5-flash` (retired), comma-string tool input. | **Replace** with native tool-calling agent behind a provider interface. |
| Negotiation | `target_price >= 2000 → "success"`. | **Remove.** Replaced by Fare Intelligence (§7). |
| API | No auth, no tenancy, CORS `*`, new agent built per request. | **Replace.** |
| Frontend | Single chat page, fake "thinking" phases, random session ID per render, hard-coded `localhost:8000`. | **Replace** with new TypeScript app + design system. |
| Tests/evals | `tests/` empty; 5 keyword-match evals. | **Replace** with real test pyramid + eval harness (§11). |
| Secrets | `.env` present locally. | Now git-ignored; `.env.example` added. |

Nothing in the prototype is carried over except the product name, the idea, and lessons learned. The prototype is preserved in git history (commit `7494009`).

---

## 3. Market position (research summary, 2026-09-29)

**Incumbents** — Corporate: Navan (public, AI agent "Ava"), Perk (ex-TravelPerk, MCP + Slack agent), SAP Concur (Joule agents), Amex GBT/Egencia, ITILITE, MakeMyTrip myBiz, Yatra, Cleartrip for Work. Agency tooling: Spotnana (white-label TaaS for TMCs), TBO/Tripjack portals (no real AI), QuadLabs/OTRAMS/Juniper (heavy legacy mid-office), generic WhatsApp bots (no inventory).

**Most common customer complaints:** booking changes, refunds, support escalation, clunky/slow UIs.

**Gaps TravelMind targets:**
1. AI-native back office for the long tail of 2–20 person Indian agencies (enquiry → live quote → booking → GST invoice). No funded AI-native player found. *(Limited search; to be re-verified.)*
2. AI servicing/disruption handling for independent TMCs (currently locked inside Spotnana/Navan/Amex GBT).
3. GST input-tax-credit (ITC) recovery tracking for Indian mid-market corporates.
4. Global SMB: chat-first booking without 3–5% booking fees.

**Pricing benchmarks:** per trip/booking dominates (ITILITE ≈ $10/trip; Perk 3–5% capped; Indian TMCs ₹200–500/domestic booking); per-seat for agency tools ($39–59/advisor/month). Proposed TravelMind pricing (to validate with first customers): agency plan per seat/month + small per-booking fee; corporate portal per trip.

---

## 4. Tenancy & users

```
Platform (TravelMind)
 ├── Agency workspace (tenant)            roles: owner, admin, agent
 │     ├── Customers (leisure, contacts only, no login in v1)
 │     └── Corporate client (sub-tenant)  roles: travel_admin, approver, traveler
 └── Direct corporate workspace           = corporate client owned by a TravelMind "house agency"
```

- Every row carries `agency_id` (and `corporate_id` where relevant). PostgreSQL **Row-Level Security** enforces isolation; the app sets the tenant per request. Cross-tenant access is impossible even if a query forgets a filter.
- Exception (decided in M1 Plan 1): identity tables `agencies`, `users`, `sessions` have no RLS because login must look users up before the tenant is known. They are accessed only through `travelmind.identity` (enforced by an architecture test), and `users` queries always filter by `agency_id`. Invitations use `<agency_id>.<secret>` tokens so they stay under RLS.
- Auth: email + password (Argon2) and invitation links in M1; Google/Microsoft OIDC SSO in M3. Sessions via httpOnly secure cookies.
- Audit log: every state change on quotes, bookings, policies, credentials (who, what, when, before/after).

---

## 5. Architecture

**Modular monolith**: one FastAPI app, strict internal module boundaries, one Postgres, one Redis, one worker process.

```
            ┌──────────── React + TypeScript apps (one codebase) ───────────┐
            │  Agency Console  │  Corporate Portal (M3)  │  Chat Widget (M2) │
            └───────────────────────────────┬───────────────────────────────┘
                                            │ REST (JSON) + SSE streaming
┌──────────────────────────────── FastAPI backend ─────────────────────────────────┐
│ identity      users, orgs, roles, invitations, sessions, audit log                │
│ reference     airports/airlines/cities (OurAirports + Duffel), currency rates     │
│ suppliers     SupplierAdapter interface → duffel, liteapi, sandbox, (tbo, ...)    │
│ search        fan-out to adapters, normalize, dedupe, rank → Offer                │
│ quotes        Enquiry → Quote (versions) → sent → accepted                         │
│ bookings (M2) Order lifecycle: book, ticket, change, cancel, refund               │
│ fareintel     price snapshots, route baselines, signals, alerts                   │
│ knowledge(M2) documents → chunks → pgvector; retrieval for the agent              │
│ policy (M3)   deterministic rule engine + approvals                               │
│ invoicing(M2) GST invoices, ITC tracking                                          │
│ agent         LLM provider interface, tools, grounding guard, run traces          │
└─────────┬──────────────────────┬──────────────────────────┬──────────────────────┘
   PostgreSQL 16 + pgvector   Redis + arq worker        External APIs
   (all data, embeddings, RLS) (polling, alerts, email)  (suppliers, LLM, TIM)
```

**Rules that keep it trustworthy:**
- Prices, policy verdicts, and money movements are computed by deterministic code. The LLM explains, drafts, and orchestrates; it never invents a number.
- Modules talk through service functions with typed inputs/outputs (Pydantic), never by reaching into each other's tables.
- Each module has its own `models.py` / `service.py` / `router.py` / `tests/`.

**Tech choices:**
- Backend: Python **3.12** (3.14 is too new for some native wheels; pinned via `uv`), FastAPI, SQLAlchemy 2 (async) + Alembic, Pydantic v2, `httpx`, `arq` (Redis jobs), `structlog`.
- DB: PostgreSQL 16 + pgvector (Docker locally; managed Postgres in prod).
- Frontend: React 19 + TypeScript + Vite, TanStack Router + TanStack Query, Tailwind CSS v4, Framer Motion, `react-globe.gl` (three.js) for the route globe, Recharts for charts.
- LLM: provider interface with Gemini as default (user already has a key); other LLM providers can be added and **the eval suite picks the model**, not opinion. Current model IDs are selected at implementation time.
- Embeddings: provider API (no local torch model).
- Dev: Docker Compose (postgres, redis), `make`-style task runner (`just` or plain scripts), pre-commit (ruff, mypy, eslint/oxlint, prettier).
- Hosting (post-M1): Render/Railway/Fly + managed Postgres, est. $30–80/month.

---

## 6. Data sources & supplier adapters

### Adapter contract
```python
class SupplierAdapter(Protocol):
    code: str                      # "duffel", "liteapi", "sandbox", "tbo", ...
    capabilities: set[Capability]  # FLIGHT_SEARCH, FLIGHT_BOOK, HOTEL_SEARCH, ...
    async def search_flights(self, req: FlightSearch) -> list[Offer]: ...
    async def price_check(self, offer_ref: str) -> Offer: ...            # re-price before quote/book
    async def book(self, offer_ref: str, pax: list[Passenger]) -> Order: ...        # M2
    async def cancel(self, order_ref: str) -> Cancellation: ...                      # M2
    async def search_hotels(self, req: HotelSearch) -> list[HotelOffer]: ...
```
- `Offer` / `Order` are the canonical models (successor to the prototype's `FareRecord`): money as integer minor units + ISO currency, segments, fare brand, baggage, refundability/change conditions, `source` (supplier code), `supplier_ref`, `fetched_at`, `expires_at`, and `provenance` ∈ {`LIVE`, `CACHED`, `SANDBOX`}.
- Adapter credentials are **per agency**, encrypted at rest (envelope encryption, key from env/KMS). Platform-level credentials (Duffel, LiteAPI) are used for agencies that don't bring their own.
- Every adapter has contract tests against recorded fixtures plus an opt-in live smoke test.

### Sources by phase
| Need | Day 1 (no contacts) | After first agency signs (M4) |
|---|---|---|
| Flights, global | **Duffel** (test mode now, live after KYC) | Duffel Enterprise / agency's GDS PCC |
| Flights, India | Duffel if Indian carriers verified bookable (open question); otherwise quote-only via cached data | **TBO**, **Tripjack**, **Akbar** using agency credentials; IndiGo/Air India NDC via agency |
| GDS/NDC build target | **Travelport TripServices** free trial, **Sabre** sandbox | Agency's Amadeus/Sabre/Travelport PCC |
| Hotels | **LiteAPI** (self-serve, own margin); Duffel Stays backup | TBO hotels, Hotelbeds, RateHawk |
| Carbon | **Google Travel Impact Model API** (free) | same |
| Reference | **OurAirports** (nightly refresh), Duffel airlines/places | same |
| Market analytics | **Travelpayouts Data API** (cached prices), **DGCA/data.gov.in** traffic, own snapshots | same |
| Flight status (M4) | **AeroDataBox** (check resale clause) | same |
| Rail | — (no public IRCTC API) | via agency's IRCTC agent ID + PSP |

**Excluded:** Amadeus Self-Service (shut down 17 Jul 2026), Kiwi Tequila (invite-only), Booking.com Demand API (AI-use ban), SerpApi Google Flights (active litigation), OpenSky (commercial license), unofficial IRCTC scrapers.

**Provenance is always visible in the UI.** `CACHED` and `SANDBOX` prices are never presented as bookable live prices.

**Sandbox adapter:** a deterministic in-repo adapter with realistic generated inventory (real routes from OurAirports, plausible schedules/fares) for tests, offline dev and demos. Always labelled `SANDBOX`.

---

## 7. Fare Intelligence (replaces "negotiation")

- **Snapshots:** every search result offer is stored as a price snapshot (route, date, cabin, carrier, fare brand, price, provenance, fetched_at). Worker polls **watched routes** (routes in open quotes and client watchlists) on a schedule, within the supplier search-to-book ratio budget (Duffel: 1500:1 free).
- **Baselines:** per route × days-to-departure bucket × cabin: median, p25, p75 from own snapshots, seeded with Travelpayouts cached data.
- **Signals shown on every offer:** "₹X below typical for this route and booking window", a **book-now / wait** indicator with a stated confidence and reason, CO₂ per passenger (Google TIM).
- **Alerts (M2):** fare drop on a quoted-but-unbooked route; fare drop after booking on refundable/changeable fares ("re-shop") — real savings.
- **Corporate deals (M3):** track preferred-airline agreements and report realized vs. expected savings.

No fake negotiation. Every number shown has a traceable source.

---

## 8. Workflows

### Agency (M1–M2)
1. **Enquiry intake:** agent pastes a WhatsApp/email message or types it; or (M2) the customer uses the chat widget. The AI extracts a structured `TripRequest` (pax, origin, destination, dates, flexibility, cabin, budget, hotel needs) and **asks for what's missing**.
2. **Search & shortlist:** fan-out to adapters; results ranked (price, duration, stops, baggage, refundability); fare-intel signals attached.
3. **Quote builder:** AI drafts a quote (2–3 options + a customer-friendly message). Agent edits, sets markup (fixed or %), re-prices (`price_check`), and sends (shareable link + copy-to-WhatsApp text in M1; email in M2). Quotes are versioned.
4. **Booking (M2):** customer accepts → agent books via adapter → order stored → e-ticket/voucher → GST invoice generated.
5. **Servicing (M2 basic, M4 advanced):** cancel/change via adapter where supported; disruption watch in M4.

### Corporate (M3)
1. Travel admin sets **policy** (cabin by trip length, price caps per route/city, advance booking, preferred airlines/hotels, approval chains) — or uploads a policy PDF from which the AI **proposes** rules for admin confirmation.
2. Traveler books via portal or chat; the deterministic policy engine marks each offer in/out of policy with the exact rule.
3. Out-of-policy → approval request to approver (email/in-app); approve/deny with reason.
4. Reports: spend by team/route/supplier, policy compliance, savings vs. baseline, **CO₂ (Scope 3)**, GST ITC eligibility (company GSTIN per state, invoice-in-company-name checks).

---

## 9. AI agent design

- **Loop:** native tool calling with typed tool schemas; max-step budget; streamed to the UI via SSE as a live **run trace** (each tool call, its inputs, timing, and result summary). This replaces the prototype's fake "thinking" animation.
- **Tools (M1):** `extract_trip_request`, `search_flights`, `search_hotels`, `price_check`, `route_insights` (fare intel), `carbon_estimate`, `lookup_airport`, `draft_quote`, `ask_user`. M2 adds `search_knowledge`, `book_offer` (requires human confirmation), `cancel_order` (requires confirmation). M3 adds `check_policy`, `request_approval`.
- **Grounding guard:** after the model produces a customer-facing answer or quote, a validator extracts every money amount, flight number, date and airport code and checks each against tool results from the same run. Any ungrounded value → answer is blocked and the model is re-prompted with the violation; after 2 failures the UI shows the structured results without prose. Guard results are logged per run.
- **Human-in-the-loop:** any action that spends money or changes a booking needs explicit user confirmation in the UI; the model can only propose it.
- **Prompt-injection hygiene:** supplier data and uploaded documents are passed as data, never as instructions; tool permissions are scoped per role and tenant.
- **Cost control:** per-tenant monthly token budget and rate limits; run traces record tokens and cost.

---

## 10. UX & design language — "Mission Control"

**Direction:** a sci-fi flight-operations deck, not a chatbot. Think spacecraft mission control / air-traffic HUD — but engineered for readability by business users all day.

- **Theme:** deep space navy/near-black background, cyan primary, amber for warnings/policy, magenta for AI activity, green for grounded/verified. Subtle grid, scan-line and glow effects used sparingly on key surfaces. A **light "daylight" theme** is provided for corporate buyers who require it.
- **Typography:** a geometric display face for headings, a highly legible sans for body, a monospace face for data readouts (prices, flight numbers, PNRs, timings).
- **Signature elements:**
  - **Route globe:** 3D globe with animated great-circle arcs for searched/quoted routes; the home screen shows live activity across the agency.
  - **Live run trace:** the agent's tool calls stream in as a timeline panel ("SCAN SUPPLIERS → 3 SOURCES · 42 OFFERS · 1.8s").
  - **Offer cards as "telemetry":** price, fare-intel delta vs. typical, CO₂, baggage, refundability, provenance badge (LIVE / CACHED / SANDBOX), policy status (M3).
  - **Command palette (Ctrl/⌘+K):** natural-language commands anywhere ("quote Mumbai→Dubai for 2 adults next Friday").
  - **Grounding badge:** every AI answer shows "✓ all prices verified against live offers".
- **Accessibility:** WCAG AA contrast, reduced-motion mode disables animations, keyboard-first navigation, responsive down to tablet (agency console) and phone (chat widget, approvals).
- **Performance:** first load < 2.5 s on 4G; globe lazy-loaded.

---

## 11. Quality, security, compliance

### Testing
- **Unit:** domain logic (normalization, ranking, fare-intel math, policy engine, GST calc, grounding validator) — pytest, high coverage.
- **Contract:** each supplier adapter against recorded fixtures (`respx`); live smoke tests opt-in via env flag.
- **Integration:** API endpoints against real Postgres (Docker) incl. RLS isolation tests (tenant A can never read tenant B).
- **Agent evals:** versioned eval set (≥50 cases in M1, growing): extraction accuracy, clarification behaviour, tool-choice correctness, grounding (must be 100%), task success, latency and cost. Run locally and in CI; results stored and compared per model/prompt change. Uses the sandbox adapter for determinism.
- **Frontend:** component tests (Vitest + Testing Library), Playwright E2E for the golden paths.
- **CI:** GitHub Actions — lint, type-check, tests, evals (sandbox).

### Security & compliance
- Tenant isolation via Postgres RLS; per-agency encrypted supplier credentials; secrets only in env / secret manager.
- No card data handled (no PCI scope) in v1.
- **India DPDP Act 2023:** consent + purpose notice for traveler personal data, data export/deletion endpoints, breach logging. Passport data (M2) encrypted at field level and retained only as long as needed.
- **GST:** invoices with HSN/SAC, GSTINs, place-of-supply logic (M2).
- OWASP basics: rate limiting, CSRF protection for cookie sessions, strict CORS, security headers, dependency scanning.
- Error handling: supplier failures degrade gracefully (partial results with a banner naming the failed source); all external calls have timeouts, retries with backoff, and circuit breakers; user-facing errors are plain-language with a trace ID.

---

## 12. Milestones

| # | Weeks | Outcome (demoable) |
|---|---|---|
| **M1** | 1–4 | **Agency Copilot core.** New repo structure, auth + tenancy, Duffel (test) + LiteAPI (sandbox) + Sandbox adapters, OurAirports + Google TIM, agent with tool calling + grounding guard + live run trace, Quote builder (create/edit/version/share link), fare snapshots + basic route insights, Mission Control UI shell with globe and command palette, eval harness. Old prototype code removed. |
| **M2** | 5–8 | **Book & service.** Booking/cancel via Duffel, orders, GST invoices, customer chat widget + agency branding, knowledge RAG (fare rules, airline policies, agency docs), fare-drop alerts, email. First deploy to hosting. |
| **M3** | 9–12 | **Corporate portal.** Corporate sub-tenants, policy engine + PDF-to-rules, approvals, traveler self-booking, SSO, spend/compliance/CO₂/GST-ITC reports, daylight theme polish. |
| **M4** | after | **Scale & differentiate.** TBO/Tripjack/GDS bring-your-own-credential connectors, disruption watch (AeroDataBox) + AI rebooking proposals, MCP server (book from AI assistants), WhatsApp Business channel, rail via partner. |

Each milestone gets its own implementation plan; M2–M4 each get a short follow-up spec when reached.

---

## 13. Milestone 1 — detailed scope

**In scope**
1. Repo restructure: `backend/` (package `travelmind`), `frontend/` (TypeScript), `docs/`, `docker-compose.yml`, `.env.example`, task runner, pre-commit, CI workflow.
2. Remove prototype code: `src/`, `scripts/`, Chroma data, mock fares, old frontend app code.
3. Identity: signup creates an agency + owner; invite agents; login/logout; roles owner/admin/agent; RLS on all tenant tables; audit log.
4. Reference data: OurAirports import job (airports, cities, countries); airline list from Duffel; airport search endpoint with fuzzy matching.
5. Suppliers: adapter protocol + canonical `Offer`; `sandbox`, `duffel` (flight search + price check), `liteapi` (hotel search) adapters; fan-out search service with timeouts and partial results.
6. Fare intel: snapshot storage; route baseline computation job; `route_insights` (delta vs. typical, book/wait signal); Google TIM carbon per offer.
7. Agent: provider interface + Gemini implementation; M1 tools (§9); grounding guard; SSE run-trace streaming; per-tenant token budget.
8. Quotes: enquiry → TripRequest; quote with options, markup, versioning, re-price before send, public share link (read-only, expiring).
9. Frontend: Mission Control design system (tokens, components), app shell, login/signup, Dashboard (globe + recent activity), Copilot (chat + run trace + offer cards), Quotes list/detail/editor, Settings (team, supplier connections status), command palette.
10. Evals: harness + ≥50 cases; CI job.

**Out of scope for M1:** booking/ticketing, payments, email sending, chat widget, knowledge RAG, policy/approvals, corporate portal, SSO, WhatsApp, TBO/GDS connectors, hosting.

**M1 done when:** a new agency signs up, pastes a real customer enquiry, gets a clarifying question if needed, receives a quote with live Duffel test-mode offers (or sandbox) showing fare-intel deltas and CO₂, edits markup, shares the link — with the run trace visible, the grounding badge green, all tests + evals passing in CI.

---

## 14. Risks & open questions

| Risk / unknown | Mitigation |
|---|---|
| Duffel may not carry Indian domestic carriers / may not onboard an India-based entity. | Verify in Duffel test mode in week 1. India inventory via agency TBO/Tripjack credentials is the primary plan anyway (M4, pulled earlier if an agency signs). |
| TBO/Tripjack may not grant API access to a SaaS vendor (vs. a registered agency). | BYO-credentials model: the agency is the account holder; TravelMind is their software. |
| LLM quality/latency/cost for tool calling. | Provider interface + eval suite; switch models based on evidence. |
| Solo scope creep. | Milestones are strict; anything not in §13 waits. |
| Business registration timing. | Build on sandboxes; register before M2 live bookings. |
| Competitive gap (#1) based on limited search. | Re-verify via Tracxn/Crunchbase + 10 agency discovery calls during M1. |

## 15. Actions for the user (can run in parallel with M1)
1. Create free accounts: **Duffel** (test mode), **LiteAPI** (sandbox), **Google Cloud** (enable Travel Impact Model API), **Travelpayouts** (data token), **Travelport** trial (for later).
2. Get a current **Gemini API key** (existing key may be tied to retired models).
3. Start business registration (sole proprietorship/LLP/Pvt Ltd + GST) before M2.
4. Talk to 5–10 small travel agencies during M1: confirm the enquiry→quote pain, which portals they use (TBO/Tripjack/GDS), and what they'd pay.
