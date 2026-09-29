# M1 · Plan 2 — Mission Control Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy prototype UI with the "Mission Control" React app — sci-fi design system, auth screens, app shell with live status bar, a 3D route globe over real airport data, a route scanner, a command palette, and a crew (team) page — all on the merged backend, plus the backend fixes parked in Plan 1.

**Architecture:** A Vite + React 19 + TypeScript single-page app in `frontend/`, served on `http://localhost:5173`. It calls the API only through same-origin paths (`/api/*`, `/health`) that Vite proxies to the backend (default `http://localhost:8010`), so the httpOnly session cookie just works. TanStack Router (code-based routes with an auth guard) and TanStack Query (server state, global 401 handling) sit on a small typed API client. Visual language lives in CSS variables consumed by Tailwind v4 utilities; the globe is `react-globe.gl` with hex-dotted countries, lazy-loaded with a no-WebGL fallback.

**Tech Stack:** Node 24, npm, TypeScript ~5.9, React 19, Vite 8, Tailwind CSS 4 (`@tailwindcss/vite`), TanStack Router + Query, react-globe.gl + three, topojson-client + world-atlas, cmdk, lucide-react, @fontsource (Chakra Petch, IBM Plex Sans, JetBrains Mono), Vitest + Testing Library + jsdom, Playwright, oxlint. Backend: Python 3.12 / FastAPI (existing).

**Spec:** `docs/superpowers/specs/2026-09-29-travelmind-saas-design.md` (§10 UX "Mission Control", §11 quality/security, §13 item 9)

### Where this plan sits in Milestone 1 (re-sequenced)

The user asked to *see* the sci-fi product next, so the frontend moves ahead of suppliers and the agent. Everything here runs on the merged Plan 1 backend; later plans plug new panels into this shell.

| Plan | Scope | Status |
|---|---|---|
| 1 | Backend foundation (tenancy, identity, reference data, CI) | ✅ merged |
| **2 (this)** | Mission Control frontend foundation + parked backend fixes | — |
| 3 | Supplier adapters (sandbox, Duffel, LiteAPI), `Offer`, fan-out search, fare snapshots + route insights, carbon; offer cards in the UI | 1, 2 |
| 4 | Agent (tools, grounding guard, SSE run trace), quotes, eval harness; Copilot + Quotes screens | 1–3 |

## Global Constraints

- Node **24**, npm, TypeScript pinned `~5.9.3` (not 7.x — tooling compatibility). All frontend commands run from `frontend/`.
- Frontend dev server: `http://localhost:5173` (`strictPort`). Backend dev port: **8010** (port 8000 is taken on the developer machine). Vite proxies `/api` and `/health` to `TM_API_TARGET` (default `http://localhost:8010`). The browser never calls another origin.
- Every API call uses `credentials: "include"`; the frontend never reads, stores, or logs session tokens (the session is the httpOnly `tm_session` cookie).
- Colours come only from the CSS variables in `src/styles/theme.css` (via Tailwind tokens like `bg-deck`, `text-primary`); components never hard-code colour values. Two themes: `dark` (default) and `daylight`, on `<html data-theme>`.
- Fonts: display **Chakra Petch**, body **IBM Plex Sans**, data/mono **JetBrains Mono**, self-hosted via @fontsource (no external font requests).
- Accessibility: WCAG AA contrast; `prefers-reduced-motion: reduce` disables animations, scanlines, globe auto-rotate and camera flights; every action is keyboard-reachable; command palette opens with **Ctrl+K** and **⌘K**.
- No fake data: every number on screen comes from the API or from a named client-side calculation that is labelled as an estimate.
- Plain-language errors: show the backend's `detail`; for 5xx also show `Trace ID: <trace_id>`. Never show stack traces.
- `localStorage` is only for per-browser conveniences (theme, recent routes) and every access is wrapped in try/catch.
- Backend rules from Plan 1 still bind Task 1: Python 3.12 via `uv run`, Postgres 5433, Redis 6380, `uv run python -m alembic`, `Annotated[...]` dependencies, plain-language errors, 93+ tests green with `-W error`, ruff + mypy clean.

## Review Focus

1. **Session expires mid-use** (cookie revoked or expired while on `/team`): the next API call must land the user on `/login?redirect=/team` with no loop and no stale data shown; after signing in they return to `/team` — pinned in Task 9 `redirects to login when the session expires` and Task 5 `returns to the page the user asked for`.
2. **Open redirect via `?redirect=`** (`//evil.example`, `https://evil.example`): must be ignored and fall back to `/` — pinned in Task 5 `ignores redirects to other sites`.
3. **Backend down or 5xx**: the UI must stay usable, show a plain message, and show the trace ID for 5xx; the status bar must say the API is degraded (503) or offline (unreachable) — pinned in Task 4 `health maps 200 / 503 / network failure` and the client error tests, Task 5 `status bar reports a degraded API` and `a failing route shows the error with its trace ID`.
4. **Fast typing in airport search**: no request under 2 characters, one request per settled term (debounced), and results always belong to the latest term — pinned in Task 6 `debounces and only searches settled terms`.
5. **No WebGL** (old laptops, locked-down browsers, GPU crash): the globe panel must show a fallback while the scanner and everything else keep working — pinned in Task 7 `shows a fallback when WebGL is unavailable` and `contains a globe crash`.

---

### Task 1: Backend fixes parked from Plan 1 — bounded argon2, login refunds, atomic limiter, main airports first

**Files:**
- Modify: `backend/src/travelmind/identity/passwords.py`, `backend/src/travelmind/identity/service.py`, `backend/src/travelmind/identity/invitations.py`, `backend/src/travelmind/identity/ratelimit.py`, `backend/src/travelmind/identity/router.py`, `backend/src/travelmind/reference/search.py`, `backend/.env.example`
- Test: `backend/tests/identity/test_passwords_tokens.py`, `backend/tests/identity/test_security.py`, `backend/tests/reference/test_search.py`

**Interfaces:**
- Consumes: existing `passwords.hash_password/verify_password`, `LoginRateLimiter(redis, max_attempts, window_seconds)` with `hit(key) -> bool` and `reset(key)`, `CITY_ALIASES`, `AirportIndex`, `AirportRecord`.
- Produces: `passwords.ARGON2_MAX_CONCURRENCY = 4`, `async hash_password_async(password) -> str`, `async verify_password_async(password_hash, password) -> bool`; `LoginRateLimiter.refund(key) -> None`; multi-city entries in `CITY_ALIASES` whose tuple order is the ranking order.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/identity/test_passwords_tokens.py`:

```python
import asyncio
import threading
import time

from travelmind.identity import passwords


class _ConcurrencyProbe:
    """Stands in for the argon2 hasher and records how many hashes run at once."""

    def __init__(self):
        self._lock = threading.Lock()
        self.active = 0
        self.peak = 0

    def hash(self, password):
        with self._lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
        time.sleep(0.05)
        with self._lock:
            self.active -= 1
        return f"hashed:{password}"


async def test_password_hashing_concurrency_is_capped(monkeypatch):
    probe = _ConcurrencyProbe()
    monkeypatch.setattr(passwords, "_hasher", probe)
    results = await asyncio.gather(*(passwords.hash_password_async(f"pw-{i}") for i in range(12)))
    assert results == [f"hashed:pw-{i}" for i in range(12)]
    assert 2 <= probe.peak <= passwords.ARGON2_MAX_CONCURRENCY == 4
```

Append to `backend/tests/identity/test_security.py` (add `import os` and `from redis.asyncio import Redis` to the imports, and `DEFAULT_PASSWORD` to the `tests.helpers` import):

```python
async def test_successful_logins_do_not_use_up_the_network_limit(client):
    await signup(client)
    good = {"email": "owner@alphatravels.com", "password": DEFAULT_PASSWORD}
    for _ in range(55):
        r = await client.post(LOGIN, json=good)
        assert r.status_code == 200


async def test_rate_limit_keys_always_expire(client):
    await client.post(LOGIN, json=WRONG)
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        keys = [key async for key in redis.scan_iter("rl:*")]
        assert keys
        for key in keys:
            assert await redis.ttl(key) > 0
    finally:
        await redis.aclose()
```

Append to `backend/tests/reference/test_search.py` (add `AirportRecord` to the `travelmind.reference.search` import if missing):

```python
def _record(code, name, city, country, country_name, kind="large_airport"):
    return AirportRecord(code, name, city, country, country_name, kind, True, 0.0, 0.0, None)


PRIMARY_INDEX = AirportIndex(
    [
        _record("LGW", "London Gatwick Airport", "London", "GB", "United Kingdom"),
        _record("LHR", "London Heathrow Airport", "London", "GB", "United Kingdom"),
        _record("LCY", "London City Airport", "London", "GB", "United Kingdom", "medium_airport"),
        _record("ORY", "Paris-Orly Airport", "Paris", "FR", "France"),
        _record("CDG", "Charles de Gaulle International Airport", "Paris", "FR", "France"),
        _record("HND", "Tokyo Haneda International Airport", "Tokyo", "JP", "Japan"),
        _record("NRT", "Narita International Airport", "Narita", "JP", "Japan"),
    ]
)


def _top(query, n):
    return [hit.airport.iata_code for hit in PRIMARY_INDEX.search(query, n)]


def test_multi_airport_cities_list_the_main_airport_first():
    assert _top("london", 3) == ["LHR", "LGW", "LCY"]
    assert _top("paris", 2) == ["CDG", "ORY"]
    assert _top("tokyo", 2) == ["HND", "NRT"]


def test_specific_airport_names_still_win_over_the_city_alias():
    assert _top("london city", 1) == ["LCY"]
    assert _top("orly", 1) == ["ORY"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && uv run python -m pytest tests/identity/test_passwords_tokens.py tests/identity/test_security.py tests/reference/test_search.py -q`
Expected: FAIL — `AttributeError: ... has no attribute 'hash_password_async'`; the 51st successful login returns 429; `london` returns LGW first.

- [ ] **Step 3: Bound argon2 with a dedicated pool**

Replace `backend/src/travelmind/identity/passwords.py`:

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()

# Each argon2 call uses ~64 MiB and 4 lanes. A small dedicated pool caps memory (~256 MiB)
# under a login burst and keeps password work out of the shared threadpool other routes use.
ARGON2_MAX_CONCURRENCY = 4
_argon2_pool = ThreadPoolExecutor(
    max_workers=ARGON2_MAX_CONCURRENCY, thread_name_prefix="argon2"
)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


async def hash_password_async(password: str) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_argon2_pool, hash_password, password)


async def verify_password_async(password_hash: str, password: str) -> bool:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_argon2_pool, verify_password, password_hash, password)
```

In `backend/src/travelmind/identity/service.py`:
- change the passwords import to `from travelmind.identity.passwords import hash_password, hash_password_async, verify_password_async` (`hash_password` stays for `_TIMING_DUMMY_HASH`; `verify_password` is no longer used here), and remove the `run_in_threadpool` import;
- change the comment above `_TIMING_DUMMY_HASH` to `# Argon2 is CPU-heavy (~50 ms): request paths use the bounded async wrappers in passwords.py.`;
- replace `await run_in_threadpool(hash_password, password)` with `await hash_password_async(password)`;
- replace `await run_in_threadpool(verify_password, _TIMING_DUMMY_HASH, password)` with `await verify_password_async(_TIMING_DUMMY_HASH, password)`;
- replace `await run_in_threadpool(verify_password, user.password_hash, password)` with `await verify_password_async(user.password_hash, password)`.

In `backend/src/travelmind/identity/invitations.py`: import `hash_password_async` (instead of `hash_password`), remove the `run_in_threadpool` import, and replace `await run_in_threadpool(hash_password, password)` with `await hash_password_async(password)`.

- [ ] **Step 4: Make the limiter atomic and refundable**

Replace `backend/src/travelmind/identity/ratelimit.py`:

```python
import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

log = structlog.get_logger()

# Give back one attempt without ever going below zero (a missing key stays missing).
_REFUND_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
"""


class LoginRateLimiter:
    """Fixed-window counter. Fails open (allows) if Redis is unreachable, and logs it."""

    def __init__(self, redis: Redis, max_attempts: int, window_seconds: int) -> None:
        self._redis = redis
        self._max = max_attempts
        self._window = window_seconds

    async def hit(self, key: str) -> bool:
        try:
            # INCR + EXPIRE NX in one transaction: every counter gets a TTL, so a failure
            # between the two commands can never leave a permanent lockout behind.
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.expire(key, self._window, nx=True)
                count, _ = await pipe.execute()
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error=str(exc))
            return True
        return int(count) <= self._max

    async def reset(self, key: str) -> None:
        try:
            await self._redis.delete(key)
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error=str(exc))

    async def refund(self, key: str) -> None:
        """Give back one attempt, e.g. after a successful login."""
        try:
            await self._redis.eval(_REFUND_SCRIPT, 1, key)  # type: ignore[misc]
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error=str(exc))
```

(If mypy reports the `type: ignore` as unused, delete the comment.)

In `backend/src/travelmind/identity/router.py` `login_route`: introduce `ip_key = f"rl:login-ip:{ip}"`, use it in `ip_limiter.hit(ip_key)`, change the comment above `ip_limiter` to `# Per-IP ceiling stops one client rotating emails; successful logins refund their slot.`, and after `await limiter.reset(key)` add `await ip_limiter.refund(ip_key)`.

- [ ] **Step 5: Rank each city's main airport first**

In `backend/src/travelmind/reference/search.py`, add these entries at the end of `CITY_ALIASES` (keep existing entries):

```python
    # Multi-airport cities, in priority order: the first code is the main international airport.
    "london": ("LHR", "LGW", "STN", "LTN", "LCY"),
    "paris": ("CDG", "ORY"),
    "new york": ("JFK", "EWR", "LGA"),
    "tokyo": ("HND", "NRT"),
    "seoul": ("ICN", "GMP"),
    "osaka": ("KIX", "ITM"),
    "chicago": ("ORD", "MDW"),
    "washington": ("IAD", "DCA", "BWI"),
    "houston": ("IAH", "HOU"),
    "buenos aires": ("EZE", "AEP"),
    "sao paulo": ("GRU", "CGH", "VCP"),
    "rome": ("FCO", "CIA"),
    "milan": ("MXP", "LIN", "BGY"),
    "moscow": ("SVO", "DME", "VKO"),
    "istanbul": ("IST", "SAW"),
    "bangkok": ("BKK", "DMK"),
    "shanghai": ("PVG", "SHA"),
    "beijing": ("PEK", "PKX"),
    "dubai": ("DXB", "DWC"),
    "toronto": ("YYZ", "YTZ"),
```

Add a constant next to `ALIAS_SCORE`:

```python
# Alias tuples are ordered by priority; each earlier position outranks any type/scheduled boost.
ALIAS_PRIORITY_STEP = 100.0
```

In `AirportIndex._score`, replace `return ALIAS_SCORE + boost` with:

```python
            position = aliases.index(airport.iata_code)
            return ALIAS_SCORE + ALIAS_PRIORITY_STEP * (len(aliases) - position) + boost
```

- [ ] **Step 6: Document the limiter settings**

Append to `backend/.env.example`:

```dotenv
# Rate limits (defaults shown)
TM_LOGIN_MAX_ATTEMPTS=10
TM_LOGIN_IP_MAX_ATTEMPTS=50
TM_LOGIN_WINDOW_SECONDS=900
TM_SIGNUP_MAX_PER_IP=10
TM_SIGNUP_WINDOW_SECONDS=3600
```

- [ ] **Step 7: Run all backend checks**

Run: `cd backend && uv run python -m pytest -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`
Expected: all tests pass (existing `goa → GOI, GOX, GOA`, `sao paulo → GRU` and the spy test still pass), ruff and mypy clean.

- [ ] **Step 8: Smoke-test on the real 8,801-airport data**

Start the API: `cd backend && uv run python -m uvicorn travelmind.main:create_app --factory --port 8010` (background). Sign up a throwaway user with curl (cookie jar), then query `q=london`, `q=paris`, `q=tokyo`, `q=new york`, `q=goa`, `q=dehli`, `q=london heathrow` with `limit=3`. Expected first results: LHR, CDG, HND, JFK, GOI, DEL, LHR. Record the outputs in the report, then stop the server.

- [ ] **Step 9: Commit**

```bash
cd /d/travel-rag-agent
git add backend
git commit -m "fix(backend): bound argon2 concurrency, refund successful logins, atomic limiter, main airports first

"
```

---

### Task 2: Frontend scaffold, theme tokens, test harness

**Files:**
- Delete: legacy `frontend/` (entire directory)
- Create: `frontend/package.json`, `frontend/package-lock.json` (npm), `frontend/.gitignore`, `frontend/.env.example`, `frontend/.oxlintrc.json`, `frontend/index.html`, `frontend/public/favicon.svg`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/styles/index.css`, `frontend/src/styles/theme.css`, `frontend/src/test/setup.ts`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:watch`, `e2e`; Tailwind colour utilities `void`, `deck`, `raised`, `line`, `ink`, `dim`, `primary`, `primary-ink`, `warn`, `ai`, `ok`, `danger`; font utilities `font-display`, `font-sans`, `font-mono`; CSS utilities `tm-grid`, `tm-glow`, `tm-scanlines`, `tm-blink`, `tm-spin-slow`; CSS variables `--tm-*` including `--tm-globe-land` and `--tm-globe-ocean`; the Vitest setup file (jsdom polyfills, cleanup, localStorage reset).

- [ ] **Step 1: Remove the legacy UI and create the package**

```bash
cd /d/travel-rag-agent
git rm -r -q frontend
rm -rf frontend
mkdir -p frontend/src/styles frontend/src/test frontend/public
```

Create `frontend/package.json`:

```json
{
  "name": "travelmind-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.json",
    "lint": "oxlint --deny-warnings --ignore-pattern dist --ignore-pattern playwright-report .",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  }
}
```

Install dependencies (all plan dependencies now, so later tasks don't churn the lockfile):

```bash
cd frontend
npm install react react-dom @tanstack/react-query @tanstack/react-router react-globe.gl three topojson-client world-atlas cmdk lucide-react @fontsource/chakra-petch @fontsource/ibm-plex-sans @fontsource/jetbrains-mono
npm install -D typescript@~5.9.3 vite @vitejs/plugin-react tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom @types/node @types/three @types/topojson-client @types/topojson-specification oxlint @playwright/test
```

Create `frontend/.gitignore`:

```gitignore
node_modules/
dist/
playwright-report/
test-results/
.env.local
```

Create `frontend/.env.example`:

```dotenv
# Where the Vite dev server proxies /api and /health (the FastAPI backend).
TM_API_TARGET=http://localhost:8010
```

Create `frontend/.oxlintrc.json`:

```json
{
  "plugins": ["react", "typescript"],
  "categories": { "correctness": "error" }
}
```

- [ ] **Step 2: Configure TypeScript, Vite and Vitest**

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

Create `frontend/vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "TM_");
  const target = env.TM_API_TARGET || "http://localhost:8010";
  // Same-origin proxy: the browser only ever talks to :5173, so the httpOnly session
  // cookie is first-party and the backend's Origin check sees http://localhost:5173.
  const proxy = { "/api": { target }, "/health": { target } };
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    build: { chunkSizeWarningLimit: 1600 },
  };
});
```

Create `frontend/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
  },
});
```

Create `frontend/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom lacks these browser APIs; components use them for motion, layout and list scrolling.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  try {
    window.localStorage.clear();
  } catch {
    // storage unavailable in this environment
  }
  document.documentElement.removeAttribute("data-theme");
});
```

- [ ] **Step 3: Write the failing test**

Create `frontend/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";

test("renders the TravelMind wordmark", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /travelmind/i })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./App"`.

- [ ] **Step 5: Create the page shell, theme and styles**

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>TravelMind — Mission Control</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `frontend/public/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#05070d"/><circle cx="16" cy="16" r="8.5" fill="none" stroke="#22d3ee" stroke-width="2"/><ellipse cx="16" cy="16" rx="13" ry="4.5" fill="none" stroke="#e879f9" stroke-width="1.5" transform="rotate(-25 16 16)"/><circle cx="26.5" cy="11" r="2" fill="#22d3ee"/></svg>
```

Create `frontend/src/styles/theme.css`:

```css
/* Design tokens. The only place colour values live; everything else uses these variables. */
:root,
[data-theme="dark"] {
  --tm-void: #05070d;
  --tm-deck: #0a0f1c;
  --tm-raised: #0f1729;
  --tm-line: #1c2a44;
  --tm-grid-line: rgb(56 189 248 / 0.07);
  --tm-text: #e6f1ff;
  --tm-text-dim: #8aa0bf;
  --tm-primary: #22d3ee;
  --tm-primary-ink: #03141a;
  --tm-warn: #fbbf24;
  --tm-ai: #e879f9;
  --tm-ok: #34d399;
  --tm-danger: #fb7185;
  --tm-globe-land: #1f6f8b;
  --tm-globe-ocean: #07101f;
}

[data-theme="daylight"] {
  --tm-void: #f3f6fb;
  --tm-deck: #ffffff;
  --tm-raised: #eef3fa;
  --tm-line: #cfd9e8;
  --tm-grid-line: rgb(14 116 144 / 0.06);
  --tm-text: #0b1526;
  --tm-text-dim: #4a5b75;
  --tm-primary: #0e7490;
  --tm-primary-ink: #ffffff;
  --tm-warn: #b45309;
  --tm-ai: #a21caf;
  --tm-ok: #047857;
  --tm-danger: #be123c;
  --tm-globe-land: #6aa8c2;
  --tm-globe-ocean: #e3edf7;
}

@theme inline {
  --color-void: var(--tm-void);
  --color-deck: var(--tm-deck);
  --color-raised: var(--tm-raised);
  --color-line: var(--tm-line);
  --color-ink: var(--tm-text);
  --color-dim: var(--tm-text-dim);
  --color-primary: var(--tm-primary);
  --color-primary-ink: var(--tm-primary-ink);
  --color-warn: var(--tm-warn);
  --color-ai: var(--tm-ai);
  --color-ok: var(--tm-ok);
  --color-danger: var(--tm-danger);
  --font-display: "Chakra Petch", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
}
```

Create `frontend/src/styles/index.css`:

```css
@import "tailwindcss";
@import "./theme.css";

@layer base {
  html {
    color-scheme: dark;
  }
  html[data-theme="daylight"] {
    color-scheme: light;
  }
  body {
    @apply bg-void font-sans text-ink antialiased;
    min-height: 100dvh;
  }
  :focus-visible {
    outline: 2px solid var(--tm-primary);
    outline-offset: 2px;
  }
  ::selection {
    background: color-mix(in oklab, var(--tm-primary) 35%, transparent);
  }
}

/* Blueprint grid behind the deck. */
@utility tm-grid {
  background-image:
    linear-gradient(var(--tm-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--tm-grid-line) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* Soft instrument glow for primary actions. */
@utility tm-glow {
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--tm-primary) 45%, transparent),
    0 0 22px -6px color-mix(in oklab, var(--tm-primary) 60%, transparent);
}

/* CRT scanlines over the whole deck (dark theme only). */
@utility tm-scanlines {
  &::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 50;
    background: repeating-linear-gradient(
      to bottom,
      rgb(255 255 255 / 0.022) 0 1px,
      transparent 1px 3px
    );
  }
}

@utility tm-blink {
  animation: tm-blink 1s steps(2, start) infinite;
}

@utility tm-spin-slow {
  animation: tm-spin 24s linear infinite;
}

@keyframes tm-blink {
  to {
    visibility: hidden;
  }
}

@keyframes tm-spin {
  to {
    transform: rotate(360deg);
  }
}

[data-theme="daylight"] .tm-scanlines::after {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
  .tm-scanlines::after {
    display: none;
  }
}
```

Create `frontend/src/App.tsx`:

```tsx
export function App() {
  return (
    <main className="tm-grid flex min-h-dvh items-center justify-center">
      <h1 className="font-display text-4xl tracking-[0.35em] text-primary">TRAVELMIND</h1>
    </main>
  );
}
```

Create `frontend/src/main.tsx`:

```tsx
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Run every check**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: 1 test passes; typecheck, lint and build succeed with no warnings.

- [ ] **Step 7: Smoke-test the dev server and the proxy**

Start the backend on 8010 (`cd ../backend && uv run python -m uvicorn travelmind.main:create_app --factory --port 8010`, background) and `npm run dev` (background). Then:
```bash
curl -s http://localhost:5173/ | grep -o "<title>.*</title>"
curl -s http://localhost:5173/health
```
Expected: `<title>TravelMind — Mission Control</title>` and `{"status":"ok","database":"ok"}` (served through the proxy). Stop both servers.

- [ ] **Step 8: Commit**

```bash
cd /d/travel-rag-agent
git add -A frontend
git commit -m "feat(frontend): Vite + React + Tailwind scaffold with Mission Control theme tokens

"
```

---

### Task 3: UI kit — panels, controls, readouts, theme switching, design gallery

**Files:**
- Create: `frontend/src/ui/cn.ts`, `frontend/src/ui/Panel.tsx`, `frontend/src/ui/Button.tsx`, `frontend/src/ui/TextField.tsx`, `frontend/src/ui/Badge.tsx`, `frontend/src/ui/Readout.tsx`, `frontend/src/ui/StatusDot.tsx`, `frontend/src/ui/theme.ts`, `frontend/src/ui/ThemeToggle.tsx`, `frontend/src/ui/useReducedMotion.ts`, `frontend/src/ui/DesignGallery.tsx`
- Test: `frontend/src/ui/ui.test.tsx`, `frontend/src/ui/theme.test.tsx`, `frontend/src/ui/DesignGallery.test.tsx`

**Interfaces:**
- Consumes: Tailwind tokens and utilities from Task 2.
- Produces:
  - `cn(...parts: Array<string | false | null | undefined>): string`
  - `<Panel title? eyebrow? actions? tone?: "default" | "ai" className? children>` → `<section>` labelled by its title
  - `<Button variant?: "primary" | "ghost" | "danger" size?: "sm" | "md" loading? ...button props>` (defaults `type="button"`)
  - `<TextField label error? hint? ...input props>`
  - `<Badge tone?: "neutral" | "primary" | "ok" | "warn" | "danger" | "ai">`
  - `<Readout label value unit? hint?>` — renders `<dt>`/`<dd>`; always wrap Readouts in a `<dl>`
  - `<StatusDot status: "ok" | "degraded" | "down" | "unknown" label>`
  - `type Theme = "dark" | "daylight"`, `initTheme(): Theme`, `getTheme(): Theme`, `setTheme(theme): void`, `useTheme(): [Theme, (t: Theme) => void]`
  - `<ThemeToggle />`, `useReducedMotion(): boolean`, `<DesignGallery />`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/ui/ui.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Panel } from "./Panel";
import { Readout } from "./Readout";
import { StatusDot } from "./StatusDot";
import { TextField } from "./TextField";
import { cn } from "./cn";

test("cn joins truthy class names", () => {
  expect(cn("a", false, null, undefined, "b")).toBe("a b");
});

test("Panel is a region named by its title and shows the eyebrow", () => {
  render(
    <Panel eyebrow="Orbital view" title="Route globe">
      body
    </Panel>,
  );
  expect(screen.getByRole("region", { name: "Route globe" })).toHaveTextContent("body");
  expect(screen.getByText("Orbital view")).toBeInTheDocument();
});

test("Button defaults to type=button and clicks", async () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Engage</Button>);
  const button = screen.getByRole("button", { name: "Engage" });
  expect(button).toHaveAttribute("type", "button");
  await userEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

test("a loading Button is busy and cannot be clicked", async () => {
  const onClick = vi.fn();
  render(
    <Button loading onClick={onClick}>
      Engage
    </Button>,
  );
  const button = screen.getByRole("button", { name: /engage/i });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});

test("TextField links its label, hint and error", () => {
  const { rerender } = render(<TextField label="Password" hint="At least 10 characters" />);
  const input = screen.getByLabelText("Password");
  expect(input).toHaveAccessibleDescription("At least 10 characters");
  expect(input).not.toHaveAttribute("aria-invalid");

  rerender(<TextField label="Password" hint="At least 10 characters" error="Too short" />);
  expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Too short");
});

test("Readout shows label, value and unit", () => {
  render(
    <dl>
      <Readout label="Distance" value="1,138" unit="km" hint="615 nmi" />
    </dl>,
  );
  expect(screen.getByText("Distance")).toBeInTheDocument();
  expect(screen.getByText("1,138")).toBeInTheDocument();
  expect(screen.getByText("km")).toBeInTheDocument();
  expect(screen.getByText("615 nmi")).toBeInTheDocument();
});

test("StatusDot exposes its label as text", () => {
  render(<StatusDot status="down" label="API offline" />);
  expect(screen.getByText("API offline")).toBeInTheDocument();
});

test("Badge renders its content", () => {
  render(<Badge tone="ai">owner</Badge>);
  expect(screen.getByText("owner")).toBeInTheDocument();
});
```

Create `frontend/src/ui/theme.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { getTheme, initTheme, setTheme } from "./theme";

beforeEach(() => {
  window.localStorage.clear();
  initTheme();
});

test("defaults to the dark theme", () => {
  expect(initTheme()).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("remembers the chosen theme across reloads", () => {
  setTheme("daylight");
  expect(document.documentElement.dataset.theme).toBe("daylight");
  expect(initTheme()).toBe("daylight");
});

test("ignores junk stored values", () => {
  window.localStorage.setItem("tm-theme", "neon");
  expect(initTheme()).toBe("dark");
});

test("still switches theme when storage throws", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  setTheme("daylight");
  expect(getTheme()).toBe("daylight");
  expect(document.documentElement.dataset.theme).toBe("daylight");
});

test("ThemeToggle flips the theme and updates its label", async () => {
  render(<ThemeToggle />);
  await userEvent.click(screen.getByRole("button", { name: "Switch to daylight theme" }));
  expect(document.documentElement.dataset.theme).toBe("daylight");
  expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
});
```

Create `frontend/src/ui/DesignGallery.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { DesignGallery } from "./DesignGallery";

test("the design gallery documents every token and component family", () => {
  render(<DesignGallery />);
  for (const section of ["Colour tokens", "Typography", "Controls", "Fields", "Signals", "Readouts", "Panels"]) {
    expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
  }
  for (const token of ["--tm-void", "--tm-primary", "--tm-ai", "--tm-warn", "--tm-danger", "--tm-ok"]) {
    expect(screen.getByText(token)).toBeInTheDocument();
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — unresolved imports `./Badge`, `./theme`, `./DesignGallery`.

- [ ] **Step 3: Implement the kit**

Create `frontend/src/ui/cn.ts`:

```ts
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
```

Create `frontend/src/ui/Panel.tsx`:

```tsx
import { useId, type ReactNode } from "react";
import { cn } from "./cn";

type PanelProps = {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  tone?: "default" | "ai";
  className?: string;
  children: ReactNode;
};

const CORNERS = [
  "-left-px -top-px border-l-2 border-t-2",
  "-right-px -top-px border-r-2 border-t-2",
  "-bottom-px -left-px border-b-2 border-l-2",
  "-bottom-px -right-px border-b-2 border-r-2",
];

/** HUD-style instrument panel: bracketed corners, eyebrow label, optional header actions. */
export function Panel({ title, eyebrow, actions, tone = "default", className, children }: PanelProps) {
  const titleId = useId();
  const accent = tone === "ai" ? "border-ai/70" : "border-primary/70";
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn("relative rounded-sm border border-line bg-deck/85 p-4 backdrop-blur-sm", className)}
    >
      {CORNERS.map((corner) => (
        <span key={corner} aria-hidden="true" className={cn("pointer-events-none absolute h-3 w-3", corner, accent)} />
      ))}
      {(title || eyebrow || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {eyebrow && (
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{eyebrow}</p>
            )}
            {title && (
              <h2 id={titleId} className="font-display text-lg tracking-wide text-ink">
                {title}
              </h2>
            )}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
```

Create `frontend/src/ui/Button.tsx`:

```tsx
import type { ComponentProps } from "react";
import { cn } from "./cn";

type Variant = "primary" | "ghost" | "danger";

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
};

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-ink tm-glow hover:brightness-110",
  ghost: "border border-line text-ink hover:border-primary/70 hover:text-primary",
  danger: "border border-danger/60 text-danger hover:bg-danger/10",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-sm font-display uppercase tracking-[0.14em] transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && (
        <span aria-hidden="true" className="tm-blink font-mono">
          ▮▮
        </span>
      )}
      {children}
    </button>
  );
}
```

Create `frontend/src/ui/TextField.tsx`:

```tsx
import { useId, type ComponentProps } from "react";
import { cn } from "./cn";

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  error?: string;
  hint?: string;
};

export function TextField({ label, error, hint, className, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const showHint = Boolean(hint) && !error;
  const describedBy = error ? errorId : showHint ? hintId : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-10 rounded-sm border bg-void/60 px-3 text-ink outline-none transition placeholder:text-dim/60",
          "focus:border-primary",
          error ? "border-danger" : "border-line",
        )}
        {...input}
      />
      {showHint && (
        <p id={hintId} className="text-xs text-dim">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
```

Create `frontend/src/ui/Badge.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "primary" | "ok" | "warn" | "danger" | "ai";

const TONES: Record<Tone, string> = {
  neutral: "border-line text-dim",
  primary: "border-primary/50 text-primary",
  ok: "border-ok/50 text-ok",
  warn: "border-warn/50 text-warn",
  danger: "border-danger/50 text-danger",
  ai: "border-ai/50 text-ai",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
```

Create `frontend/src/ui/Readout.tsx`:

```tsx
/** A labelled instrument value. Renders <dt>/<dd>: always place Readouts inside a <dl>. */
export function Readout({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</dt>
      <dd className="font-mono text-2xl text-ink">
        {value}
        {unit && <span className="ml-1 text-sm text-dim">{unit}</span>}
      </dd>
      {hint && <dd className="text-xs text-dim">{hint}</dd>}
    </div>
  );
}
```

Create `frontend/src/ui/StatusDot.tsx`:

```tsx
import { cn } from "./cn";

export type Status = "ok" | "degraded" | "down" | "unknown";

const DOT: Record<Status, string> = {
  ok: "bg-ok",
  degraded: "bg-warn",
  down: "bg-danger",
  unknown: "bg-dim",
};

export function StatusDot({ status, label }: { status: Status; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", DOT[status], status === "ok" && "tm-blink")} />
      <span>{label}</span>
    </span>
  );
}
```

Create `frontend/src/ui/theme.ts`:

```ts
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "daylight";

const STORAGE_KEY = "tm-theme";
const listeners = new Set<() => void>();
let current: Theme = "dark";

function readStored(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "daylight" ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  current = theme;
  document.documentElement.dataset.theme = theme;
}

/** Call once before first render so the saved theme paints without a flash. */
export function initTheme(): Theme {
  apply(readStored() ?? "dark");
  return current;
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  apply(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, quota): the theme still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  return [theme, setTheme];
}
```

Create `frontend/src/ui/ThemeToggle.tsx`:

```tsx
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "daylight" : "dark";
  const label = next === "daylight" ? "Switch to daylight theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
      className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line text-dim transition hover:border-primary/70 hover:text-primary"
    >
      {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
}
```

Create `frontend/src/ui/useReducedMotion.ts`:

```ts
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
```

Create `frontend/src/ui/DesignGallery.tsx`:

```tsx
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Panel } from "./Panel";
import { Readout } from "./Readout";
import { StatusDot } from "./StatusDot";
import { TextField } from "./TextField";

const TOKENS = [
  "--tm-void",
  "--tm-deck",
  "--tm-raised",
  "--tm-line",
  "--tm-text",
  "--tm-text-dim",
  "--tm-primary",
  "--tm-ai",
  "--tm-warn",
  "--tm-ok",
  "--tm-danger",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-sm uppercase tracking-[0.25em] text-primary">{title}</h2>
      {children}
    </section>
  );
}

/** Living style guide for the Mission Control design language. */
export function DesignGallery() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">Design system</p>
        <h1 className="font-display text-2xl text-ink">Mission Control</h1>
      </header>

      <Section title="Colour tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {TOKENS.map((token) => (
            <li key={token} className="flex flex-col gap-1">
              <span className="h-12 rounded-sm border border-line" style={{ background: `var(${token})` }} />
              <code className="font-mono text-xs text-dim">{token}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <p className="font-display text-3xl tracking-[0.2em] text-ink">CHAKRA PETCH · DISPLAY</p>
        <p className="font-sans text-base text-ink">IBM Plex Sans carries body copy and long-form text.</p>
        <p className="font-mono text-base text-primary">JETBRAINS MONO · DEL → BOM · INR 4,500 · PNR X7Q2LM</p>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap gap-3">
          <Button>Engage</Button>
          <Button variant="ghost">Standby</Button>
          <Button variant="danger">Abort</Button>
          <Button loading>Scanning</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <TextField label="Email" placeholder="you@agency.com" />
          <TextField label="Password" type="password" hint="At least 10 characters" />
          <TextField label="Agency name" defaultValue="!" error="Agency name is too short." />
        </div>
      </Section>

      <Section title="Signals">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>neutral</Badge>
          <Badge tone="primary">live</Badge>
          <Badge tone="ok">verified</Badge>
          <Badge tone="warn">policy</Badge>
          <Badge tone="danger">blocked</Badge>
          <Badge tone="ai">ai</Badge>
          <StatusDot status="ok" label="API online" />
          <StatusDot status="degraded" label="API degraded" />
          <StatusDot status="down" label="API offline" />
        </div>
      </Section>

      <Section title="Readouts">
        <dl className="grid max-w-xl grid-cols-2 gap-4">
          <Readout label="Great-circle distance" value="1,138" unit="km" hint="615 nmi" />
          <Readout label="Est. flight time" value="1h 58m" hint="Estimate" />
        </dl>
      </Section>

      <Section title="Panels">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel eyebrow="Instrument" title="Default panel">
            <p className="text-sm text-dim">Bracketed corners in the primary accent.</p>
          </Panel>
          <Panel eyebrow="Copilot" title="AI panel" tone="ai">
            <p className="text-sm text-dim">AI activity uses the magenta accent.</p>
          </Panel>
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all tests pass; no type or lint errors.

- [ ] **Step 5: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): Mission Control UI kit, theme switching and design gallery

"
```

---

### Task 4: Typed API client and server-state layer

**Files:**
- Create: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/api/auth.ts`, `frontend/src/api/team.ts`, `frontend/src/api/reference.ts`, `frontend/src/api/health.ts`, `frontend/src/api/queries.ts`, `frontend/src/api/queryClient.ts`, `frontend/src/test/mockApi.ts`, `frontend/src/test/fixtures.ts`
- Test: `frontend/src/api/client.test.ts`, `frontend/src/api/queryClient.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - Types: `Role = "owner" | "admin" | "agent"`, `User {id, email, full_name, role}`, `Agency {id, name}`, `Me {user, agency}`, `TeamMember {id, email, full_name, role}`, `Invitation {id, email, role, created_at, expires_at}`, `InvitationCreated = Invitation & {token}`, `Airport {iata_code, name, city: string | null, country_code, country_name, latitude, longitude}`
  - `class ApiError extends Error { status: number; fieldErrors: Record<string, string>; traceId?: string }`, `NETWORK_ERROR_MESSAGE`, `apiFetch<T>(path, { method?, body?, signal? }?): Promise<T>`, `asApiError(error: unknown): ApiError`
  - `authApi.me(): Promise<Me | null>` (401 → `null`), `authApi.login({email, password})`, `authApi.signup({agency_name, full_name, email, password})`, `authApi.logout()`, `authApi.acceptInvitation({token, full_name, password})` → `Promise<Me>` (logout → `void`)
  - `teamApi.listTeam()`, `teamApi.listInvitations()`, `teamApi.createInvitation({email, role: "admin" | "agent"})`
  - `referenceApi.searchAirports(q, limit = 8, signal?)`
  - `type ApiHealth = "ok" | "degraded" | "down"`, `checkHealth(signal?)`
  - `qk` query keys: `qk.me`, `qk.team`, `qk.invitations`, `qk.health`, `qk.airports(term)`; `meQueryOptions`, `teamQueryOptions`, `invitationsQueryOptions`, `healthQueryOptions`, `airportSearchQueryOptions(term)`
  - `createQueryClient({ retry?: boolean }?): QueryClient`, `setUnauthorizedHandler(fn: (() => void) | null)`. Any **query** that fails with 401 (and any mutation without `meta: { skipAuthRedirect: true }`) sets `qk.me` to `null` and calls the handler.
  - Test helpers: `mockApi(routes)` → `{ calls, fetchMock }`, where `routes` maps `"METHOD /path"` to `{ status, body?, headers? }` or a function `(call) => result`; fixtures `ME_OWNER`, `ME_AGENT`, `AIRPORTS` (`DEL`, `BOM`, `GOI`, `GOX`, `LHR`, `JFK` with real coordinates).

- [ ] **Step 1: Create the test helpers**

Create `frontend/src/test/mockApi.ts`:

```ts
import { vi } from "vitest";

export type MockResult = { status: number; body?: unknown; headers?: Record<string, string> };
export type MockCall = { method: string; path: string; search: URLSearchParams; body: unknown };
export type MockHandler = MockResult | ((call: MockCall) => MockResult);

/** Stub global fetch with a route table keyed by "METHOD /path" (query string ignored). */
export function mockApi(routes: Record<string, MockHandler>) {
  const calls: MockCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const call: MockCall = {
      method,
      path: url.pathname,
      search: url.searchParams,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    const result: MockResult = !handler
      ? { status: 404, body: { detail: `No mock for ${method} ${url.pathname}` } }
      : typeof handler === "function"
        ? handler(call)
        : handler;
    const body = result.body === undefined ? null : JSON.stringify(result.body);
    return new Response(body, {
      status: result.status,
      headers: { "Content-Type": "application/json", ...result.headers },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
```

Create `frontend/src/test/fixtures.ts`:

```ts
import type { Airport, Me } from "../api/types";

export const ME_OWNER: Me = {
  user: { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  agency: { id: "a-alpha", name: "Alpha Travels" },
};

export const ME_AGENT: Me = {
  user: { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
  agency: { id: "a-alpha", name: "Alpha Travels" },
};

function airport(
  iata_code: string,
  name: string,
  city: string,
  country_code: string,
  country_name: string,
  latitude: number,
  longitude: number,
): Airport {
  return { iata_code, name, city, country_code, country_name, latitude, longitude };
}

export const AIRPORTS = {
  DEL: airport("DEL", "Indira Gandhi International Airport", "New Delhi", "IN", "India", 28.5665, 77.103104),
  BOM: airport("BOM", "Chhatrapati Shivaji Maharaj International Airport", "Mumbai", "IN", "India", 19.0887, 72.8679),
  GOI: airport("GOI", "Goa Dabolim International Airport", "Vasco da Gama", "IN", "India", 15.3808, 73.8314),
  GOX: airport("GOX", "Manohar International Airport", "Mopa", "IN", "India", 15.7442, 73.8606),
  LHR: airport("LHR", "London Heathrow Airport", "London", "GB", "United Kingdom", 51.4706, -0.461941),
  JFK: airport("JFK", "John F Kennedy International Airport", "New York", "US", "United States", 40.639801, -73.7789),
} satisfies Record<string, Airport>;
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/api/client.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import { ME_OWNER } from "../test/fixtures";
import { authApi } from "./auth";
import { ApiError, NETWORK_ERROR_MESSAGE, apiFetch, asApiError } from "./client";
import { checkHealth } from "./health";
import { referenceApi } from "./reference";

test("sends JSON with credentials and returns the parsed body", async () => {
  const { fetchMock, calls } = mockApi({ "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } });
  await expect(authApi.login({ email: "asha@alphatravels.in", password: "x".repeat(12) })).resolves.toEqual(ME_OWNER);
  const init = fetchMock.mock.calls[0]?.[1];
  expect(init?.credentials).toBe("include");
  expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  expect(calls[0]?.body).toEqual({ email: "asha@alphatravels.in", password: "x".repeat(12) });
});

test("204 responses resolve to undefined", async () => {
  mockApi({ "POST /api/v1/auth/logout": { status: 204 } });
  await expect(authApi.logout()).resolves.toBeUndefined();
});

test("validation errors become field errors", async () => {
  mockApi({
    "POST /api/v1/auth/signup": {
      status: 422,
      body: {
        detail: "Some of the information you entered isn't valid.",
        errors: [{ field: "password", message: "String should have at least 10 characters" }],
      },
    },
  });
  const error = await authApi
    .signup({ agency_name: "Alpha", full_name: "Asha", email: "a@b.in", password: "short" })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(422);
  expect((error as ApiError).message).toBe("Some of the information you entered isn't valid.");
  expect((error as ApiError).fieldErrors).toEqual({ password: "String should have at least 10 characters" });
});

test("server errors carry the trace ID", async () => {
  mockApi({
    "GET /api/v1/team": {
      status: 500,
      body: { detail: "Something went wrong on our side. Please try again.", trace_id: "abc123" },
    },
  });
  const error = (await apiFetch("/api/v1/team").catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(500);
  expect(error.traceId).toBe("abc123");
});

test("a non-JSON gateway error still gives a plain message and the request ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "X-Request-ID": "req-9" } })),
  );
  const error = (await apiFetch("/api/v1/team").catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(502);
  expect(error.message).toBe("Something went wrong on our side. Please try again.");
  expect(error.traceId).toBe("req-9");
});

test("network failures become a friendly ApiError with status 0", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  const error = (await apiFetch("/api/v1/team").catch((e: unknown) => e)) as ApiError;
  expect(error.status).toBe(0);
  expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
});

test("aborted requests are rethrown untouched", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("aborted", "AbortError"))));
  await expect(apiFetch("/api/v1/team")).rejects.toMatchObject({ name: "AbortError" });
});

test("me() returns null when signed out", async () => {
  mockApi({ "GET /api/v1/auth/me": { status: 401, body: { detail: "Please sign in." } } });
  await expect(authApi.me()).resolves.toBeNull();
});

test("airport search encodes the query", async () => {
  const { calls } = mockApi({ "GET /api/v1/reference/airports": { status: 200, body: [] } });
  await referenceApi.searchAirports("são paulo", 5);
  expect(calls[0]?.search.get("q")).toBe("são paulo");
  expect(calls[0]?.search.get("limit")).toBe("5");
});

test("health maps 200 / 503 / network failure", async () => {
  mockApi({ "GET /health": { status: 200, body: { status: "ok", database: "ok" } } });
  await expect(checkHealth()).resolves.toBe("ok");
  mockApi({ "GET /health": { status: 503, body: { status: "degraded", database: "unavailable" } } });
  await expect(checkHealth()).resolves.toBe("degraded");
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  await expect(checkHealth()).resolves.toBe("down");
});

test("asApiError wraps unknown errors", () => {
  const wrapped = asApiError(new Error("boom"));
  expect(wrapped).toBeInstanceOf(ApiError);
  expect(wrapped.message).toBe("Something went wrong. Please try again.");
  const original = new ApiError(409, "Taken");
  expect(asApiError(original)).toBe(original);
});
```

Create `frontend/src/api/queryClient.test.ts`:

```ts
import { MutationObserver } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { ME_OWNER } from "../test/fixtures";
import { ApiError } from "./client";
import { qk } from "./queries";
import { createQueryClient, setUnauthorizedHandler } from "./queryClient";

afterEach(() => setUnauthorizedHandler(null));

test("a 401 from any data query signs the user out and calls the handler", async () => {
  const client = createQueryClient({ retry: false });
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  client.setQueryData(qk.me, ME_OWNER);

  await expect(
    client.fetchQuery({
      queryKey: ["team"],
      queryFn: () => Promise.reject(new ApiError(401, "Your session has expired. Please sign in again.")),
    }),
  ).rejects.toBeInstanceOf(ApiError);

  expect(handler).toHaveBeenCalledOnce();
  expect(client.getQueryData(qk.me)).toBeNull();
});

test("sign-in style mutations can opt out of the redirect", async () => {
  const client = createQueryClient({ retry: false });
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  const observer = new MutationObserver(client, {
    mutationFn: () => Promise.reject(new ApiError(401, "Invalid email or password.")),
    meta: { skipAuthRedirect: true },
  });
  await expect(observer.mutate()).rejects.toBeInstanceOf(ApiError);
  expect(handler).not.toHaveBeenCalled();
});

test("other errors do not sign the user out", async () => {
  const client = createQueryClient({ retry: false });
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  client.setQueryData(qk.me, ME_OWNER);
  await expect(
    client.fetchQuery({ queryKey: ["team"], queryFn: () => Promise.reject(new ApiError(500, "Boom")) }),
  ).rejects.toBeInstanceOf(ApiError);
  expect(handler).not.toHaveBeenCalled();
  expect(client.getQueryData(qk.me)).toEqual(ME_OWNER);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/api`
Expected: FAIL — unresolved imports `./auth`, `./client`, `./queryClient`.

- [ ] **Step 4: Implement the API layer**

Create `frontend/src/api/types.ts`:

```ts
export type Role = "owner" | "admin" | "agent";

export type User = { id: string; email: string; full_name: string; role: Role };
export type Agency = { id: string; name: string };
export type Me = { user: User; agency: Agency };

export type TeamMember = { id: string; email: string; full_name: string; role: Role };

export type Invitation = {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  created_at: string;
  expires_at: string;
};
export type InvitationCreated = Invitation & { token: string };

export type Airport = {
  iata_code: string;
  name: string;
  city: string | null;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
};
```

Create `frontend/src/api/client.ts`:

```ts
export const NETWORK_ERROR_MESSAGE = "Can't reach TravelMind right now. Check your connection and try again.";
const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";
const REQUEST_ERROR_MESSAGE = "That request didn't work. Please try again.";

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly traceId?: string;

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}, traceId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.traceId = traceId;
  }
}

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toApiError(status: number, payload: unknown, requestId: string | null): ApiError {
  const body = isRecord(payload) ? payload : {};
  const detail =
    typeof body.detail === "string" ? body.detail : status >= 500 ? SERVER_ERROR_MESSAGE : REQUEST_ERROR_MESSAGE;
  const fieldErrors: Record<string, string> = {};
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (isRecord(item) && typeof item.field === "string" && typeof item.message === "string") {
        fieldErrors[item.field] = item.message;
      }
    }
  }
  const traceId =
    typeof body.trace_id === "string" ? body.trace_id : status >= 500 ? (requestId ?? undefined) : undefined;
  return new ApiError(status, detail, fieldErrors, traceId);
}

/** Same-origin JSON request. The session travels as the httpOnly cookie; we never touch tokens. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, payload, response.headers.get("X-Request-ID"));
  return payload as T;
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, "Something went wrong. Please try again.");
}
```

Create `frontend/src/api/auth.ts`:

```ts
import { ApiError, apiFetch } from "./client";
import type { Me } from "./types";

export type LoginInput = { email: string; password: string };
export type SignupInput = { agency_name: string; full_name: string; email: string; password: string };
export type AcceptInvitationInput = { token: string; full_name: string; password: string };

export const authApi = {
  async me(): Promise<Me | null> {
    try {
      return await apiFetch<Me>("/api/v1/auth/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  login: (body: LoginInput) => apiFetch<Me>("/api/v1/auth/login", { method: "POST", body }),
  signup: (body: SignupInput) => apiFetch<Me>("/api/v1/auth/signup", { method: "POST", body }),
  logout: () => apiFetch<void>("/api/v1/auth/logout", { method: "POST" }),
  acceptInvitation: (body: AcceptInvitationInput) =>
    apiFetch<Me>("/api/v1/invitations/accept", { method: "POST", body }),
};
```

Create `frontend/src/api/team.ts`:

```ts
import { apiFetch } from "./client";
import type { Invitation, InvitationCreated, TeamMember } from "./types";

export const teamApi = {
  listTeam: () => apiFetch<TeamMember[]>("/api/v1/team"),
  listInvitations: () => apiFetch<Invitation[]>("/api/v1/invitations"),
  createInvitation: (body: { email: string; role: "admin" | "agent" }) =>
    apiFetch<InvitationCreated>("/api/v1/invitations", { method: "POST", body }),
};
```

Create `frontend/src/api/reference.ts`:

```ts
import { apiFetch } from "./client";
import type { Airport } from "./types";

export const referenceApi = {
  searchAirports(q: string, limit = 8, signal?: AbortSignal): Promise<Airport[]> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return apiFetch<Airport[]>(`/api/v1/reference/airports?${params}`, { signal });
  },
};
```

Create `frontend/src/api/health.ts`:

```ts
import { ApiError, apiFetch } from "./client";

export type ApiHealth = "ok" | "degraded" | "down";

export async function checkHealth(signal?: AbortSignal): Promise<ApiHealth> {
  try {
    await apiFetch<unknown>("/health", { signal });
    return "ok";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof ApiError && error.status === 503) return "degraded";
    return "down";
  }
}
```

Create `frontend/src/api/queries.ts`:

```ts
import { queryOptions } from "@tanstack/react-query";
import { authApi } from "./auth";
import { checkHealth } from "./health";
import { referenceApi } from "./reference";
import { teamApi } from "./team";

export const qk = {
  me: ["me"] as const,
  team: ["team"] as const,
  invitations: ["invitations"] as const,
  health: ["health"] as const,
  airports: (term: string) => ["airports", term.toLowerCase()] as const,
};

export const meQueryOptions = queryOptions({
  queryKey: qk.me,
  queryFn: () => authApi.me(),
  staleTime: 5 * 60_000,
});

export const teamQueryOptions = queryOptions({
  queryKey: qk.team,
  queryFn: () => teamApi.listTeam(),
});

export const invitationsQueryOptions = queryOptions({
  queryKey: qk.invitations,
  queryFn: () => teamApi.listInvitations(),
});

export const healthQueryOptions = queryOptions({
  queryKey: qk.health,
  queryFn: ({ signal }) => checkHealth(signal),
  refetchInterval: 30_000,
  retry: false,
});

export function airportSearchQueryOptions(term: string) {
  return queryOptions({
    queryKey: qk.airports(term),
    queryFn: ({ signal }) => referenceApi.searchAirports(term, 8, signal),
    staleTime: 10 * 60_000,
  });
}
```

Create `frontend/src/api/queryClient.ts`:

```ts
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";
import { qk } from "./queries";

let unauthorizedHandler: (() => void) | null = null;

/** The router registers how to leave the app when the session is gone. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status > 0 && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient({ retry = true }: { retry?: boolean } = {}): QueryClient {
  const handleAuthError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      client.setQueryData(qk.me, null);
      unauthorizedHandler?.();
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleAuthError }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!mutation.meta?.skipAuthRedirect) handleAuthError(error);
      },
    }),
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: retry ? shouldRetry : false },
      mutations: { retry: false },
    },
  });
  return client;
}
```

- [ ] **Step 5: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. (If the installed TanStack Query's `MutationCache` `onError` signature differs, keep `mutation` as the argument that carries `.meta` and note it in the report.)

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): typed API client, error normalisation and query layer with global 401 handling

"
```

---

### Task 5: Router, auth screens, app shell and live status bar

**Files:**
- Delete: `frontend/src/App.tsx`, `frontend/src/App.test.tsx`
- Create: `frontend/src/router.tsx`, `frontend/src/app/AppProviders.tsx`, `frontend/src/app/RouteError.tsx`, `frontend/src/app/NotFound.tsx`, `frontend/src/auth/AuthFrame.tsx`, `frontend/src/auth/LoginPage.tsx`, `frontend/src/auth/SignupPage.tsx`, `frontend/src/auth/AcceptInvitePage.tsx`, `frontend/src/auth/useCurrentUser.ts`, `frontend/src/auth/useLogout.ts`, `frontend/src/shell/AppShell.tsx`, `frontend/src/shell/NavRail.tsx`, `frontend/src/shell/StatusBar.tsx`, `frontend/src/shell/useClock.ts`, `frontend/src/ui/FormError.tsx`, `frontend/src/features/dashboard/MissionControlPage.tsx` (placeholder, replaced in Task 7), `frontend/src/features/team/TeamPage.tsx` (placeholder, replaced in Task 9), `frontend/src/test/renderApp.tsx`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/src/auth/auth.test.tsx`, `frontend/src/shell/shell.test.tsx`

**Interfaces:**
- Consumes: UI kit (Task 3), API layer (Task 4).
- Produces:
  - Routes: `/login` (search `{ redirect?: string }`, only same-site paths), `/signup`, `/invite/$token`, and the authenticated layout (id `app`) with `/`, `/team`, `/design`.
  - `createAppRouter(queryClient, history?)` (registers the 401 handler); `routeTree`; `<AppProviders queryClient router />`
  - `useCurrentUser(): Me | null`, `useLogout()` (mutation; clears cached data, goes to `/login`)
  - `<FormError error: ApiError />` (role `alert`, shows trace ID when present)
  - `<AppShell />` (nav rail, top bar with agency name, user, role badge, theme toggle, Sign out; `<main id="main">`; status bar), `<StatusBar />` (API status + UTC and IST clocks)
  - Test helper `renderApp(path)` → `{ router, queryClient, user, ...renderResult }`; `withSession(me, extraRoutes?)` returns a mock route table containing `GET /api/v1/auth/me` and `GET /health`.

- [ ] **Step 1: Create the test helper**

Create `frontend/src/test/renderApp.tsx`:

```tsx
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryClient } from "../api/queryClient";
import type { Me } from "../api/types";
import { AppProviders } from "../app/AppProviders";
import { createAppRouter } from "../router";
import type { MockHandler } from "./mockApi";

export function renderApp(path: string) {
  const queryClient = createQueryClient({ retry: false });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  const user = userEvent.setup();
  const result = render(<AppProviders queryClient={queryClient} router={router} />);
  return { ...result, router, queryClient, user };
}

/** Mock routes for a signed-in (or signed-out, with null) user plus a healthy API. */
export function withSession(me: Me | null, extra: Record<string, MockHandler> = {}): Record<string, MockHandler> {
  return {
    "GET /api/v1/auth/me": me ? { status: 200, body: me } : { status: 401, body: { detail: "Please sign in." } },
    "GET /health": { status: 200, body: { status: "ok", database: "ok" } },
    ...extra,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/auth/auth.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { ME_OWNER } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp, withSession } from "../test/renderApp";

test("signed-out visitors are sent to login with a return path", async () => {
  mockApi(withSession(null));
  const { router } = renderApp("/team");
  expect(await screen.findByRole("heading", { name: "Mission access" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/login");
  expect(router.state.location.search).toEqual({ redirect: "/team" });
});

test("returns to the page the user asked for after signing in", async () => {
  mockApi(withSession(null, { "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } }));
  const { router, user } = renderApp("/login?redirect=%2Fteam");
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/team"));
  expect(await screen.findByRole("banner")).toHaveTextContent("Alpha Travels");
});

test("ignores redirects to other sites", async () => {
  mockApi(withSession(null, { "POST /api/v1/auth/login": { status: 200, body: ME_OWNER } }));
  const { router, user } = renderApp("/login?redirect=%2F%2Fevil.example");
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test("wrong credentials show the server's message and stay on login", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/auth/login": { status: 401, body: { detail: "Invalid email or password." } },
    }),
  );
  const { router, user } = renderApp("/login");
  await user.type(await screen.findByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "wrong-password-1");
  await user.click(screen.getByRole("button", { name: "Engage" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  expect(router.state.location.pathname).toBe("/login");
});

test("signup shows field errors from the server", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/auth/signup": {
        status: 422,
        body: {
          detail: "Some of the information you entered isn't valid.",
          errors: [{ field: "password", message: "String should have at least 10 characters" }],
        },
      },
    }),
  );
  const { user } = renderApp("/signup");
  await user.type(await screen.findByLabelText("Agency name"), "Alpha Travels");
  await user.type(screen.getByLabelText("Your name"), "Asha Rao");
  await user.type(screen.getByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "short");
  await user.click(screen.getByRole("button", { name: "Create command deck" }));
  expect(await screen.findByLabelText("Password")).toHaveAccessibleDescription(
    "String should have at least 10 characters",
  );
});

test("signup conflicts show a plain message", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/auth/signup": { status: 409, body: { detail: "An account with this email already exists." } },
    }),
  );
  const { user } = renderApp("/signup");
  await user.type(await screen.findByLabelText("Agency name"), "Alpha Travels");
  await user.type(screen.getByLabelText("Your name"), "Asha Rao");
  await user.type(screen.getByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Create command deck" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists.");
});

test("a successful signup lands on Mission Control", async () => {
  const { calls } = mockApi(withSession(null, { "POST /api/v1/auth/signup": { status: 201, body: ME_OWNER } }));
  const { router, user } = renderApp("/signup");
  await user.type(await screen.findByLabelText("Agency name"), "Alpha Travels");
  await user.type(screen.getByLabelText("Your name"), "Asha Rao");
  await user.type(screen.getByLabelText("Email"), "asha@alphatravels.in");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Create command deck" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(calls.find((c) => c.path === "/api/v1/auth/signup")?.body).toEqual({
    agency_name: "Alpha Travels",
    full_name: "Asha Rao",
    email: "asha@alphatravels.in",
    password: "correct-horse-battery",
  });
});

test("signed-in users skip the login page", async () => {
  mockApi(withSession(ME_OWNER));
  const { router } = renderApp("/login");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test("accepting an invitation signs the new crew member in", async () => {
  const { calls } = mockApi(
    withSession(null, { "POST /api/v1/invitations/accept": { status: 201, body: ME_OWNER } }),
  );
  const { router, user } = renderApp("/invite/a-alpha.secret-token");
  await user.type(await screen.findByLabelText("Your name"), "Ravi Kumar");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Join the crew" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(calls.find((c) => c.path === "/api/v1/invitations/accept")?.body).toEqual({
    token: "a-alpha.secret-token",
    full_name: "Ravi Kumar",
    password: "correct-horse-battery",
  });
});

test("a dead invitation link explains itself", async () => {
  mockApi(
    withSession(null, {
      "POST /api/v1/invitations/accept": {
        status: 400,
        body: { detail: "This invitation link is invalid or has expired." },
      },
    }),
  );
  const { user } = renderApp("/invite/bad-token-value");
  await user.type(await screen.findByLabelText("Your name"), "Ravi Kumar");
  await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Join the crew" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This invitation link is invalid or has expired.");
});
```

Create `frontend/src/shell/shell.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../api/client";
import { RouteError } from "../app/RouteError";
import { ME_OWNER } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp, withSession } from "../test/renderApp";

test("the shell shows the agency, the user and navigation", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/");
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByText("Alpha Travels")).toBeInTheDocument();
  expect(within(banner).getByText("Asha Rao")).toBeInTheDocument();
  expect(within(banner).getByText("owner")).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Primary" });
  for (const name of ["Mission Control", "Crew roster", "Design system"]) {
    expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
  }
});

test("status bar reports a healthy API and both clocks", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/");
  expect(await screen.findByText("API online")).toBeInTheDocument();
  expect(screen.getByText(/^UTC \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  expect(screen.getByText(/^IST \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
});

test("status bar reports a degraded API", async () => {
  mockApi({
    ...withSession(ME_OWNER),
    "GET /health": { status: 503, body: { status: "degraded", database: "unavailable" } },
  });
  renderApp("/");
  expect(await screen.findByText("API degraded")).toBeInTheDocument();
});

test("signing out clears the session and returns to login", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { "POST /api/v1/auth/logout": { status: 204 } }));
  const { router, user } = renderApp("/");
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/auth/logout")).toBe(true);
  expect(await screen.findByRole("heading", { name: "Mission access" })).toBeInTheDocument();
});

test("the design gallery is reachable inside the shell", async () => {
  mockApi(withSession(ME_OWNER));
  const { user, router } = renderApp("/");
  await user.click(await screen.findByRole("link", { name: "Design system" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/design"));
  expect(screen.getByRole("heading", { name: "Colour tokens" })).toBeInTheDocument();
});

test("unknown pages show a way home", async () => {
  mockApi(withSession(ME_OWNER));
  renderApp("/nowhere");
  expect(await screen.findByRole("heading", { name: "Signal lost" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Return to Mission Control" })).toBeInTheDocument();
});

test("a failing route shows the error with its trace ID instead of a blank screen", () => {
  const reset = vi.fn();
  render(
    <RouteError
      error={new ApiError(500, "Something went wrong on our side. Please try again.", {}, "trace-42")}
      reset={reset}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on our side. Please try again.");
  expect(screen.getByText("Trace ID: trace-42")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/auth src/shell`
Expected: FAIL — unresolved imports `../router`, `../app/AppProviders`.

- [ ] **Step 4: Implement shared pieces**

Delete `frontend/src/App.tsx` and `frontend/src/App.test.tsx`.

Create `frontend/src/ui/FormError.tsx`:

```tsx
import type { ApiError } from "../api/client";

export function FormError({ error }: { error: ApiError }) {
  return (
    <div role="alert" className="rounded-sm border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
      <p>{error.message}</p>
      {error.traceId && <p className="mt-1 font-mono text-xs text-dim">Trace ID: {error.traceId}</p>}
    </div>
  );
}
```

Create `frontend/src/auth/useCurrentUser.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { meQueryOptions } from "../api/queries";
import type { Me } from "../api/types";

/** The signed-in user, or null (briefly, while signing out). The router guard ensures it's loaded. */
export function useCurrentUser(): Me | null {
  return useQuery(meQueryOptions).data ?? null;
}
```

Create `frontend/src/auth/useLogout.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authApi } from "../api/auth";
import { qk } from "../api/queries";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSettled: async () => {
      queryClient.setQueryData(qk.me, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.me[0] });
      await navigate({ to: "/login" });
    },
  });
}
```

Create `frontend/src/shell/useClock.ts`:

```ts
import { useEffect, useState } from "react";

export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatClock(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
```

- [ ] **Step 5: Implement the auth screens**

Create `frontend/src/auth/AuthFrame.tsx`:

```tsx
import type { ReactNode } from "react";
import { Panel } from "../ui/Panel";

/** The "airlock": brand column plus a single form panel. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="tm-grid tm-scanlines grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <p className="font-display text-xl tracking-[0.4em] text-primary">TRAVELMIND</p>
        <svg viewBox="0 0 200 200" aria-hidden="true" className="tm-spin-slow mx-auto w-3/4 max-w-md opacity-80">
          <circle cx="100" cy="100" r="58" fill="none" stroke="var(--tm-primary)" strokeWidth="1.2" />
          <circle cx="100" cy="100" r="80" fill="none" stroke="var(--tm-line)" strokeDasharray="2 6" />
          <ellipse
            cx="100"
            cy="100"
            rx="92"
            ry="30"
            fill="none"
            stroke="var(--tm-ai)"
            strokeWidth="1"
            transform="rotate(-24 100 100)"
          />
          <circle cx="178" cy="68" r="4" fill="var(--tm-primary)" />
        </svg>
        <p className="max-w-sm font-display text-2xl leading-snug text-ink">
          Quote faster. Verify every fare. Keep your agency in orbit.
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <Panel className="w-full max-w-md" eyebrow="Secure channel">
          <h1 className="font-display text-2xl tracking-wide text-ink">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-dim">{subtitle}</p>
          {children}
        </Panel>
      </div>
    </main>
  );
}
```

Create `frontend/src/auth/LoginPage.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { authApi } from "../api/auth";
import { ApiError } from "../api/client";
import { qk } from "../api/queries";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { TextField } from "../ui/TextField";
import { AuthFrame } from "./AuthFrame";

export function LoginPage() {
  const search = useSearch({ from: "/login" });
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: authApi.login,
    meta: { skipAuthRedirect: true },
    onSuccess: (me) => {
      queryClient.setQueryData(qk.me, me);
      router.history.push(search.redirect ?? "/");
    },
  });
  const error = login.error instanceof ApiError ? login.error : null;
  const hasFieldErrors = error ? Object.keys(error.fieldErrors).length > 0 : false;

  return (
    <AuthFrame title="Mission access" subtitle="Sign in to your agency's command deck.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate({ email, password });
        }}
      >
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error?.fieldErrors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error?.fieldErrors.password}
        />
        {error && !hasFieldErrors && <FormError error={error} />}
        <Button type="submit" loading={login.isPending}>
          Engage
        </Button>
      </form>
      <p className="mt-6 text-sm text-dim">
        New agency?{" "}
        <Link to="/signup" className="text-primary hover:underline">
          Create your command deck
        </Link>
      </p>
    </AuthFrame>
  );
}
```

Create `frontend/src/auth/SignupPage.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authApi, type SignupInput } from "../api/auth";
import { ApiError } from "../api/client";
import { qk } from "../api/queries";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { TextField } from "../ui/TextField";
import { AuthFrame } from "./AuthFrame";

const EMPTY: SignupInput = { agency_name: "", full_name: "", email: "", password: "" };

export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SignupInput>(EMPTY);
  const signup = useMutation({
    mutationFn: authApi.signup,
    meta: { skipAuthRedirect: true },
    onSuccess: async (me) => {
      queryClient.setQueryData(qk.me, me);
      await navigate({ to: "/" });
    },
  });
  const error = signup.error instanceof ApiError ? signup.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const update = (field: keyof SignupInput) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <AuthFrame title="Launch your agency" subtitle="Create a command deck for your team. Takes a minute.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          signup.mutate(form);
        }}
      >
        <TextField label="Agency name" required value={form.agency_name} onChange={update("agency_name")} error={fieldErrors.agency_name} />
        <TextField label="Your name" autoComplete="name" required value={form.full_name} onChange={update("full_name")} error={fieldErrors.full_name} />
        <TextField label="Email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} error={fieldErrors.email} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters"
          value={form.password}
          onChange={update("password")}
          error={fieldErrors.password}
        />
        {error && !hasFieldErrors && <FormError error={error} />}
        <Button type="submit" loading={signup.isPending}>
          Create command deck
        </Button>
      </form>
      <p className="mt-6 text-sm text-dim">
        Already aboard?{" "}
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
```

Create `frontend/src/auth/AcceptInvitePage.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { authApi } from "../api/auth";
import { ApiError } from "../api/client";
import { qk } from "../api/queries";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { TextField } from "../ui/TextField";
import { AuthFrame } from "./AuthFrame";

export function AcceptInvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const accept = useMutation({
    mutationFn: authApi.acceptInvitation,
    meta: { skipAuthRedirect: true },
    onSuccess: async (me) => {
      queryClient.setQueryData(qk.me, me);
      await navigate({ to: "/" });
    },
  });
  const error = accept.error instanceof ApiError ? accept.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  return (
    <AuthFrame title="Join your crew" subtitle="Set your name and password to board your agency's deck.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          accept.mutate({ token, full_name: fullName, password });
        }}
      >
        <TextField label="Your name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} error={fieldErrors.full_name} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 10 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />
        {error && !hasFieldErrors && <FormError error={error} />}
        <Button type="submit" loading={accept.isPending}>
          Join the crew
        </Button>
      </form>
      <p className="mt-6 text-sm text-dim">
        Already have an account?{" "}
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
```

- [ ] **Step 6: Implement the shell**

Create `frontend/src/shell/NavRail.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { Palette, Radar, Users } from "lucide-react";

const ITEMS = [
  { to: "/", label: "Mission Control", icon: Radar },
  { to: "/team", label: "Crew roster", icon: Users },
  { to: "/design", label: "Design system", icon: Palette },
] as const;

export function NavRail() {
  return (
    <aside className="row-span-3 flex flex-col border-r border-line bg-deck/80 backdrop-blur">
      <div className="flex h-14 items-center justify-center border-b border-line lg:justify-start lg:px-5">
        <span className="font-display text-sm tracking-[0.35em] text-primary">
          <span aria-hidden="true" className="lg:hidden">
            TM
          </span>
          <span className="sr-only lg:not-sr-only">TRAVELMIND</span>
        </span>
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            aria-label={label}
            activeOptions={{ exact: to === "/" }}
            className="flex h-10 items-center justify-center gap-3 rounded-sm px-3 text-dim transition hover:bg-raised hover:text-ink lg:justify-start"
            activeProps={{ className: "bg-raised text-primary" }}
          >
            <Icon size={18} aria-hidden="true" />
            <span className="sr-only font-display text-xs uppercase tracking-[0.18em] lg:not-sr-only">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

Create `frontend/src/shell/StatusBar.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { healthQueryOptions } from "../api/queries";
import { StatusDot, type Status } from "../ui/StatusDot";
import { formatClock, useClock } from "./useClock";

const LABELS: Record<Status, string> = {
  ok: "API online",
  degraded: "API degraded",
  down: "API offline",
  unknown: "API checking…",
};

export function StatusBar() {
  const { data } = useQuery(healthQueryOptions);
  const status: Status = data ?? "unknown";
  const now = useClock();
  return (
    <footer className="col-start-2 flex items-center justify-between border-t border-line bg-deck/80 px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-dim">
      <StatusDot status={status} label={LABELS[status]} />
      <div className="flex gap-4">
        <span>UTC {formatClock(now, "UTC")}</span>
        <span>IST {formatClock(now, "Asia/Kolkata")}</span>
      </div>
    </footer>
  );
}
```

Create `frontend/src/shell/AppShell.tsx`:

```tsx
import { Outlet } from "@tanstack/react-router";
import { useCurrentUser } from "../auth/useCurrentUser";
import { useLogout } from "../auth/useLogout";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NavRail } from "./NavRail";
import { StatusBar } from "./StatusBar";

export function AppShell() {
  const me = useCurrentUser();
  const logout = useLogout();
  if (!me) return null;
  return (
    <div className="tm-grid tm-scanlines grid h-dvh grid-cols-[4.5rem_1fr] grid-rows-[3.5rem_1fr_2rem] lg:grid-cols-[14rem_1fr]">
      <NavRail />
      <header className="col-start-2 flex items-center justify-between gap-4 border-b border-line bg-deck/80 px-4 backdrop-blur">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-dim">Agency</p>
          <p className="truncate font-display text-sm tracking-wide text-ink">{me.agency.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden items-center gap-2 sm:flex">
            <span className="text-sm text-ink">{me.user.full_name}</span>
            <Badge tone={me.user.role === "agent" ? "neutral" : "primary"}>{me.user.role}</Badge>
          </div>
          <Button variant="ghost" size="sm" loading={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </header>
      <main id="main" className="col-start-2 overflow-auto p-4 lg:p-6">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}
```

Create placeholder `frontend/src/features/dashboard/MissionControlPage.tsx`:

```tsx
export function MissionControlPage() {
  return <h1 className="font-display text-2xl text-ink">Mission Control</h1>;
}
```

Create placeholder `frontend/src/features/team/TeamPage.tsx`:

```tsx
export function TeamPage() {
  return <h1 className="font-display text-2xl text-ink">Crew roster</h1>;
}
```

- [ ] **Step 7: Implement the error pages, router and providers**

Create `frontend/src/app/RouteError.tsx`:

```tsx
import { asApiError } from "../api/client";
import { Button } from "../ui/Button";
import { FormError } from "../ui/FormError";
import { Panel } from "../ui/Panel";

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div className="tm-grid flex min-h-dvh items-center justify-center p-6">
      <Panel className="w-full max-w-lg" eyebrow="Fault" title="This view hit a problem">
        <div className="flex flex-col gap-4">
          <FormError error={asApiError(error)} />
          <Button variant="ghost" onClick={reset}>
            Try again
          </Button>
        </div>
      </Panel>
    </div>
  );
}
```

Create `frontend/src/app/NotFound.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { Panel } from "../ui/Panel";

export function NotFound() {
  return (
    <div className="tm-grid flex min-h-dvh items-center justify-center p-6">
      <Panel className="w-full max-w-lg" eyebrow="404">
        <h1 className="font-display text-2xl text-ink">Signal lost</h1>
        <p className="mb-4 mt-1 text-sm text-dim">There's nothing at this address.</p>
        <Link to="/" className="text-primary hover:underline">
          Return to Mission Control
        </Link>
      </Panel>
    </div>
  );
}
```

Create `frontend/src/router.tsx`:

```tsx
import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { meQueryOptions } from "./api/queries";
import { setUnauthorizedHandler } from "./api/queryClient";
import { NotFound } from "./app/NotFound";
import { RouteError } from "./app/RouteError";
import { AcceptInvitePage } from "./auth/AcceptInvitePage";
import { LoginPage } from "./auth/LoginPage";
import { SignupPage } from "./auth/SignupPage";
import { MissionControlPage } from "./features/dashboard/MissionControlPage";
import { TeamPage } from "./features/team/TeamPage";
import { AppShell } from "./shell/AppShell";
import { DesignGallery } from "./ui/DesignGallery";

export type RouterContext = { queryClient: QueryClient };

/** Only same-site paths: "/team" is fine, "//evil.example" and "https://…" are not. */
function safeRedirect(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : undefined;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
});

const redirectIfSignedIn = async ({ context }: { context: RouterContext }) => {
  if (await context.queryClient.ensureQueryData(meQueryOptions)) throw redirect({ to: "/" });
};

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirect(search.redirect);
    return target ? { redirect: target } : {};
  },
  beforeLoad: redirectIfSignedIn,
  component: LoginPage,
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  beforeLoad: redirectIfSignedIn,
  component: SignupPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: AcceptInvitePage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!me) throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: AppShell,
});

const missionRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: MissionControlPage });
const teamRoute = createRoute({ getParentRoute: () => appRoute, path: "/team", component: TeamPage });
const designRoute = createRoute({ getParentRoute: () => appRoute, path: "/design", component: DesignGallery });

export const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  inviteRoute,
  appRoute.addChildren([missionRoute, teamRoute, designRoute]),
]);

const PUBLIC_PREFIXES = ["/login", "/signup", "/invite/"];

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history,
    defaultPreload: "intent",
    defaultPendingMinMs: 0,
  });
  setUnauthorizedHandler(() => {
    const { pathname, href } = router.state.location;
    if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return;
    void router.navigate({ to: "/login", search: { redirect: href } });
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
```

Create `frontend/src/app/AppProviders.tsx`:

```tsx
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { createAppRouter } from "../router";

export function AppProviders({
  queryClient,
  router,
}: {
  queryClient: QueryClient;
  router: ReturnType<typeof createAppRouter>;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
```

Replace `frontend/src/main.tsx`:

```tsx
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/queryClient";
import { AppProviders } from "./app/AppProviders";
import { createAppRouter } from "./router";
import { initTheme } from "./ui/theme";

initTheme();
const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <AppProviders queryClient={queryClient} router={router} />
  </StrictMode>,
);
```

- [ ] **Step 8: Run all checks**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. If TanStack Router's installed version names an option differently (e.g., `defaultPendingMinMs`), make the minimal fix and note it.

- [ ] **Step 9: See it running**

Start the backend on 8010 and `npm run dev`; open `http://localhost:5173` — you land on "Mission access"; sign up; you see the shell with your agency, the status bar ("API online", UTC and IST clocks), and the Design system page. Stop the servers.

- [ ] **Step 10: Commit**

```bash
cd /d/travel-rag-agent
git add -A frontend
git commit -m "feat(frontend): router with auth guard, airlock sign-in/sign-up/invite screens, app shell and status bar

"
```

---

### Task 6: Airport picker, route scanner and recent routes

**Files:**
- Create: `frontend/src/lib/format.ts`, `frontend/src/lib/useDebouncedValue.ts`, `frontend/src/features/route/geo.ts`, `frontend/src/features/route/routeStore.ts`, `frontend/src/features/route/recentRoutes.ts`, `frontend/src/features/route/RouteScanner.tsx`, `frontend/src/features/airports/useAirportSearch.ts`, `frontend/src/features/airports/AirportPicker.tsx`, `frontend/src/test/renderWithClient.tsx`
- Modify: `frontend/src/auth/useLogout.ts` (reset the route selection on sign-out)
- Test: `frontend/src/lib/format.test.ts`, `frontend/src/features/route/geo.test.ts`, `frontend/src/features/route/routeStore.test.ts`, `frontend/src/features/route/recentRoutes.test.ts`, `frontend/src/features/airports/AirportPicker.test.tsx`, `frontend/src/features/route/RouteScanner.test.tsx`

**Interfaces:**
- Consumes: `Airport`, `airportSearchQueryOptions`, `ApiError`, UI kit.
- Produces:
  - `formatNumber(n): string` (en-US grouping), `formatDuration(minutes): string` (`"1h 58m"`, `"45m"`), `formatDate(iso): string` (`"6 Oct 2026"`)
  - `useDebouncedValue<T>(value, delayMs): T`
  - `type GeoPoint = { latitude; longitude }`, `greatCircleKm(a, b)`, `KM_PER_NMI = 1.852`, `CRUISE_KMH = 780`, `TAXI_CLIMB_DESCENT_MIN = 30`, `estimateFlightMinutes(km)`, `midpoint(a, b): { lat; lng }`
  - `routeStore` with `get()`, `subscribe(fn)`, `setOrigin(a | null)`, `setDestination(a | null)`, `place(a)` (fill origin, then destination; replaces destination when both set), `swap()`, `set({origin, destination})`, `reset()`; `useRouteSelection(): { origin: Airport | null; destination: Airport | null }`
  - `type RecentRoute = { origin: Airport; destination: Airport; scannedAt: string }`, `loadRecentRoutes(userId)`, `recordRecentRoute(userId, origin, destination, now?)`, `useRecentRoutes(userId): { routes; record(origin, destination) }` (max 8, newest first, de-duplicated, per user)
  - `useAirportSearch(term)` → `{ results: Airport[]; enabled: boolean; isSearching: boolean; error: unknown }`
  - `<AirportPicker label value onChange placeholder? />` (ARIA combobox)
  - `<RouteScanner onRouteReady?: (origin, destination) => void />`
  - Test helper `renderWithClient(ui)` → `{ user, queryClient, ...renderResult }`

- [ ] **Step 1: Create the test helper**

Create `frontend/src/test/renderWithClient.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { createQueryClient } from "../api/queryClient";

export function renderWithClient(ui: ReactElement) {
  const queryClient = createQueryClient({ retry: false });
  const user = userEvent.setup();
  const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...result, user, queryClient };
}
```

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/lib/format.test.ts`:

```ts
import { expect, test } from "vitest";
import { formatDate, formatDuration, formatNumber } from "./format";

test("formatNumber groups thousands", () => {
  expect(formatNumber(1138)).toBe("1,138");
  expect(formatNumber(615)).toBe("615");
});

test("formatDuration shows hours and zero-padded minutes", () => {
  expect(formatDuration(118)).toBe("1h 58m");
  expect(formatDuration(456)).toBe("7h 36m");
  expect(formatDuration(120)).toBe("2h 00m");
  expect(formatDuration(45)).toBe("45m");
});

test("formatDate is short and unambiguous", () => {
  expect(formatDate("2026-10-06T09:30:00Z")).toBe("6 Oct 2026");
});
```

Create `frontend/src/features/route/geo.test.ts`:

```ts
import { expect, test } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { KM_PER_NMI, estimateFlightMinutes, greatCircleKm, midpoint } from "./geo";

test("Delhi to Mumbai is about 1,138 km", () => {
  const km = greatCircleKm(AIRPORTS.DEL, AIRPORTS.BOM);
  expect(Math.round(km)).toBe(1138);
  expect(Math.round(km / KM_PER_NMI)).toBe(615);
  expect(estimateFlightMinutes(km)).toBe(118);
});

test("London to New York is about 5,540 km", () => {
  const km = greatCircleKm(AIRPORTS.LHR, AIRPORTS.JFK);
  expect(Math.round(km)).toBe(5540);
  expect(estimateFlightMinutes(km)).toBe(456);
});

test("distance is symmetric and zero for the same point", () => {
  expect(greatCircleKm(AIRPORTS.DEL, AIRPORTS.BOM)).toBeCloseTo(greatCircleKm(AIRPORTS.BOM, AIRPORTS.DEL), 9);
  expect(greatCircleKm(AIRPORTS.DEL, AIRPORTS.DEL)).toBe(0);
});

test("midpoint lies halfway along the great circle", () => {
  const mid = midpoint({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 90 });
  expect(mid.lat).toBeCloseTo(0, 6);
  expect(mid.lng).toBeCloseTo(45, 6);
});
```

Create `frontend/src/features/route/routeStore.test.ts`:

```ts
import { beforeEach, expect, test } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { routeStore } from "./routeStore";

beforeEach(() => routeStore.reset());

test("place fills origin, then destination, then replaces destination", () => {
  routeStore.place(AIRPORTS.DEL);
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.DEL, destination: null });
  routeStore.place(AIRPORTS.BOM);
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  routeStore.place(AIRPORTS.GOI);
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.DEL, destination: AIRPORTS.GOI });
});

test("swap exchanges origin and destination and notifies subscribers", () => {
  let notified = 0;
  const unsubscribe = routeStore.subscribe(() => {
    notified += 1;
  });
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  routeStore.swap();
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.BOM, destination: AIRPORTS.DEL });
  expect(notified).toBe(2);
  unsubscribe();
});
```

Create `frontend/src/features/route/recentRoutes.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { loadRecentRoutes, recordRecentRoute } from "./recentRoutes";

const T = new Date("2026-09-29T10:00:00Z");

test("records newest first and survives a reload", () => {
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  recordRecentRoute("u1", AIRPORTS.LHR, AIRPORTS.JFK, T);
  const routes = loadRecentRoutes("u1");
  expect(routes.map((r) => `${r.origin.iata_code}-${r.destination.iata_code}`)).toEqual(["LHR-JFK", "DEL-BOM"]);
  expect(routes[0]?.scannedAt).toBe("2026-09-29T10:00:00.000Z");
});

test("re-scanning a route moves it to the top instead of duplicating it", () => {
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  recordRecentRoute("u1", AIRPORTS.LHR, AIRPORTS.JFK, T);
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  expect(loadRecentRoutes("u1").map((r) => r.origin.iata_code)).toEqual(["DEL", "LHR"]);
});

test("keeps at most 8 routes", () => {
  const codes = Object.values(AIRPORTS);
  for (const a of codes) for (const b of codes) if (a !== b) recordRecentRoute("u1", a, b, T);
  expect(loadRecentRoutes("u1")).toHaveLength(8);
});

test("each user has their own history", () => {
  recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  expect(loadRecentRoutes("u2")).toEqual([]);
});

test("corrupted or foreign data is ignored", () => {
  window.localStorage.setItem("tm-recent-routes:u1", "{not json");
  expect(loadRecentRoutes("u1")).toEqual([]);
  window.localStorage.setItem("tm-recent-routes:u1", JSON.stringify([{ origin: "DEL" }]));
  expect(loadRecentRoutes("u1")).toEqual([]);
});

test("still works when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("SecurityError");
  });
  const routes = recordRecentRoute("u1", AIRPORTS.DEL, AIRPORTS.BOM, T);
  expect(routes).toHaveLength(1);
  expect(loadRecentRoutes("u1")).toEqual([]);
});
```

Create `frontend/src/features/airports/AirportPicker.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, test } from "vitest";
import type { Airport } from "../../api/types";
import { AIRPORTS } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithClient } from "../../test/renderWithClient";
import { AirportPicker } from "./AirportPicker";

function Harness({ initial = null }: { initial?: Airport | null }) {
  const [value, setValue] = useState<Airport | null>(initial);
  return <AirportPicker label="From" value={value} onChange={setValue} />;
}

const goaResults = { status: 200, body: [AIRPORTS.GOI, AIRPORTS.GOX] };

test("asks for two letters before searching", async () => {
  const { calls } = mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "g");
  expect(screen.getByText("Type at least 2 letters")).toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

test("debounces and only searches settled terms", async () => {
  const { calls } = mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "goa");
  expect(await screen.findByRole("option", { name: /GOI/ })).toBeInTheDocument();
  expect(calls.map((c) => c.search.get("q"))).toEqual(["goa"]);
});

test("keyboard: arrow down then enter picks the highlighted airport", async () => {
  mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  const input = screen.getByRole("combobox", { name: "From" });
  await user.type(input, "goa");
  await screen.findByRole("option", { name: /GOX/ });
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByText("GOX")).toBeInTheDocument();
  expect(screen.getByText("Manohar International Airport")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "From" })).not.toBeInTheDocument();
});

test("clicking an option picks it and Change lets you search again", async () => {
  mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "goa");
  await user.click(await screen.findByRole("option", { name: /GOI/ }));
  await user.click(screen.getByRole("button", { name: "Change From" }));
  expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("");
});

test("escape closes the suggestions", async () => {
  mockApi({ "GET /api/v1/reference/airports": goaResults });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "goa");
  await screen.findByRole("listbox");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
});

test("no matches and API errors are explained", async () => {
  mockApi({ "GET /api/v1/reference/airports": { status: 200, body: [] } });
  const { user } = renderWithClient(<Harness />);
  await user.type(screen.getByRole("combobox", { name: "From" }), "zzzz");
  expect(await screen.findByText("No airports match “zzzz”")).toBeInTheDocument();

  mockApi({
    "GET /api/v1/reference/airports": {
      status: 429,
      body: { detail: "Too many requests. Please slow down." },
    },
  });
  await user.type(screen.getByRole("combobox", { name: "From" }), "x");
  expect(await screen.findByText("Too many requests. Please slow down.")).toBeInTheDocument();
});
```

Create `frontend/src/features/route/RouteScanner.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderWithClient } from "../../test/renderWithClient";
import { RouteScanner } from "./RouteScanner";
import { routeStore } from "./routeStore";

beforeEach(() => {
  routeStore.reset();
  mockApi({});
});

test("shows distance and an estimated flight time for a route", () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  renderWithClient(<RouteScanner />);
  expect(screen.getByText("1,138")).toBeInTheDocument();
  expect(screen.getByText("615 nmi")).toBeInTheDocument();
  expect(screen.getByText("1h 58m")).toBeInTheDocument();
  expect(screen.getByText(/estimate/i)).toBeInTheDocument();
});

test("reports a ready route exactly once per pair", () => {
  const onRouteReady = vi.fn();
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  const { rerender } = renderWithClient(<RouteScanner onRouteReady={onRouteReady} />);
  rerender(<RouteScanner onRouteReady={onRouteReady} />);
  expect(onRouteReady).toHaveBeenCalledOnce();
  expect(onRouteReady).toHaveBeenCalledWith(AIRPORTS.DEL, AIRPORTS.BOM);
});

test("warns when both ends are the same airport", () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.DEL });
  renderWithClient(<RouteScanner />);
  expect(screen.getByRole("alert")).toHaveTextContent("Pick two different airports.");
  expect(screen.queryByText("Great-circle distance")).not.toBeInTheDocument();
});

test("swap flips the route", async () => {
  routeStore.set({ origin: AIRPORTS.DEL, destination: AIRPORTS.BOM });
  const { user } = renderWithClient(<RouteScanner />);
  await user.click(screen.getByRole("button", { name: "Swap origin and destination" }));
  expect(routeStore.get()).toEqual({ origin: AIRPORTS.BOM, destination: AIRPORTS.DEL });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -- src/lib src/features`
Expected: FAIL — unresolved imports `./format`, `./geo`, `./routeStore`, `./AirportPicker`, `./RouteScanner`.

- [ ] **Step 4: Implement helpers and geometry**

Create `frontend/src/lib/format.ts`:

```ts
const NUMBER = new Intl.NumberFormat("en-US");
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function formatNumber(value: number): string {
  return NUMBER.format(value);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}
```

Create `frontend/src/lib/useDebouncedValue.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

Create `frontend/src/features/route/geo.ts`:

```ts
export type GeoPoint = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371;
export const KM_PER_NMI = 1.852;
/** Assumptions behind the flight-time estimate; shown to users next to the number. */
export const CRUISE_KMH = 780;
export const TAXI_CLIMB_DESCENT_MIN = 30;

const toRad = (degrees: number) => (degrees * Math.PI) / 180;
const toDeg = (radians: number) => (radians * 180) / Math.PI;

/** Haversine great-circle distance in kilometres. */
export function greatCircleKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateFlightMinutes(km: number): number {
  return Math.round((km / CRUISE_KMH) * 60 + TAXI_CLIMB_DESCENT_MIN);
}

/** Point halfway along the great circle between a and b. */
export function midpoint(a: GeoPoint, b: GeoPoint): { lat: number; lng: number } {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const lng1 = toRad(a.longitude);
  const dLng = toRad(b.longitude - a.longitude);
  const bx = Math.cos(lat2) * Math.cos(dLng);
  const by = Math.cos(lat2) * Math.sin(dLng);
  const lat = Math.atan2(Math.sin(lat1) + Math.sin(lat2), Math.sqrt((Math.cos(lat1) + bx) ** 2 + by ** 2));
  const lng = lng1 + Math.atan2(by, Math.cos(lat1) + bx);
  return { lat: toDeg(lat), lng: ((toDeg(lng) + 540) % 360) - 180 };
}
```

- [ ] **Step 5: Implement the route store and recent routes**

Create `frontend/src/features/route/routeStore.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { Airport } from "../../api/types";

export type RouteSelection = { origin: Airport | null; destination: Airport | null };

const EMPTY: RouteSelection = { origin: null, destination: null };
let state: RouteSelection = EMPTY;
const listeners = new Set<() => void>();

function emit(next: RouteSelection): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/** The route being scanned, shared by the scanner, the globe and the command palette. */
export const routeStore = {
  get: (): RouteSelection => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setOrigin(origin: Airport | null): void {
    emit({ ...state, origin });
  },
  setDestination(destination: Airport | null): void {
    emit({ ...state, destination });
  },
  /** Fill origin first, then destination; with both set, replace the destination. */
  place(airport: Airport): void {
    emit(state.origin ? { ...state, destination: airport } : { ...state, origin: airport });
  },
  swap(): void {
    emit({ origin: state.destination, destination: state.origin });
  },
  set(next: RouteSelection): void {
    emit(next);
  },
  reset(): void {
    emit(EMPTY);
  },
};

export function useRouteSelection(): RouteSelection {
  return useSyncExternalStore(routeStore.subscribe, routeStore.get, routeStore.get);
}
```

Create `frontend/src/features/route/recentRoutes.ts`:

```ts
import { useCallback, useState } from "react";
import type { Airport } from "../../api/types";

export type RecentRoute = { origin: Airport; destination: Airport; scannedAt: string };

const MAX_ROUTES = 8;
const keyFor = (userId: string) => `tm-recent-routes:${userId}`;

function isAirport(value: unknown): value is Airport {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.iata_code === "string" &&
    typeof a.name === "string" &&
    typeof a.latitude === "number" &&
    typeof a.longitude === "number"
  );
}

function isRecentRoute(value: unknown): value is RecentRoute {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return isAirport(r.origin) && isAirport(r.destination) && typeof r.scannedAt === "string";
}

export function loadRecentRoutes(userId: string): RecentRoute[] {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentRoute).slice(0, MAX_ROUTES) : [];
  } catch {
    return [];
  }
}

export function recordRecentRoute(
  userId: string,
  origin: Airport,
  destination: Airport,
  now: Date = new Date(),
): RecentRoute[] {
  const sameRoute = (r: RecentRoute) =>
    r.origin.iata_code === origin.iata_code && r.destination.iata_code === destination.iata_code;
  const next = [
    { origin, destination, scannedAt: now.toISOString() },
    ...loadRecentRoutes(userId).filter((r) => !sameRoute(r)),
  ].slice(0, MAX_ROUTES);
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // Storage blocked: history lasts for this page view only.
  }
  return next;
}

export function useRecentRoutes(userId: string) {
  const [routes, setRoutes] = useState(() => loadRecentRoutes(userId));
  const record = useCallback(
    (origin: Airport, destination: Airport) => setRoutes(recordRecentRoute(userId, origin, destination)),
    [userId],
  );
  return { routes, record };
}
```

In `frontend/src/auth/useLogout.ts`, import `routeStore` from `../features/route/routeStore` and call `routeStore.reset();` as the first line of `onSettled`, so one user's route never shows for the next user on a shared machine.

- [ ] **Step 6: Implement airport search and the picker**

Create `frontend/src/features/airports/useAirportSearch.ts`:

```ts
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { airportSearchQueryOptions } from "../../api/queries";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

export const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/** Debounced airport lookup. Queries are keyed by term, so results always match the latest term. */
export function useAirportSearch(term: string) {
  const settled = useDebouncedValue(term.trim(), DEBOUNCE_MS);
  const enabled = settled.length >= MIN_QUERY_LENGTH;
  const query = useQuery({ ...airportSearchQueryOptions(settled), enabled, placeholderData: keepPreviousData });
  return {
    results: enabled ? (query.data ?? []) : [],
    enabled,
    isSearching: enabled && query.isFetching,
    error: query.error,
  };
}
```

Create `frontend/src/features/airports/AirportPicker.tsx`:

```tsx
import { useId, useState } from "react";
import { ApiError } from "../../api/client";
import type { Airport } from "../../api/types";
import { Button } from "../../ui/Button";
import { cn } from "../../ui/cn";
import { MIN_QUERY_LENGTH, useAirportSearch } from "./useAirportSearch";

type AirportPickerProps = {
  label: string;
  value: Airport | null;
  onChange: (airport: Airport | null) => void;
  placeholder?: string;
};

export function AirportPicker({ label, value, onChange, placeholder = "City, airport or code" }: AirportPickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { results, enabled, isSearching, error } = useAirportSearch(term);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-sm border border-line bg-void/50 px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">{label}</p>
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-xl text-primary">{value.iata_code}</span>
            <span className="truncate text-sm text-ink">{value.name}</span>
          </p>
          <p className="truncate text-xs text-dim">{[value.city, value.country_name].filter(Boolean).join(", ")}</p>
        </div>
        <Button variant="ghost" size="sm" aria-label={`Change ${label}`} onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }

  const choose = (airport: Airport) => {
    onChange(airport);
    setTerm("");
    setOpen(false);
  };
  const showList = open && enabled;
  const activeOption = showList ? results[active] : undefined;
  const errorMessage = error ? (error instanceof ApiError ? error.message : "Airport search failed.") : null;
  const trimmed = term.trim();

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={term}
        className="h-10 rounded-sm border border-line bg-void/60 px-3 text-ink outline-none transition placeholder:text-dim/60 focus:border-primary"
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && activeOption) {
            event.preventDefault();
            choose(activeOption);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH && (
        <p className="text-xs text-dim">Type at least {MIN_QUERY_LENGTH} letters</p>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-sm border border-line bg-raised shadow-xl"
        >
          {results.map((airport, index) => (
            <li
              key={airport.iata_code}
              id={`${id}-opt-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex cursor-pointer items-baseline gap-3 px-3 py-2 text-sm",
                index === active ? "bg-primary/15 text-ink" : "text-dim",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(airport)}
            >
              <span className="w-10 shrink-0 font-mono text-primary">{airport.iata_code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{airport.name}</span>
                <span className="block truncate text-xs">
                  {[airport.city, airport.country_name].filter(Boolean).join(", ")}
                </span>
              </span>
            </li>
          ))}
          {isSearching && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-dim">
              Scanning…
            </li>
          )}
          {!isSearching && !errorMessage && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-dim">
              No airports match “{trimmed}”
            </li>
          )}
          {errorMessage && (
            <li role="presentation" className="px-3 py-2 text-sm text-danger">
              {errorMessage}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Implement the route scanner**

Create `frontend/src/features/route/RouteScanner.tsx`:

```tsx
import { ArrowLeftRight } from "lucide-react";
import { useEffect } from "react";
import type { Airport } from "../../api/types";
import { formatDuration, formatNumber } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";
import { AirportPicker } from "../airports/AirportPicker";
import { CRUISE_KMH, KM_PER_NMI, TAXI_CLIMB_DESCENT_MIN, estimateFlightMinutes, greatCircleKm } from "./geo";
import { routeStore, useRouteSelection } from "./routeStore";

export function RouteScanner({ onRouteReady }: { onRouteReady?: (origin: Airport, destination: Airport) => void }) {
  const { origin, destination } = useRouteSelection();
  const sameAirport = origin !== null && destination !== null && origin.iata_code === destination.iata_code;
  const km = origin && destination && !sameAirport ? greatCircleKm(origin, destination) : null;

  useEffect(() => {
    if (origin && destination && origin.iata_code !== destination.iata_code) onRouteReady?.(origin, destination);
  }, [origin, destination, onRouteReady]);

  return (
    <Panel
      eyebrow="Route scanner"
      title="Plot a route"
      actions={
        <Button
          variant="ghost"
          size="sm"
          aria-label="Swap origin and destination"
          disabled={!origin && !destination}
          onClick={() => routeStore.swap()}
        >
          <ArrowLeftRight size={14} aria-hidden="true" />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <AirportPicker label="From" value={origin} onChange={(a) => routeStore.setOrigin(a)} />
        <AirportPicker label="To" value={destination} onChange={(a) => routeStore.setDestination(a)} />
      </div>
      {sameAirport && (
        <p role="alert" className="mt-3 text-sm text-warn">
          Pick two different airports.
        </p>
      )}
      {km !== null && (
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <Readout
            label="Great-circle distance"
            value={formatNumber(Math.round(km))}
            unit="km"
            hint={`${formatNumber(Math.round(km / KM_PER_NMI))} nmi`}
          />
          <Readout
            label="Est. flight time"
            value={formatDuration(estimateFlightMinutes(km))}
            hint={`Estimate · ${CRUISE_KMH} km/h cruise + ${TAXI_CLIMB_DESCENT_MIN} min`}
          />
        </dl>
      )}
      <p className="mt-4 text-xs text-dim">Live fares appear here once a supplier is connected.</p>
    </Panel>
  );
}
```

- [ ] **Step 8: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): airport picker, route scanner with distance and flight-time estimate, recent routes

"
```

---

### Task 7: Route globe and the Mission Control dashboard

**Files:**
- Create: `frontend/src/features/globe/webgl.ts`, `frontend/src/features/globe/useElementSize.ts`, `frontend/src/features/globe/RouteGlobe.tsx`, `frontend/src/features/globe/GlobePanel.tsx`, `frontend/src/features/dashboard/RecentRoutesPanel.tsx`, `frontend/src/features/dashboard/AgencyPanel.tsx`
- Replace: `frontend/src/features/dashboard/MissionControlPage.tsx`
- Test: `frontend/src/features/globe/GlobePanel.test.tsx`, `frontend/src/features/dashboard/MissionControlPage.test.tsx`

**Interfaces:**
- Consumes: `routeStore`/`useRouteSelection`, `useRecentRoutes`, `RouteScanner`, `greatCircleKm`, `midpoint`, `formatNumber`, `useCurrentUser`, `teamQueryOptions`, `invitationsQueryOptions`, `useTheme`, `useReducedMotion`, UI kit.
- Produces: `hasWebGL(): boolean`; `useElementSize<T>()` → `[ref, {width, height}]`; `type GlobeArc = { from: Airport; to: Airport; active: boolean }`; default export `RouteGlobe({ arcs })` (lazy-loaded); `<GlobePanel arcs />` (WebGL fallback + crash boundary); `<RecentRoutesPanel routes onSelect />`; `<AgencyPanel me />`; the real `<MissionControlPage />`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/globe/GlobePanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AIRPORTS } from "../../test/fixtures";
import type { GlobeArc } from "./RouteGlobe";

const webgl = vi.hoisted(() => ({ available: true }));
const globeBehaviour = vi.hoisted(() => ({ crash: false }));

vi.mock("./webgl", () => ({ hasWebGL: () => webgl.available }));
vi.mock("./RouteGlobe", () => ({
  default: ({ arcs }: { arcs: GlobeArc[] }) => {
    if (globeBehaviour.crash) throw new Error("WebGL context lost");
    return <div data-testid="globe">{arcs.map((a) => `${a.from.iata_code}-${a.to.iata_code}${a.active ? "*" : ""}`).join(",")}</div>;
  },
}));

const { GlobePanel } = await import("./GlobePanel");
const ARCS: GlobeArc[] = [{ from: AIRPORTS.DEL, to: AIRPORTS.BOM, active: true }];

test("renders the globe with the route arcs", async () => {
  webgl.available = true;
  globeBehaviour.crash = false;
  render(<GlobePanel arcs={ARCS} />);
  expect(await screen.findByTestId("globe")).toHaveTextContent("DEL-BOM*");
});

test("shows a fallback when WebGL is unavailable", () => {
  webgl.available = false;
  render(<GlobePanel arcs={ARCS} />);
  expect(screen.getByText(/3D globe isn't available on this device/)).toBeInTheDocument();
  expect(screen.queryByTestId("globe")).not.toBeInTheDocument();
});

test("contains a globe crash", async () => {
  webgl.available = true;
  globeBehaviour.crash = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<GlobePanel arcs={ARCS} />);
  expect(await screen.findByText(/orbital view went offline/i)).toBeInTheDocument();
});
```

Create `frontend/src/features/dashboard/MissionControlPage.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { GlobeArc } from "../globe/RouteGlobe";
import { AIRPORTS, ME_AGENT, ME_OWNER } from "../../test/fixtures";
import { mockApi, type MockCall } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { routeStore } from "../route/routeStore";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => true }));
vi.mock("../globe/RouteGlobe", () => ({
  default: ({ arcs }: { arcs: GlobeArc[] }) => (
    <div data-testid="globe">
      {arcs.map((a) => `${a.from.iata_code}-${a.to.iata_code}${a.active ? "*" : ""}`).join(",")}
    </div>
  ),
}));

const search = (call: MockCall) => {
  const q = (call.search.get("q") ?? "").toLowerCase();
  const body = Object.values(AIRPORTS).filter((a) => a.iata_code.toLowerCase() === q);
  return { status: 200, body };
};

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];

beforeEach(() => routeStore.reset());

test("plotting a route draws it on the globe and remembers it", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/reference/airports": search,
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { user } = renderApp("/");
  expect(await screen.findByRole("heading", { name: "Welcome aboard, Asha" })).toBeInTheDocument();

  await user.type(screen.getByRole("combobox", { name: "From" }), "del");
  await user.click(await screen.findByRole("option", { name: /DEL/ }));
  await user.type(screen.getByRole("combobox", { name: "To" }), "bom");
  await user.click(await screen.findByRole("option", { name: /BOM/ }));

  expect(await screen.findByTestId("globe")).toHaveTextContent("DEL-BOM*");
  const recent = screen.getByRole("region", { name: "Recent routes" });
  expect(within(recent).getByRole("button", { name: /DEL → BOM/ })).toHaveTextContent("1,138 km");
  expect(window.localStorage.getItem("tm-recent-routes:u-owner")).toContain('"BOM"');
});

test("clicking a recent route re-plots it", async () => {
  window.localStorage.setItem(
    "tm-recent-routes:u-owner",
    JSON.stringify([{ origin: AIRPORTS.LHR, destination: AIRPORTS.JFK, scannedAt: "2026-09-29T10:00:00.000Z" }]),
  );
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { user } = renderApp("/");
  expect(await screen.findByTestId("globe")).toHaveTextContent("LHR-JFK");
  await user.click(screen.getByRole("button", { name: /LHR → JFK/ }));
  expect(routeStore.get().origin?.iata_code).toBe("LHR");
  await waitFor(() => expect(screen.getByTestId("globe")).toHaveTextContent("LHR-JFK*"));
});

test("the agency panel shows crew and pending invitations to managers", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": {
        status: 200,
        body: [
          {
            id: "i1",
            email: "neha@alphatravels.in",
            role: "agent",
            created_at: "2026-09-29T10:00:00Z",
            expires_at: "2026-10-06T10:00:00Z",
          },
        ],
      },
    }),
  );
  renderApp("/");
  const panel = await screen.findByRole("region", { name: "Alpha Travels" });
  expect(await within(panel).findByText("2")).toBeInTheDocument();
  expect(await within(panel).findByText("1")).toBeInTheDocument();
});

test("agents never request the invitation list", async () => {
  const { calls } = mockApi(withSession(ME_AGENT, { "GET /api/v1/team": { status: 200, body: TEAM } }));
  renderApp("/");
  await screen.findByRole("region", { name: "Alpha Travels" });
  expect(calls.some((c) => c.path === "/api/v1/invitations")).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/features/globe src/features/dashboard`
Expected: FAIL — unresolved `./GlobePanel`, missing "Welcome aboard" heading.

- [ ] **Step 3: Implement the globe pieces**

Create `frontend/src/features/globe/webgl.ts`:

```ts
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
```

Create `frontend/src/features/globe/useElementSize.ts`:

```ts
import { useCallback, useRef, useState } from "react";

export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const measure = () => setSize({ width: Math.floor(node.clientWidth), height: Math.floor(node.clientHeight) });
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(node);
  }, []);
  return [ref, size];
}
```

Create `frontend/src/features/globe/RouteGlobe.tsx`:

```tsx
import { useEffect, useMemo, useRef } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { Color, MeshPhongMaterial } from "three";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countriesTopology from "world-atlas/countries-110m.json";
import type { Airport } from "../../api/types";
import { useTheme, type Theme } from "../../ui/theme";
import { useReducedMotion } from "../../ui/useReducedMotion";
import { midpoint } from "../route/geo";
import { useElementSize } from "./useElementSize";

export type GlobeArc = { from: Airport; to: Airport; active: boolean };

const topology = countriesTopology as unknown as Topology<{ countries: GeometryCollection }>;
const COUNTRIES = feature(topology, topology.objects.countries).features;

type GlobeColors = { primary: string; ai: string; dim: string; land: string; ocean: string };

function readColors(_theme: Theme): GlobeColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    primary: read("--tm-primary"),
    ai: read("--tm-ai"),
    dim: read("--tm-text-dim"),
    land: read("--tm-globe-land"),
    ocean: read("--tm-globe-ocean"),
  };
}

function uniqueAirports(arcs: GlobeArc[]): Airport[] {
  const byCode = new Map<string, Airport>();
  for (const arc of arcs) {
    byCode.set(arc.from.iata_code, arc.from);
    byCode.set(arc.to.iata_code, arc.to);
  }
  return [...byCode.values()];
}

/** Hex-dotted 3D globe with animated great-circle arcs. Lazy-loaded (three.js is large). */
export default function RouteGlobe({ arcs }: { arcs: GlobeArc[] }) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const [theme] = useTheme();
  const reducedMotion = useReducedMotion();
  const colors = useMemo(() => readColors(theme), [theme]);
  const material = useMemo(() => new MeshPhongMaterial({ color: new Color(colors.ocean), shininess: 6 }), [colors.ocean]);
  const labels = useMemo(() => uniqueAirports(arcs), [arcs]);
  const active = useMemo(() => arcs.find((arc) => arc.active), [arcs]);

  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = !reducedMotion && !active;
    controls.autoRotateSpeed = 0.35;
  }, [reducedMotion, active, size.width]);

  useEffect(() => {
    if (!active || !globeRef.current) return;
    const mid = midpoint(active.from, active.to);
    globeRef.current.pointOfView({ lat: mid.lat, lng: mid.lng, altitude: 1.9 }, reducedMotion ? 0 : 1200);
  }, [active, reducedMotion]);

  return (
    <div ref={containerRef} className="h-full min-h-[340px] w-full">
      {size.width > 0 && size.height > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeMaterial={material}
          showAtmosphere
          atmosphereColor={colors.primary}
          atmosphereAltitude={0.16}
          hexPolygonsData={COUNTRIES}
          hexPolygonResolution={3}
          hexPolygonMargin={0.55}
          hexPolygonColor={() => colors.land}
          arcsData={arcs}
          arcStartLat={(d: object) => (d as GlobeArc).from.latitude}
          arcStartLng={(d: object) => (d as GlobeArc).from.longitude}
          arcEndLat={(d: object) => (d as GlobeArc).to.latitude}
          arcEndLng={(d: object) => (d as GlobeArc).to.longitude}
          arcColor={(d: object) => ((d as GlobeArc).active ? [colors.primary, colors.ai] : colors.dim)}
          arcStroke={(d: object) => ((d as GlobeArc).active ? 0.9 : 0.35)}
          arcDashLength={0.45}
          arcDashGap={0.18}
          arcDashAnimateTime={reducedMotion ? 0 : 2200}
          arcAltitudeAutoScale={0.45}
          labelsData={labels}
          labelLat={(d: object) => (d as Airport).latitude}
          labelLng={(d: object) => (d as Airport).longitude}
          labelText={(d: object) => (d as Airport).iata_code}
          labelSize={1.1}
          labelDotRadius={0.45}
          labelColor={() => colors.primary}
          labelResolution={2}
        />
      )}
    </div>
  );
}
```

Create `frontend/src/features/globe/GlobePanel.tsx`:

```tsx
import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { Panel } from "../../ui/Panel";
import type { GlobeArc } from "./RouteGlobe";
import { hasWebGL } from "./webgl";

const RouteGlobe = lazy(() => import("./RouteGlobe"));

function Standby({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[340px] items-center justify-center rounded-sm border border-dashed border-line">
      <p className="max-w-xs text-center font-mono text-xs uppercase tracking-[0.2em] text-dim">{message}</p>
    </div>
  );
}

/** A GPU/WebGL failure must never take down the rest of Mission Control. */
class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Standby message="The orbital view went offline. Route data below still works." />
    ) : (
      this.props.children
    );
  }
}

export function GlobePanel({ arcs }: { arcs: GlobeArc[] }) {
  const [webgl] = useState(hasWebGL);
  return (
    <Panel eyebrow="Orbital view" title="Route globe" className="flex min-h-[420px] flex-1 flex-col">
      <div className="flex-1">
        {webgl ? (
          <GlobeBoundary>
            <Suspense fallback={<Standby message="Initialising orbital view…" />}>
              <RouteGlobe arcs={arcs} />
            </Suspense>
          </GlobeBoundary>
        ) : (
          <Standby message="3D globe isn't available on this device. Route data below still works." />
        )}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Implement the dashboard panels and page**

Create `frontend/src/features/dashboard/RecentRoutesPanel.tsx`:

```tsx
import { formatNumber } from "../../lib/format";
import { Panel } from "../../ui/Panel";
import { greatCircleKm } from "../route/geo";
import type { RecentRoute } from "../route/recentRoutes";

export function RecentRoutesPanel({ routes, onSelect }: { routes: RecentRoute[]; onSelect: (route: RecentRoute) => void }) {
  return (
    <Panel eyebrow="Log" title="Recent routes">
      {routes.length === 0 ? (
        <p className="text-sm text-dim">No routes scanned yet. Plot one with the route scanner.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {routes.map((route) => (
            <li key={`${route.origin.iata_code}-${route.destination.iata_code}`}>
              <button
                type="button"
                onClick={() => onSelect(route)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left transition hover:bg-raised"
              >
                <span className="font-mono text-sm text-ink">
                  {route.origin.iata_code} → {route.destination.iata_code}
                </span>
                <span className="font-mono text-xs text-dim">
                  {formatNumber(Math.round(greatCircleKm(route.origin, route.destination)))} km
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
```

Create `frontend/src/features/dashboard/AgencyPanel.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { invitationsQueryOptions, teamQueryOptions } from "../../api/queries";
import type { Me } from "../../api/types";
import { Panel } from "../../ui/Panel";
import { Readout } from "../../ui/Readout";

export function AgencyPanel({ me }: { me: Me }) {
  const isManager = me.user.role === "owner" || me.user.role === "admin";
  const team = useQuery(teamQueryOptions);
  const invitations = useQuery({ ...invitationsQueryOptions, enabled: isManager });
  return (
    <Panel eyebrow="Agency status" title={me.agency.name}>
      <dl className="grid grid-cols-2 gap-4">
        <Readout label="Crew aboard" value={team.data ? String(team.data.length) : "—"} />
        {isManager && (
          <Readout label="Pending invites" value={invitations.data ? String(invitations.data.length) : "—"} />
        )}
      </dl>
      <Link to="/team" className="mt-4 inline-block text-sm text-primary hover:underline">
        Open crew roster
      </Link>
    </Panel>
  );
}
```

Replace `frontend/src/features/dashboard/MissionControlPage.tsx`:

```tsx
import { useMemo } from "react";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { GlobePanel } from "../globe/GlobePanel";
import type { GlobeArc } from "../globe/RouteGlobe";
import { RouteScanner } from "../route/RouteScanner";
import { useRecentRoutes } from "../route/recentRoutes";
import { routeStore, useRouteSelection } from "../route/routeStore";
import { AgencyPanel } from "./AgencyPanel";
import { RecentRoutesPanel } from "./RecentRoutesPanel";

export function MissionControlPage() {
  const me = useCurrentUser();
  const selection = useRouteSelection();
  const { routes, record } = useRecentRoutes(me?.user.id ?? "anonymous");

  const arcs = useMemo<GlobeArc[]>(() => {
    const history = routes.map((r) => ({ from: r.origin, to: r.destination, active: false }));
    const { origin, destination } = selection;
    if (!origin || !destination || origin.iata_code === destination.iata_code) return history;
    const isCurrent = (a: GlobeArc) =>
      a.from.iata_code === origin.iata_code && a.to.iata_code === destination.iata_code;
    return [{ from: origin, to: destination, active: true }, ...history.filter((a) => !isCurrent(a))];
  }, [routes, selection]);

  if (!me) return null;
  const firstName = me.user.full_name.split(" ")[0] ?? me.user.full_name;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-h-0 flex-col gap-4">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">Mission Control</p>
          <h1 className="font-display text-2xl tracking-wide text-ink">Welcome aboard, {firstName}</h1>
        </header>
        <GlobePanel arcs={arcs} />
      </div>
      <div className="flex flex-col gap-4">
        <RouteScanner onRouteReady={record} />
        <RecentRoutesPanel
          routes={routes}
          onSelect={(route) => routeStore.set({ origin: route.origin, destination: route.destination })}
        />
        <AgencyPanel me={me} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run all checks**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. If `world-atlas/countries-110m.json` can't be resolved by the bundler or TypeScript, import it through a small `src/features/globe/countries.ts` re-export with a `// @ts-expect-error` only if unavoidable, and note it.

- [ ] **Step 6: See it running**

Backend on 8010, `npm run dev`, sign in at `http://localhost:5173`. Plot DEL → BOM: the globe flies to India and draws a cyan-to-magenta arc; the scanner shows 1,138 km / 615 nmi / 1h 58m (estimate); the route appears under Recent routes. Toggle the theme: globe colours follow. In the browser devtools, emulate `prefers-reduced-motion: reduce`: the globe stops auto-rotating and arcs stop animating. Record observations (and a screenshot if possible) in the report.

- [ ] **Step 7: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): 3D route globe with WebGL fallback and the Mission Control dashboard

"
```

---

### Task 8: Command palette (Ctrl/⌘ + K)

**Files:**
- Create: `frontend/src/features/palette/CommandPalette.tsx`
- Modify: `frontend/src/shell/AppShell.tsx` (mount the palette in the header, left of the theme toggle)
- Test: `frontend/src/features/palette/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `useAirportSearch`, `routeStore`, `useLogout`, `useTheme`, router `useNavigate`.
- Produces: `<CommandPalette />` — a header button ("Command", `Ctrl K` hint) plus a dialog opened by Ctrl+K / ⌘K; commands: Mission Control, Crew roster, Design system, theme switch, Sign out; airport results (≥2 chars) that `routeStore.place()` the airport and go to `/`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/palette/CommandPalette.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AIRPORTS, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";
import { initTheme } from "../../ui/theme";
import { routeStore } from "../route/routeStore";

vi.mock("../globe/webgl", () => ({ hasWebGL: () => false }));

beforeEach(() => {
  routeStore.reset();
  initTheme();
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: [] },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "GET /api/v1/reference/airports": { status: 200, body: [AIRPORTS.GOI, AIRPORTS.GOX] },
    }),
  );
});

test("Ctrl+K opens the palette and Escape closes it", async () => {
  const { user } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("⌘K opens it too, and the header button does", async () => {
  const { user } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Meta>}k{/Meta}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: /command palette/i }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

test("typing a command and pressing Enter navigates", async () => {
  const { user, router } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "crew");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe("/team"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("the theme command switches themes", async () => {
  const { user } = renderApp("/");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "daylight");
  await user.keyboard("{Enter}");
  expect(document.documentElement.dataset.theme).toBe("daylight");
});

test("choosing an airport sets it on the route and returns to Mission Control", async () => {
  const { user, router } = renderApp("/team");
  await screen.findByRole("banner");
  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByPlaceholderText(/command or an airport/i), "goa");
  await screen.findByRole("option", { name: /GOI/ });
  await user.keyboard("{Enter}");
  expect(routeStore.get().origin?.iata_code).toBe("GOI");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/features/palette`
Expected: FAIL — unresolved `./CommandPalette` / no dialog opens.

- [ ] **Step 3: Implement the palette**

Create `frontend/src/features/palette/CommandPalette.tsx`:

```tsx
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useLogout } from "../../auth/useLogout";
import { useTheme } from "../../ui/theme";
import { useAirportSearch } from "../airports/useAirportSearch";
import { routeStore } from "../route/routeStore";

type PaletteCommand = { id: string; group: "Navigate" | "Actions"; label: string; keywords: string; run: () => void };

const GROUPS = ["Navigate", "Actions"] as const;
const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm text-dim data-[selected=true]:bg-primary/15 data-[selected=true]:text-ink";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const logout = useLogout();
  const airports = useAirportSearch(search);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = () => {
    setOpen(false);
    setSearch("");
  };
  const runAndClose = (action: () => void) => {
    close();
    action();
  };

  const commands: PaletteCommand[] = [
    { id: "nav-mission", group: "Navigate", label: "Mission Control", keywords: "home dashboard globe route", run: () => void navigate({ to: "/" }) },
    { id: "nav-team", group: "Navigate", label: "Crew roster", keywords: "team members invite crew", run: () => void navigate({ to: "/team" }) },
    { id: "nav-design", group: "Navigate", label: "Design system", keywords: "styles components tokens", run: () => void navigate({ to: "/design" }) },
    {
      id: "theme",
      group: "Actions",
      label: theme === "dark" ? "Switch to daylight theme" : "Switch to dark theme",
      keywords: "theme light dark daylight mode",
      run: () => setTheme(theme === "dark" ? "daylight" : "dark"),
    },
    { id: "logout", group: "Actions", label: "Sign out", keywords: "logout exit leave", run: () => logout.mutate() },
  ];
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(needle))
    : commands;

  return (
    <>
      <button
        type="button"
        aria-label="Open command palette"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => setOpen(true)}
        className="hidden h-8 items-center gap-2 rounded-sm border border-line px-2 text-xs text-dim transition hover:border-primary/70 hover:text-primary md:inline-flex"
      >
        <Search size={14} aria-hidden="true" />
        <span className="font-display uppercase tracking-[0.14em]">Command</span>
        <kbd className="rounded-sm border border-line px-1 font-mono text-[10px]">Ctrl K</kbd>
      </button>
      <Command.Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        label="Command palette"
        shouldFilter={false}
        overlayClassName="fixed inset-0 z-40 bg-void/70 backdrop-blur-sm"
        contentClassName="fixed left-1/2 top-[14vh] z-50 w-[min(40rem,92vw)] -translate-x-1/2 rounded-sm border border-line bg-raised p-2 shadow-2xl"
      >
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Type a command or an airport…"
          className="h-11 w-full border-b border-line bg-transparent px-3 text-ink outline-none placeholder:text-dim/60"
        />
        <Command.List className="max-h-[50vh] overflow-auto py-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-dim">No matches.</Command.Empty>
          {GROUPS.map((group) => {
            const items = visible.filter((c) => c.group === group);
            if (items.length === 0) return null;
            return (
              <Command.Group
                key={group}
                heading={group}
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.22em] [&_[cmdk-group-heading]]:text-dim"
              >
                {items.map((command) => (
                  <Command.Item key={command.id} value={command.id} onSelect={() => runAndClose(command.run)} className={itemClass}>
                    {command.label}
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
          {airports.enabled && (
            <Command.Group
              heading="Airports"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.22em] [&_[cmdk-group-heading]]:text-dim"
            >
              {airports.isSearching && airports.results.length === 0 && (
                <Command.Loading>
                  <span className="px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-dim">Scanning airports…</span>
                </Command.Loading>
              )}
              {airports.results.map((airport) => (
                <Command.Item
                  key={airport.iata_code}
                  value={`airport-${airport.iata_code}`}
                  onSelect={() =>
                    runAndClose(() => {
                      routeStore.place(airport);
                      void navigate({ to: "/" });
                    })
                  }
                  className={itemClass}
                >
                  <span className="w-10 font-mono text-primary">{airport.iata_code}</span>
                  <span className="truncate text-ink">{airport.name}</span>
                  <span className="ml-auto truncate text-xs">
                    {[airport.city, airport.country_name].filter(Boolean).join(", ")}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <p className="border-t border-line px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          ↑↓ move · ↵ select · esc close · airports fill From, then To
        </p>
      </Command.Dialog>
    </>
  );
}
```

In `frontend/src/shell/AppShell.tsx`, import `CommandPalette` from `../features/palette/CommandPalette` and render `<CommandPalette />` immediately before `<ThemeToggle />` inside the header's right-hand `div`.

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. (If the installed cmdk names `overlayClassName`/`contentClassName` differently, use its documented equivalents and note it.)

- [ ] **Step 5: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): Ctrl/Cmd+K command palette with navigation, actions and airport lookup

"
```

---

### Task 9: Crew roster — members and invitations

**Files:**
- Replace: `frontend/src/features/team/TeamPage.tsx`
- Create: `frontend/src/features/team/InvitePanel.tsx`
- Test: `frontend/src/features/team/TeamPage.test.tsx`

**Interfaces:**
- Consumes: `teamQueryOptions`, `invitationsQueryOptions`, `teamApi.createInvitation`, `qk`, `ApiError`, `asApiError`, `formatDate`, `useCurrentUser`, UI kit.
- Produces: `<TeamPage />` (roster table; managers get `<InvitePanel />`, others a note); `<InvitePanel />` (form → one-time invitation link with copy button → pending list).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/team/TeamPage.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ME_AGENT, ME_OWNER } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { renderApp, withSession } from "../../test/renderApp";

const TEAM = [
  { id: "u-owner", email: "asha@alphatravels.in", full_name: "Asha Rao", role: "owner" },
  { id: "u-agent", email: "ravi@alphatravels.in", full_name: "Ravi Kumar", role: "agent" },
];
const PENDING = {
  id: "i1",
  email: "neha@alphatravels.in",
  role: "admin",
  created_at: "2026-09-29T10:00:00Z",
  expires_at: "2026-10-06T10:00:00Z",
};

test("the roster lists every crew member with their role", async () => {
  mockApi(withSession(ME_OWNER, { "GET /api/v1/team": { status: 200, body: TEAM }, "GET /api/v1/invitations": { status: 200, body: [] } }));
  renderApp("/team");
  const table = await screen.findByRole("table", { name: "Crew members" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(3);
  expect(within(rows[1]!).getByText("Asha Rao")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("You")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("agent")).toBeInTheDocument();
});

test("an owner invites a crew member and gets a one-time link", async () => {
  let invitationsCalls = 0;
  const { calls } = mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": () => {
        invitationsCalls += 1;
        return { status: 200, body: invitationsCalls === 1 ? [] : [PENDING] };
      },
      "POST /api/v1/invitations": { status: 201, body: { ...PENDING, token: "a-alpha.tok3n" } },
    }),
  );
  const { user } = renderApp("/team");
  // user-event installs a clipboard on navigator during setup; spy on it rather than replacing navigator.
  const writeText = vi.spyOn(navigator.clipboard, "writeText");

  await user.type(await screen.findByLabelText("Crew member email"), "neha@alphatravels.in");
  await user.selectOptions(screen.getByLabelText("Role"), "admin");
  await user.click(screen.getByRole("button", { name: "Generate invitation" }));

  const link = await screen.findByLabelText("Invitation link");
  expect(link).toHaveValue(`${window.location.origin}/invite/a-alpha.tok3n`);
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "neha@alphatravels.in", role: "admin" });
  expect(screen.getByText(/shown once/i)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Copy link" }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/a-alpha.tok3n`);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

  const pending = await screen.findByRole("list", { name: "Pending invitations" });
  expect(await within(pending).findByText("neha@alphatravels.in")).toBeInTheDocument();
  expect(within(pending).getByText(/6 Oct 2026/)).toBeInTheDocument();
});

test("inviting someone who already has an account explains why it failed", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 200, body: TEAM },
      "GET /api/v1/invitations": { status: 200, body: [] },
      "POST /api/v1/invitations": { status: 409, body: { detail: "This person already has a TravelMind account." } },
    }),
  );
  const { user } = renderApp("/team");
  await user.type(await screen.findByLabelText("Crew member email"), "ravi@betatrips.in");
  await user.click(screen.getByRole("button", { name: "Generate invitation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This person already has a TravelMind account.");
});

test("agents see the roster but no invitation controls", async () => {
  const { calls } = mockApi(withSession(ME_AGENT, { "GET /api/v1/team": { status: 200, body: TEAM } }));
  renderApp("/team");
  await screen.findByRole("table", { name: "Crew members" });
  expect(screen.queryByLabelText("Crew member email")).not.toBeInTheDocument();
  expect(screen.getByText(/ask an agency owner or admin/i)).toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/v1/invitations")).toBe(false);
});

test("redirects to login when the session expires", async () => {
  mockApi(
    withSession(ME_OWNER, {
      "GET /api/v1/team": { status: 401, body: { detail: "Your session has expired. Please sign in again." } },
      "GET /api/v1/invitations": { status: 200, body: [] },
    }),
  );
  const { router } = renderApp("/team");
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toEqual({ redirect: "/team" });
  expect(await screen.findByRole("heading", { name: "Mission access" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/features/team`
Expected: FAIL — no table named "Crew members".

- [ ] **Step 3: Implement the invite panel**

Create `frontend/src/features/team/InvitePanel.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../api/client";
import { invitationsQueryOptions, qk } from "../../api/queries";
import { teamApi } from "../../api/team";
import type { InvitationCreated } from "../../api/types";
import { formatDate } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { FormError } from "../../ui/FormError";
import { Panel } from "../../ui/Panel";
import { TextField } from "../../ui/TextField";

type InviteRole = "agent" | "admin";

export function InvitePanel() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("agent");
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = useQuery(invitationsQueryOptions);
  const invite = useMutation({
    mutationFn: teamApi.createInvitation,
    onSuccess: async (invitation) => {
      setCreated(invitation);
      setCopied(false);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: qk.invitations });
    },
  });
  const error = invite.error instanceof ApiError ? invite.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const link = created ? `${window.location.origin}/invite/${created.token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel eyebrow="Invitations" title="Invite crew">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate({ email, role });
        }}
      >
        <TextField
          label="Crew member email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value as InviteRole)}
            className="h-10 rounded-sm border border-line bg-void/60 px-2 text-ink outline-none focus:border-primary"
          >
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {error && !hasFieldErrors && <FormError error={error} />}
        <Button type="submit" loading={invite.isPending}>
          Generate invitation
        </Button>
      </form>

      {created && (
        <div className="mt-5 flex flex-col gap-2 rounded-sm border border-primary/40 bg-primary/5 p-3">
          <label htmlFor="invite-link" className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
            Invitation link
          </label>
          <div className="flex gap-2">
            <input
              id="invite-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-sm border border-line bg-void/60 px-2 font-mono text-xs text-ink"
            />
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-xs text-dim">
            Shown once — send it to {created.email} now. It expires on {formatDate(created.expires_at)}.
          </p>
        </div>
      )}

      <h3 className="mb-2 mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-dim">Pending</h3>
      {pending.data && pending.data.length > 0 ? (
        <ul aria-label="Pending invitations" className="flex flex-col gap-2">
          {pending.data.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink">{invitation.email}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={invitation.role === "admin" ? "primary" : "neutral"}>{invitation.role}</Badge>
                <span className="text-xs text-dim">expires {formatDate(invitation.expires_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-label="Pending invitations">
          <li className="text-sm text-dim">No pending invitations.</li>
        </ul>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Implement the page**

Replace `frontend/src/features/team/TeamPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { asApiError } from "../../api/client";
import { teamQueryOptions } from "../../api/queries";
import { useCurrentUser } from "../../auth/useCurrentUser";
import { Badge } from "../../ui/Badge";
import { FormError } from "../../ui/FormError";
import { Panel } from "../../ui/Panel";
import { InvitePanel } from "./InvitePanel";

export function TeamPage() {
  const me = useCurrentUser();
  const team = useQuery(teamQueryOptions);
  if (!me) return null;
  const isManager = me.user.role === "owner" || me.user.role === "admin";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <Panel eyebrow="Crew roster" title={`${me.agency.name} crew`}>
        {team.isPending && <p className="font-mono text-xs uppercase tracking-[0.2em] text-dim">Loading crew…</p>}
        {team.error && <FormError error={asApiError(team.error)} />}
        {team.data && (
          <table aria-label="Crew members" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line font-mono text-[11px] uppercase tracking-[0.2em] text-dim">
                <th scope="col" className="py-2 font-normal">Name</th>
                <th scope="col" className="py-2 font-normal">Email</th>
                <th scope="col" className="py-2 font-normal">Role</th>
              </tr>
            </thead>
            <tbody>
              {team.data.map((member) => (
                <tr key={member.id} className="border-b border-line/60">
                  <td className="py-2 text-ink">
                    <span className="flex items-center gap-2">
                      {member.full_name}
                      {member.id === me.user.id && <Badge tone="ok">You</Badge>}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-xs text-dim">{member.email}</td>
                  <td className="py-2">
                    <Badge tone={member.role === "agent" ? "neutral" : "primary"}>{member.role}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {isManager ? (
        <InvitePanel />
      ) : (
        <Panel eyebrow="Invitations" title="Need another seat?">
          <p className="text-sm text-dim">Ask an agency owner or admin to invite them.</p>
        </Panel>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run all checks**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /d/travel-rag-agent
git add frontend
git commit -m "feat(frontend): crew roster with one-time invitation links and pending invitations

"
```

---

### Task 10: End-to-end golden path, CI and docs

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/golden-path.spec.ts`, `.github/workflows/frontend.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: the whole app and the real backend.
- Produces: `npm run e2e`; a `frontend` GitHub Actions workflow with `unit` (lint, typecheck, unit tests, build) and `e2e` (real Postgres + Redis + API + Playwright) jobs; updated README.

- [ ] **Step 1: Configure Playwright**

Create `frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The API must already be running on TM_API_TARGET (default http://localhost:8010).
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: Write the golden-path test**

Create `frontend/e2e/golden-path.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now();
const owner = {
  agency: `E2E Travels ${stamp}`,
  name: "Esha Owner",
  email: `owner-${stamp}@e2etravels.com`,
  password: "e2e-password-123",
};

async function signUp(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Agency name").fill(owner.agency);
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create command deck" }).click();
  await expect(page.getByRole("banner").getByText(owner.agency)).toBeVisible();
}

async function pickAirport(page: Page, label: "From" | "To", code: string) {
  await page.getByRole("combobox", { name: label }).fill(code);
  await page.getByRole("option", { name: new RegExp(code) }).first().click();
}

test("an owner plots a route, invites an agent, and the agent joins the crew", async ({ page, browser }) => {
  await signUp(page);

  await pickAirport(page, "From", "DEL");
  await pickAirport(page, "To", "BOM");
  await expect(page.getByText("1,138")).toBeVisible();
  await expect(page.getByText("1h 58m")).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent routes" }).getByText("DEL → BOM")).toBeVisible();

  await page.getByRole("link", { name: "Crew roster" }).click();
  await page.getByLabel("Crew member email").fill(`agent-${stamp}@e2etravels.com`);
  await page.getByRole("button", { name: "Generate invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toContain("/invite/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Mission access" })).toBeVisible();

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await agentPage.goto(link);
  await agentPage.getByLabel("Your name").fill("Arjun Agent");
  await agentPage.getByLabel("Password").fill("agent-password-123");
  await agentPage.getByRole("button", { name: "Join the crew" }).click();
  await expect(agentPage.getByRole("banner").getByText(owner.agency)).toBeVisible();

  await agentPage.keyboard.press("Control+k");
  await agentPage.getByPlaceholder(/command or an airport/i).fill("crew");
  await agentPage.keyboard.press("Enter");
  const table = agentPage.getByRole("table", { name: "Crew members" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(agentPage.getByText(/ask an agency owner or admin/i)).toBeVisible();
  await agentContext.close();
});

test("signed-out visitors are sent to sign in and come back afterwards", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fteam/);
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Engage" }).click();
  await expect(page).toHaveURL(/\/team$/);
});
```

- [ ] **Step 3: Run the e2e suite locally**

```bash
# Terminal 1 (backend on 8010 with real data already imported in Plan 1)
cd /d/travel-rag-agent/backend && uv run python -m uvicorn travelmind.main:create_app --factory --port 8010
# Terminal 2
cd /d/travel-rag-agent/frontend && npx playwright install chromium && npm run e2e
```
Expected: 2 passed. Stop the backend afterwards.

- [ ] **Step 4: Add the CI workflow**

Create `.github/workflows/frontend.yml`:

```yaml
name: frontend

on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ["5433:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6380:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Prepare database and reference data
        working-directory: backend
        env:
          PGPASSWORD: postgres
        run: |
          uv sync --locked
          psql -h localhost -p 5433 -U postgres -f ../infra/postgres/init.sql
          uv run python -m alembic upgrade head
          uv run python -m travelmind.reference.cli import-ourairports \
            --airports-file tests/reference/fixtures/airports.csv \
            --countries-file tests/reference/fixtures/countries.csv
      - name: Start the API
        working-directory: backend
        run: |
          nohup uv run python -m uvicorn travelmind.main:create_app --factory --port 8010 > ../api.log 2>&1 &
          for i in $(seq 1 30); do curl -sf http://localhost:8010/health && break; sleep 1; done
      - name: Run Playwright
        working-directory: frontend
        run: |
          npm ci
          npx playwright install --with-deps chromium
          npm run e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-debug
          path: |
            frontend/playwright-report
            api.log
```

- [ ] **Step 5: Update the README**

In `README.md`:
- change the status line to: `> Status: Milestone 1 in progress. Plans 1 (backend foundation) and 2 (Mission Control frontend) are complete.` and remove the note about the legacy `frontend/`;
- add a row to the Layout table: `| \`frontend/\` | React + TypeScript Mission Control app (Vite, Tailwind, TanStack Router/Query, react-globe.gl) |`;
- in "Run locally", change the uvicorn command to use `--port 8010`, change the API docs URL to `http://localhost:8010/docs`, and add a new subsection:

````markdown
### Frontend

Prerequisite: Node 24.

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 (proxies /api and /health to http://localhost:8010)
```

Set `TM_API_TARGET` in `frontend/.env.local` if the API runs elsewhere.
````

- in "Test", add:

````markdown
```bash
cd frontend
npm test                 # unit + component tests (Vitest)
npm run lint && npm run typecheck
npm run e2e              # Playwright golden path; needs the API running on :8010
```
````

- [ ] **Step 6: Final verification and commit**

```bash
cd /d/travel-rag-agent/frontend && npm run lint && npm run typecheck && npm test && npm run build
cd ../backend && uv run python -m pytest -q -W error
cd .. && git add -A && git commit -m "test(frontend): Playwright golden path, frontend CI workflow, README

"
```
Expected: everything green. Do not push (pushing happens after the final review).
