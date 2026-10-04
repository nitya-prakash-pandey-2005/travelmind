# v3 · Step 4: Agent Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a shared, grounded trip-planning agent. It takes a plain-language request ("Mumbai to Dubai for 4 adults, 12–16 Dec, mid-range hotel"), asks for anything missing, calls TravelMind's real tools (airports, flight search, hotel search, fare insight, weather, places), and returns a structured plan. Every price, flight number, date and airport code in that plan comes from this run's tool results. Each step streams to the browser as a visible trace. Agencies get it as **Agent** in the app. Step 5 reuses the same engine for travellers.

**Architecture:**
- **Engine:** a provider-neutral engine package `travelmind.agent` with these parts:
  - an `LLMProvider` interface, with a Gemini implementation (`google-genai`) and a deterministic scripted `FakeProvider` for tests, evals and e2e;
  - a typed tool registry, scoped by role;
  - a bounded tool-calling loop;
  - a grounding guard.
- **Runs:**
  - Runs are tenant rows under RLS and execute as arq jobs.
  - Each step is written to the DB and published on Redis pub/sub.
  - The API streams a run over Server-Sent Events, replaying stored steps first so a reconnect never loses anything.

**Tech stack:**
- Backend: FastAPI, SQLAlchemy async, Postgres RLS, Redis pub/sub, arq, `google-genai`, httpx with Open-Meteo and OpenStreetMap (Overpass/Nominatim), and the guard and metrics from Step 3.
- Frontend: React, TanStack Query, EventSource.

**Spec:** `docs/superpowers/specs/2026-10-03-travelmind-platform-v3-design.md` §4 (and §5 for which tools travellers get later).

## Global Constraints
- **Keys:** the provider key comes only from the environment: `TM_GOOGLE_API_KEY`, falling back to `GOOGLE_API_KEY`. It is never logged, returned, put in metrics labels or put in prompts. Without a key, the provider is `fake` in dev/test, and the Agent page says "Agent unavailable — no model configured" in production.
- **Model:** set by `TM_AGENT_MODEL`, default `gemini-2.5-flash`. Check the exact model id against the installed SDK and the account at build time; never hard-code it in more than one place.
- **Loop limits:** at most 12 steps per run; a 20 s per-step model timeout; a 120 s total budget per run. A per-run token cap and a per-agency monthly token budget are both settings and are enforced in the loop.
- **Grounding:** every money amount, flight number, date and IATA code in the assistant's prose must appear in this run's tool results, otherwise the guard acts (Task 3). The UI badge "All prices verified against live results" shows only when the guard passed with no fallback.
- **Untrusted content:** supplier and place data reach the model as **data**, inside a clearly delimited JSON tool-result part, never concatenated into instructions. The system prompt says so. Tool outputs are trimmed to the fields the model needs.
- **No money-spending tools exist.** Booking is hand-off only. Agency write tools (`create_enquiry`, `draft_quote`) need the user's explicit confirmation in the UI before they execute.
- **Tenancy:** every tool runs under the run's agency (RLS). Roles scope the tools, and the server decides the role.
- **Copy:** professional and sentence case. The page is named "Agent". There is no AI or assistant attribution anywhere in commits, code comments or docs. Product copy may describe the feature ("plans trips using live fares").
- **Machine:** this is a low-memory dev machine. Run focused tests while working and the full suite once per task. oxlint runs locally and must be clean.

## Review Focus
1. **Prompt injection through tool data.** A hotel or place name containing "ignore previous instructions and…" must not change tool use or the output. Pinned by Task 4 eval `injection_in_place_name` and Task 2 `tool_results_are_wrapped_as_data`.
2. **Hallucinated prices or flights.** Prose that mentions ₹ amounts, flight numbers or dates that are not in the tool results must be caught and repaired, or replaced by the structured fallback. Pinned by Task 3 `guard_*` tests and evals with grounding at 100%.
3. **Runaway runs.** These cover step loops, a model that keeps calling the same tool, slow tools, and budget exhaustion. In each case the run ends cleanly with a clear status. Pinned by Task 3 `loop_limits_*`.
4. **Lost or duplicated events.** A browser that reconnects mid-run sees every step exactly once, in order. Pinned by Task 3 `sse_replays_then_streams`.
5. **Cross-tenant access.** No user can read or stream another agency's run, and tools never see another agency's data. Pinned by Task 3 `runs_are_tenant_scoped` and Task 2 `tools_run_under_the_run_agency`.

---

### Task 1: Provider interface, Gemini and fake providers, run storage and budgets

**Files:**
- Create:
  - `backend/src/travelmind/agent/__init__.py`
  - `agent/provider.py` (interface plus message and part types)
  - `agent/gemini.py`
  - `agent/fake.py`
  - `agent/models.py` (ORM)
  - `agent/budget.py`
  - migration `backend/migrations/versions/0012_agent_runs.py` (0011 is taken by the perf round)
- Modify:
  - `config.py` (`agent_provider: Literal["gemini","fake","auto"]="auto"`, `agent_model`, `google_api_key` via AliasChoices `TM_GOOGLE_API_KEY`/`GOOGLE_API_KEY`, `agent_max_steps=12`, `agent_step_timeout_s=20`, `agent_run_timeout_s=120`, `agent_run_token_cap=60000`, `agent_monthly_token_budget=2_000_000`, `agent_max_concurrent_runs_per_agency=3`)
  - `pyproject.toml` (`uv add google-genai`)
- Test:
  - `tests/agent/test_provider_fake.py`
  - `tests/agent/test_gemini_mapping.py` (pure mapping tests, no network)
  - `tests/agent/test_runs_schema.py` (RLS isolation)
  - `tests/agent/test_budget.py`

**Interfaces (produced):**

```python
# agent/provider.py
Role = Literal["user", "model", "tool"]

@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]

@dataclass(frozen=True)
class ToolResult:
    call_id: str
    name: str
    data: dict[str, Any]   # JSON-safe, already trimmed

@dataclass(frozen=True)
class Message:
    role: Role
    text: str | None = None
    calls: tuple[ToolCall, ...] = ()
    results: tuple[ToolResult, ...] = ()

@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]   # JSON Schema

@dataclass(frozen=True)
class Generation:
    text: str | None
    calls: tuple[ToolCall, ...]
    input_tokens: int
    output_tokens: int

class LLMProvider(Protocol):
    name: str
    model: str
    async def generate(
        self, *, system: str, messages: Sequence[Message], tools: Sequence[ToolSpec], timeout_s: float
    ) -> Generation: ...

def get_provider(settings: Settings) -> LLMProvider  # "auto" = gemini if a key is set, else fake (never fake in production: raise AgentUnavailable)
```

**Gemini provider (`agent/gemini.py`):**
- Uses `google.genai.Client(api_key=…).aio.models.generate_content`, with `tools=[types.Tool(function_declarations=[…])]` and automatic function calling **disabled**, because the engine runs the loop.
- Maps `Message` to `types.Content`. Tool results become `function_response` parts whose `response` is `{"data": <json>}`.
- Reads `usage_metadata` for token counts.
- Errors become `ProviderError(kind="timeout"|"rate_limited"|"unavailable"|"invalid")`, wrapped in `resilience.guarded("gemini")`. Add `"gemini"` to `GUARDED_SUPPLIERS` and record `supplier_call("gemini")` metrics.

**Fake provider (`agent/fake.py`):**
- `FakeProvider(script: list[Generation | Callable[[Sequence[Message]], Generation]])` returns the scripted turns in order.
- `FakeProvider.planner()` is a small rule-based planner used in dev/e2e when no key is set. It extracts origin/destination/dates/travellers with regexes plus the airport index; it calls `lookup_airport`, `search_flights`, `search_hotels` and `weather_forecast`, then writes a short grounded summary. This keeps the product demo working without a key, and the UI labels such runs "Demo planner".

**Migration 0012:**
- `agent_runs`:
  - columns: `id`, `agency_id`, `user_id`, `kind` (`agency|traveller`), `status` (`queued|running|waiting_for_user|done|failed|cancelled|budget_exceeded`), `prompt`, `result jsonb null`, `error text null`, `provider`, `model`, `input_tokens`, `output_tokens`, `grounded bool null`, `created_at`, `started_at`, `finished_at`;
  - index `(agency_id, created_at desc)`.
- `agent_steps`:
  - columns: `id bigserial`, `run_id`, `agency_id`, `seq int`, `kind` (`thinking|tool_call|tool_result|ask_user|answer|guard|error`), `payload jsonb`, `duration_ms`, `created_at`;
  - unique `(run_id, seq)`.
- `agent_usage_monthly`: `agency_id`, `month date`, `input_tokens`, `output_tokens`; PK `(agency_id, month)`.
- All three tables use `tenant_rls_statements`.

**Budget (`agent/budget.py`):**
- `async def reserve(db, agency_id, now) -> None` raises `BudgetExceeded` when the month's total is at or above the budget.
- `async def record(db, agency_id, now, input_tokens, output_tokens)` upserts the monthly row.
- Per-agency concurrent runs are limited with the Redis semaphore from `semaphore.py` (key `tm:sem:agent:<agency>`).

- [ ] Write failing tests:
  - the fake provider returns its script;
  - `get_provider` chooses gemini when a key is set and fake otherwise, and raises in production without a key;
  - Gemini mapping round-trips a tool call and result with no network (build SDK types and assert their fields);
  - RLS isolation for all three tables;
  - the budget blocks at the limit;
  - the key never appears in `repr(settings)`, and the existing `test_no_secrets_in_logs` covers a canary `TM_GOOGLE_API_KEY`.
- [ ] Implement. Apply the migration to the dev DB.
- [ ] Focused, then full suite; ruff and mypy.
- [ ] Commit `feat(agent): provider interface with Gemini and scripted providers, run storage and budgets`.

### Task 2: Typed tools with role scoping

**Files:**
- Create:
  - `agent/tools/__init__.py` (registry)
  - `agent/tools/travel.py`
  - `agent/tools/places.py`
  - `agent/tools/weather.py`
  - `agent/tools/workspace.py`
  - `agent/context.py`
- Test:
  - `tests/agent/test_tools.py`
  - `tests/agent/test_weather.py`
  - `tests/agent/test_places.py`

**Interfaces:**

```python
@dataclass
class RunContext:
    db: AsyncSession          # bound to agency_id
    redis: Redis
    settings: Settings
    agency_id: UUID
    user_id: UUID
    role: Literal["agency", "traveller"]
    currency: str             # agency display currency
    country: str              # agency country (guest nationality)
    timezone: str

class Tool(Protocol):
    spec: ToolSpec
    roles: frozenset[str]
    confirm: bool   # needs user confirmation before running (write tools)
    async def run(self, ctx: RunContext, args: dict[str, Any]) -> dict[str, Any]: ...

def tools_for(role: str) -> list[Tool]
```

**Tools.** All tools validate their arguments with Pydantic and return trimmed JSON.

| Tool | Behaviour |
|---|---|
| `lookup_airport(query)` | Top 5 matches from the airport index: code, name, city, country. |
| `search_flights(origin, destination, depart_date, return_date?, adults, children_ages?, cabin)` | Calls `offers.service.search_flights` under the run's agency, with the normal search budget. Returns the top 6 offers: `offer_id`, carrier, flight numbers, times, stops, duration, sell total and per traveller (minor units and formatted), provenance, fare insight label, CO₂. |
| `search_hotels(destination, check_in, check_out, adults, rooms)` | Calls `hotels.service.search_hotels`. Returns the top 6 hotels: name, stars, area, price total and per night, provenance. |
| `price_check(offer_id)` | Calls `reprice_offer`. |
| `fare_insight(origin, destination, depart_date, cabin)` | Baseline and typical range from `fareintel`. |
| `weather_forecast(place_or_airport, start, end)` | Open-Meteo daily forecast, or climate normals beyond 16 days, labelled `forecast` or `typical`. No key needed; uses the shared httpx client and a supplier guard named `open_meteo`. |
| `find_places(destination, kind, limit≤10)` | Uses OpenTripMap when `TM_OPENTRIPMAP_KEY` is set, else OSM Overpass, with Nominatim for geocoding (a proper User-Agent with the contact from settings, honouring the usage policy, cached in Redis for 24 h). Returns name, kind, coordinates and source. |
| `build_itinerary(days: [...])` | A pure function that validates and normalises a day-by-day plan the model proposes, using only items already returned by tools (ids). Ids that tools did not return are rejected. |
| `estimate_budget(items: [ids])` | Sums only tool-returned prices. Gives a per-category breakdown and currency, plus an explicit note when currencies differ. |
| `ask_user(question, fields?)` | Ends the turn with status `waiting_for_user`. |
| `find_client(query)` | **Agency only.** |
| `create_enquiry(...)` | **Agency only.** `confirm=True`. |
| `draft_quote(enquiry_id, offer_ids, markup_kind, markup_value)` | **Agency only.** `confirm=True`. Creates the quote plus version 1 through the existing services, server-priced. |

**Tool-result wrapping:** each result goes back to the model as `{"data": …}` inside a function response part. Text from suppliers or places is never placed in the system prompt.

- [ ] Write failing tests:
  - every tool's arguments are validated (bad dates, the same airport twice, too many travellers);
  - flights and hotels go through the existing services, using the sandbox supplier and respx for external calls;
  - Open-Meteo forecast vs typical, using respx;
  - Overpass and Nominatim parsing with fixtures;
  - `tools_for("traveller")` excludes the workspace tools;
  - `tools_run_under_the_run_agency`: agency A's run can't see agency B's clients;
  - `build_itinerary` rejects unknown ids;
  - `estimate_budget` uses only tool prices;
  - `tool_results_are_wrapped_as_data`.
- [ ] Implement, then focused and full suite; ruff and mypy.
- [ ] Commit `feat(agent): typed travel, place, weather and workspace tools scoped by role`.

### Task 3: The loop, grounding guard, run jobs and streaming API

**Files:**
- Create:
  - `agent/loop.py`
  - `agent/grounding.py`
  - `agent/prompts.py`
  - `agent/service.py`
  - `agent/router.py`
  - `agent/events.py` (Redis pub/sub + DB replay)
- Modify:
  - `worker.py` (register `run_agent_job`)
  - `main.py` (router)
  - `readcache` invalidation: write tools bump the agency
  - `metrics.py` (`agent_runs_total{status}`, `agent_steps_total{kind}`, `agent_tokens_total{direction}`)
- Test:
  - `tests/agent/test_loop.py`
  - `tests/agent/test_grounding.py`
  - `tests/agent/test_agent_api.py`

**Loop (`agent/loop.py`):**

```python
async def run_loop(ctx: RunContext, provider: LLMProvider, run: AgentRun, emit: Emit) -> LoopOutcome:
    """Bounded tool-calling loop. Each model turn may return text and/or tool calls; tool calls run
    (sequentially, max 4 per turn), results are appended as data, and the loop repeats until the model
    answers without calls, asks the user, or a limit is hit. Identical repeated calls (same name+args)
    are answered from the run's memo instead of re-running. Write tools pause the run with
    status waiting_for_user and a confirmation request."""
```

- **Limits:**
  - At `max_steps`, the run ends `failed` with the error "The plan took too many steps".
  - A step that exceeds its timeout records an `error` step, and the run retries that turn once.
  - At the total timeout the run ends `failed`.
  - When the token cap or monthly budget is hit, the run ends `budget_exceeded`.
- **Final answer:** the model must end with a JSON block matching `PlanResult`, as well as prose.

```python
class PlanResult(BaseModel):
    summary: str                       # prose shown to the user
    trip: TripFacts | None             # origin, destination, dates, travellers
    flights: list[str]                 # offer_ids from tool results
    hotels: list[str]                  # hotel ids from tool results
    itinerary: list[DayPlan]           # from build_itinerary
    budget: BudgetBreakdown | None     # from estimate_budget
    weather: list[WeatherDay]
    next_steps: list[str]
```

- The service resolves the ids into the full cards from the run's tool results, so the UI never trusts model-written prices.

**Grounding guard (`agent/grounding.py`):**

```python
def find_violations(prose: str, facts: GroundFacts) -> list[Violation]:
    """Extract money amounts (₹ 12,345 · INR 12345 · $1,234.50 · 12k), flight numbers ([A-Z0-9]{2}\s?\d{1,4}),
    dates (ISO, '12 Dec', 'Dec 12', '12/12'), and IATA codes (3 capitals, only when they are known airport
    codes) from the prose; each must match a value present in this run's tool results (money compared at
    whole-unit precision after normalising currency symbols; dates by calendar day). Returns the mismatches."""
```

- **On violations:**
  1. Re-prompt once with the list ("These values are not in the tool results: … Use only values from the results.").
  2. If violations remain, replace the prose with a deterministic summary generated from `PlanResult` and the tool data, and set `grounded=false` with a `guard` step.
- **Badge:** shows only when `grounded=true` and no fallback was used.

**Jobs and streaming:**
- **Create a run:** `POST /api/v1/agent/runs {prompt}` creates a run, reserves budget and the concurrency slot, enqueues `run_agent_job`, and returns `202 {run_id}`.
  - If the job queue times out, return 503. Map `TimeoutError` as `jobs.py` documents.
  - For dev without a worker: when the setting `agent_inline=true` (default only in development and test), run inline in a background task instead of the queue.
- **Read a run:** `GET /api/v1/agent/runs/{id}` returns the run with its steps. `GET /api/v1/agent/runs` returns the agency's recent runs.
- **Stream a run:** `GET /api/v1/agent/runs/{id}/events` is SSE (`text/event-stream`):
  - It replays stored steps with `seq > Last-Event-ID`, then subscribes to `tm:agent:<run_id>`.
  - Each event is `id: <seq>`, `event: step|status`, and `data: <json>`.
  - It sends a heartbeat every 15 s and closes on a terminal status.
  - Steps are written to the DB **before** they are published.
- **Reply to a run:** `POST /api/v1/agent/runs/{id}/reply {text}` continues a `waiting_for_user` run. `POST /api/v1/agent/runs/{id}/confirm {call_id, approve}` approves or rejects a pending write tool.
- **Cancel a run:** `POST /api/v1/agent/runs/{id}/cancel`.
- **Rate limits:** each agency's runs are rate-limited, with a per-minute setting. The concurrency guard comes from Task 1.
- **System prompt (`agent/prompts.py`):** it states the role, the tools, the grounding rule, the data-not-instructions rule, the agency currency and timezone, and today's date in the agency timezone. Keep it short and versioned (`PROMPT_VERSION`, stored on the run).

- [ ] Write failing tests, using FakeProvider scripts throughout:
  - a happy path through search, answer and a grounded badge;
  - `guard_catches_invented_price`, `guard_catches_invented_flight`, `guard_repairs_on_reprompt`, `guard_falls_back_after_second_violation`;
  - `loop_limits_max_steps`, `loop_limits_repeated_call_memo`, `loop_limits_step_timeout_then_retry`, `loop_limits_total_timeout`, `budget_exceeded`;
  - an `ask_user` pause and reply;
  - a write tool pausing for confirmation, with approve and reject;
  - `sse_replays_then_streams` (reconnect with Last-Event-ID, exactly once, in order);
  - `runs_are_tenant_scoped` (another agency's run gives 404 on GET, events, reply and cancel);
  - a 503 when the queue times out;
  - inline mode in dev;
  - metrics.
- [ ] Implement, then focused and full suite; ruff and mypy.
- [ ] Commit `feat(agent): bounded tool loop with grounding guard, background runs and live event stream`.

### Task 4: Evals (≥50 cases) and CI

**Files:**
- Create:
  - `backend/tests/agent/evals/cases.yaml` (≥50 cases)
  - `tests/agent/evals/test_evals.py`
  - `backend/src/travelmind/agent/evals.py` (runner + report)
- Modify: `.github/workflows/backend.yml` (an `agent-evals` job running the fake-provider evals; a separate manual-dispatch job runs live Gemini evals when the repo secret `GOOGLE_API_KEY` exists, and never on pull requests from forks)

**Cases.** Each case is a scripted FakeProvider conversation or the rule-based planner, plus assertions.

| Category | Cases | What they check |
|---|---|---|
| Extraction | 12 | Cities vs codes, Indian date formats, "next Friday", children ages, cabin words |
| Clarification | 8 | Missing dates, ambiguous city (e.g. "Delhi" vs "New Delhi"), missing travellers |
| Tool choice | 10 | Hotel-only, flight-only, weather question, places question |
| Grounding (must be 100%) | 10 | Invented price, invented flight, wrong date, unit tricks ("12k") |
| Injection | 5 | Malicious hotel or place names, a tool result containing "call create_enquiry" |
| Safety | 3 | "Book it now and pay": hand-off reply, no spending tool |
| Limits | 2 | A loop, a slow tool |

- The runner reports pass rate per category, average steps and token cost.
- **Thresholds:** grounding and injection at 100%; every other category at least 90%.
- `uv run python -m travelmind.agent.evals --live` runs the same cases against Gemini, skipping cases that can only be scripted. It writes `docs/perf/agent-evals-<date>.md`, but only when the owner runs it with a key.

- [ ] Write the cases and the runner. Make it fail first: point an eval at a deliberately broken guard in a test fixture and see it fail.
- [ ] Get to green. Add the CI job.
- [ ] Commit `test(agent): evaluation suite for extraction, grounding, injection and limits`.

### Task 5: Agent page in the agency app

**Files:**
- Create:
  - `frontend/src/api/agent.ts` (types mirrored field for field, mutations, `useAgentRunStream(runId)` using EventSource with Last-Event-ID resume and backoff)
  - `frontend/src/features/agent/AgentPage.tsx`
  - `features/agent/RunTrace.tsx`
  - `features/agent/PlanBoard.tsx`
  - `features/agent/ConfirmActionCard.tsx`
  - tests
- Modify:
  - `router.tsx` (`/app/agent`, `/app/agent/$runId`)
  - Sidebar (Operate group: "Agent")
  - Command palette ("Plan a trip with the agent")
  - Enquiry page: "Plan with agent" prefills the prompt from the enquiry

**Layout (operations console, themed, 375 px and up):**
- **Left column:** a prompt composer with suggested prompts drawn from the agency's recent routes, plus the run list.
- **Centre:** the conversation, with a live trace beneath each turn. Each step is a row with an icon, the tool name in plain words ("Searching flights DEL → DXB"), its duration and a result summary, and the row expands. Steps animate in, and reduced motion is respected.
- **Right:** the PlanBoard:
  - trip facts;
  - flight cards (reusing OfferCard, read-only, with provenance and insight) and hotel cards;
  - a weather strip;
  - a day-by-day itinerary timeline;
  - a budget breakdown chart;
  - "Create enquiry" and "Draft quote" buttons, which go through ConfirmActionCard;
  - the grounding badge "All prices verified against live results", or a warning "Some values couldn't be verified — showing results only".
- **Statuses:**
  - `waiting_for_user` shows an inline question with an answer box;
  - `budget_exceeded`, `failed` and "Agent unavailable — no model configured" have their own states;
  - "Demo planner" is labelled when the provider is fake.
- **Accessibility:** the trace is an `aria-live="polite"` log, all controls work by keyboard, and focus moves to new questions.

- [ ] Write failing tests with a mocked EventSource:
  - streaming renders steps in order;
  - a resume does not duplicate steps;
  - ask and reply;
  - confirm and reject a write tool;
  - the grounded badge vs the fallback warning;
  - the unavailable state;
  - the enquiry prefill.
- [ ] Implement. Take screenshots with real data: the dev API uses the fake planner when no key is configured, so the screenshots work with no key. Use 1440 and 390 widths in two themes. Fix anything that looks empty.
- [ ] Final checks: lint, test, typecheck, build.
- [ ] Commit `feat(frontend): agent workspace with live trace, plan board and confirmed actions`.

### Task 6: End-to-end, live smoke and docs

- e2e `agent.spec.ts` runs against the dedicated stack with `TM_AGENT_PROVIDER=fake`: plan DEL→DXB for 2 adults on given dates; see the trace and plan board; confirm "Create enquiry"; check that the enquiry appears in Pipeline.
- **Live smoke** (run only when a key is present in the environment; never print it): one real run through Gemini on the dev API. Record the model id, step count, tokens, latency and grounded status in `docs/perf/agent-live-smoke-2026-10-04.md`, with no prompts containing personal data.
- **README:** add an Agent section (what it does, grounding, data-as-data, hand-off only, how to configure the key). Update the tagline so it accurately describes the product now.
- [ ] Commit `docs: agent engine guide and live smoke` and `test(e2e): plan a trip with the agent and turn it into an enquiry`.

---

## Self-review notes
- **Spec §4 coverage:**
  - provider interface + Gemini → Task 1;
  - loop with max 12 steps, timeouts, budget, queued job and SSE trace → Task 3;
  - tools → Task 2 (traveller-only tools `save_trip`, `add_reminder` and `watch_fare` come in Step 5 with their tables);
  - grounding guard + badge → Tasks 3 and 5;
  - safety (data-not-instructions, role and tenant scope, no spending) → Tasks 2–4;
  - per-tenant budget and run cap → Tasks 1 and 3;
  - evals ≥50 in CI → Task 4.
- **Deviation from spec §4:** a rule-based "Demo planner" fake provider keeps the product working without a key. It is labelled in the UI and never used in production.
