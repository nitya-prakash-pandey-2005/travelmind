# M1 · Plan 4 — Workspace & Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn TravelMind into a product that looks and works like a finished SaaS: an agency workspace (profile, clients, enquiries, quotes, activity), a data-dense Command Center with real metrics and charts, a new app shell (top bar, grouped nav, notifications, global search, onboarding), a public landing page, and a one-click, clearly labelled demo workspace for pitching.

**Architecture:** Backend adds a `workspace` package (clients, enquiries, quotes, counters, activity), a `dashboard` package (read-only metric queries over tenant tables), and a `demo` package (generator + endpoints + cleanup), all RLS-protected; search services gain per-source logging and activity events. Frontend adds a design-system layer (panels, tables, dialogs, toasts, charts), moves the signed-in app under `/app`, and builds the Command Center and landing page on typed API clients.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic, Postgres RLS, Redis; React 19 + TypeScript, TanStack Router/Query, Tailwind 4 theme tokens, hand-built SVG charts, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-travelmind-product-experience-design.md` (Plan 4 row of §2; §3, §4, §5, §6, §7, §8, §11). Parent: `2026-09-29-travelmind-saas-design.md`.

**How code is specified:** backend tasks give the migration, the core query/logic code and the tests verbatim. Frontend tasks give exact component contracts (props, accessible names, states), the tests verbatim, and code for the non-obvious parts (charts, routing); routine JSX follows the existing Mission Control components (`Panel`, `Badge`, `Button`, `Readout`) and theme tokens.

## Global Constraints

- Real data only. Demo data is fictional but real-shaped, lives only in agencies with `is_demo = true`, is labelled "Demo workspace" in the UI everywhere, and is deleted after 7 days. No hard-coded numbers in the UI.
- Every tenant table has `agency_id` and forced RLS via `tenant_rls_statements`; `activity_events`, `quote_versions` and `search_source_results` are append-only for `travelmind_app` (REVOKE UPDATE, DELETE).
- Money is integer minor units + ISO currency end to end. A quote has one currency; every option in it must be billed natively in that currency (no converted prices inside quotes).
- Server computes all sell prices and metrics; the client never sends prices.
- Supplier keys and share tokens are never logged, never returned (share tokens only once, on send), stored hashed (sha256).
- Backend: `uv run` from `backend/`; Postgres :5433, Redis :6380; `uv run python -m alembic`; full suite green with `-W error`; ruff + format + mypy clean; `status.HTTP_422_UNPROCESSABLE_CONTENT` (not ENTITY).
- Frontend: theme tokens only (no raw colours in components; chart palette lives in `theme.css`), WCAG AA in both themes, `prefers-reduced-motion` respected, keyboard reachable, no horizontal scroll at 375 px, every panel has loading (skeleton), empty and error states.
- Commit messages are plain conventional commits with **no trailers or attribution lines of any kind**; no AI/assistant mentions anywhere in code, comments, docs or commits.
- The machine is memory-constrained: run suites sequentially; never leave servers running after a task; never start anything on port 8010 except in the final task.

## Review Focus

1. **Cross-tenant and demo leakage** — agency A must never see B's clients/enquiries/quotes/events/notifications/dashboard numbers, and a demo agency's data never appears in a real agency (and vice versa) — pinned in Task 1 (RLS catalog test), Task 2 `clients_are_isolated`, Task 6 `dashboard_counts_only_own_agency`, Task 7 `demo_workspace_is_isolated_and_labelled`.
2. **Quote price integrity** — a client can't inject prices; sell prices come from cached offers + markup; mixed currencies rejected — pinned in Task 4 `version_prices_come_from_the_offer_cache`, `mixed_currency_options_are_rejected`, `unknown_offer_is_rejected`.
3. **Metrics on empty or tiny data** — a brand-new agency sees zeros/"—", never NaN, division errors or fake numbers; win rate is null until something is decided — pinned in Task 6 `empty_agency_dashboard` and Task 11 `command center empty workspace`.
4. **Demo endpoint abuse and cleanup** — `/demo` is rate-limited per IP, expired demos (and all their rows, via cascade) are deleted, cleanup is safe to run concurrently — pinned in Task 7 `demo_is_rate_limited`, `expired_demos_are_deleted_with_their_data`.
5. **Share token handling** — tokens appear once in the send response, are stored hashed, rotate on re-send, and expire — pinned in Task 4 `send_returns_token_once_and_stores_hash`, `resend_rotates_the_token`.

---

## Part A — Backend

### Task 1: Workspace schema, agency profile and counters

**Files:**
- Create: `backend/migrations/versions/0004_workspace.py`, `backend/src/travelmind/workspace/__init__.py`, `backend/src/travelmind/workspace/models.py`, `backend/src/travelmind/workspace/counters.py`, `backend/src/travelmind/workspace/agency.py` (profile service + router)
- Modify: `backend/src/travelmind/identity/models.py` (Agency and User columns), `backend/src/travelmind/identity/schemas.py` (SignupRequest.country_code; AgencyOut fields), `backend/src/travelmind/identity/service.py` (signup sets country/currency/timezone), `backend/src/travelmind/identity/router.py` (me_response), `backend/src/travelmind/hotels/service.py` (guest nationality from agency), `backend/migrations/env.py`, `backend/src/travelmind/main.py`
- Test: `backend/tests/workspace/__init__.py`, `backend/tests/workspace/test_schema.py`, `backend/tests/workspace/test_agency_api.py`, `backend/tests/workspace/test_counters.py`

**Interfaces:**
- Produces:
  - Agency columns: `country_code: str` (2), `currency: str` (3), `timezone: str`, `brand_color: str` (`#rrggbb`), `is_demo: bool`, `demo_expires_at: datetime | None`, `updated_at: datetime`. User column: `notifications_seen_at: datetime | None`.
  - Models (in `workspace/models.py`): `AgencyCounter`, `Client`, `Enquiry`, `Quote`, `QuoteVersion`, `ActivityEvent`, `SearchSourceResult` (columns exactly as the migration below).
  - `async next_number(db, agency_id: UUID, kind: Literal["enquiry","quote"]) -> int`
  - `format_number(kind, n) -> str` → `"E-0007"`, `"Q-0012"`
  - `default_timezone_for(country_code) -> str` (`IN`→`Asia/Kolkata`, `AE`→`Asia/Dubai`, `GB`→`Europe/London`, `US`→`America/New_York`, `SG`→`Asia/Singapore`, else `UTC`)
  - HTTP: `GET /api/v1/agency` → `AgencyProfile{id,name,country_code,currency,timezone,brand_color,is_demo,demo_expires_at}`; `PATCH /api/v1/agency` (owner/admin) with any of `name, country_code, currency, timezone, brand_color`.
  - `/api/v1/auth/me` agency now includes `country_code, currency, timezone, brand_color, is_demo`.
  - Signup accepts optional `country_code` (default `IN`); currency = `display_currency_for(country_code)`; timezone = `default_timezone_for`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/workspace/test_schema.py`:

```python
from sqlalchemy import text

from tests.helpers import run_as_owner
from travelmind.db import get_sessionmaker

TENANT_TABLES = [
    "agency_counters", "clients", "enquiries", "quotes", "quote_versions",
    "activity_events", "search_source_results",
]


async def test_workspace_tables_force_rls():
    async with get_sessionmaker()() as db:
        rows = (await db.execute(text(
            "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE relname = ANY(:names)"), {"names": TENANT_TABLES})).all()
    assert {r.relname for r in rows} == set(TENANT_TABLES)
    assert all(r.relrowsecurity and r.relforcerowsecurity for r in rows)


async def test_append_only_tables_deny_update_and_delete():
    async with get_sessionmaker()() as db:
        rows = (await db.execute(text(
            "SELECT table_name, privilege_type FROM information_schema.role_table_grants "
            "WHERE grantee = 'travelmind_app' AND table_name = ANY(:names)"),
            {"names": ["activity_events", "quote_versions", "search_source_results"]})).all()
    granted = {(r.table_name, r.privilege_type) for r in rows}
    for table in ("activity_events", "quote_versions", "search_source_results"):
        assert (table, "INSERT") in granted and (table, "SELECT") in granted
        assert (table, "UPDATE") not in granted and (table, "DELETE") not in granted


async def test_agencies_have_profile_columns_with_defaults():
    await run_as_owner("INSERT INTO agencies (id, name) VALUES (gen_random_uuid(), 'X')")
    async with get_sessionmaker()() as db:
        row = (await db.execute(text(
            "SELECT country_code, currency, timezone, brand_color, is_demo FROM agencies"))).one()
    assert tuple(row) == ("IN", "INR", "Asia/Kolkata", "#22d3ee", False)
```

`backend/tests/workspace/test_counters.py`:

```python
import asyncio

from tests.helpers import signup
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.workspace.counters import format_number, next_number


async def test_numbers_increase_per_agency_and_kind(client):
    agency = (await signup(client)).json()["agency"]["id"]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        got = [await next_number(db, agency, "enquiry") for _ in range(3)]
        got.append(await next_number(db, agency, "quote"))
        await db.commit()
    assert got == [1, 2, 3, 1]
    assert format_number("enquiry", 7) == "E-0007" and format_number("quote", 12345) == "Q-12345"


async def test_concurrent_numbers_are_unique(client):
    agency = (await signup(client)).json()["agency"]["id"]

    async def one() -> int:
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency)
            n = await next_number(db, agency, "quote")
            await db.commit()
            return n

    assert sorted(await asyncio.gather(*(one() for _ in range(8)))) == list(range(1, 9))
```

`backend/tests/workspace/test_agency_api.py`:

```python
from tests.helpers import make_client, signup


async def test_signup_country_sets_currency_and_timezone(client):
    r = await client.post("/api/v1/auth/signup", json={
        "agency_name": "Gulf Trips", "full_name": "Omar", "email": "omar@gulf.ae",
        "password": "correct-horse-battery", "country_code": "ae"})
    agency = r.json()["agency"]
    assert (agency["country_code"], agency["currency"], agency["timezone"], agency["is_demo"]) == (
        "AE", "AED", "Asia/Dubai", False)


async def test_signup_defaults_to_india(client):
    agency = (await signup(client)).json()["agency"]
    assert (agency["country_code"], agency["currency"]) == ("IN", "INR")


async def test_owner_updates_profile(client):
    await signup(client)
    r = await client.patch("/api/v1/agency", json={"name": "Alpha Journeys", "brand_color": "#FF8800", "timezone": "Asia/Dubai"})
    assert r.status_code == 200
    body = (await client.get("/api/v1/agency")).json()
    assert (body["name"], body["brand_color"], body["timezone"]) == ("Alpha Journeys", "#ff8800", "Asia/Dubai")


async def test_profile_validation(client):
    await signup(client)
    assert (await client.patch("/api/v1/agency", json={"brand_color": "orange"})).status_code == 422
    assert (await client.patch("/api/v1/agency", json={"timezone": "Mars/Base"})).status_code == 422
    assert (await client.patch("/api/v1/agency", json={"currency": "XYZ1"})).status_code == 422


async def test_agents_cannot_edit_profile(client, app):
    await signup(client)
    token = (await client.post("/api/v1/invitations", json={"email": "ravi@alphatravels.com", "role": "agent"})).json()["token"]
    async with make_client(app) as agent:
        await agent.post("/api/v1/invitations/accept", json={"token": token, "full_name": "Ravi", "password": "correct-horse-battery"})
        assert (await agent.patch("/api/v1/agency", json={"name": "Hijack"})).status_code == 403
        assert (await agent.get("/api/v1/agency")).status_code == 200
```

Also add to `backend/tests/hotels/test_hotels_api.py`:

```python
async def test_guest_nationality_follows_agency_country(client, airports, monkeypatch, respx_mock):
    monkeypatch.setattr(get_settings(), "liteapi_key", "sand_abc")
    route = respx_mock.post(f"{LITEAPI_BASE_URL}/hotels/rates").mock(return_value=httpx.Response(200, json=FIXTURE))
    await client.post("/api/v1/auth/signup", json={"agency_name": "Gulf", "full_name": "O", "email": "o@gulf.ae", "password": "correct-horse-battery", "country_code": "AE"})
    await client.post(SEARCH, json=stay())
    assert json.loads(route.calls.last.request.content)["guestNationality"] == "AE"
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run python -m pytest tests/workspace tests/hotels/test_hotels_api.py -q`
Expected: FAIL (missing tables/modules/fields).

- [ ] **Step 3: Migration**

Create `backend/migrations/versions/0004_workspace.py`:

```python
"""agency profile, workspace tables (clients, enquiries, quotes, activity) and per-source search results

Revision ID: 0004_workspace
Revises: 0003_offers
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from travelmind.db import tenant_rls_statements

revision: str = "0004_workspace"
down_revision: str | None = "0003_offers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
TS = sa.DateTime(timezone=True)


def _agency_fk() -> sa.Column:
    return sa.Column("agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False)


def _user_fk(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=nullable)


def _created() -> sa.Column:
    return sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.add_column("agencies", sa.Column("country_code", sa.String(2), server_default="IN", nullable=False))
    op.add_column("agencies", sa.Column("currency", sa.String(3), server_default="INR", nullable=False))
    op.add_column("agencies", sa.Column("timezone", sa.String(64), server_default="Asia/Kolkata", nullable=False))
    op.add_column("agencies", sa.Column("brand_color", sa.String(7), server_default="#22d3ee", nullable=False))
    op.add_column("agencies", sa.Column("is_demo", sa.Boolean, server_default=sa.false(), nullable=False))
    op.add_column("agencies", sa.Column("demo_expires_at", TS, nullable=True))
    op.add_column("agencies", sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False))
    op.create_index("ix_agencies_demo_expiry", "agencies", ["demo_expires_at"], postgresql_where=sa.text("is_demo"))
    op.add_column("users", sa.Column("notifications_seen_at", TS, nullable=True))

    op.create_table(
        "agency_counters",
        _agency_fk(),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("value", sa.Integer, nullable=False),
        sa.PrimaryKeyConstraint("agency_id", "kind"),
    )
    op.create_table(
        "clients",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("company_name", sa.String(200), nullable=True),
        sa.Column("home_airport", sa.String(3), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String(40)), server_default="{}", nullable=False),
        _user_fk("created_by"),
        _created(),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('individual', 'company')", name="ck_clients_kind"),
    )
    op.create_index("ix_clients_agency_name", "clients", ["agency_id", "name"])
    op.create_index(
        "uq_clients_agency_email", "clients", ["agency_id", sa.text("lower(email)")],
        unique=True, postgresql_where=sa.text("email IS NOT NULL"),
    )
    op.create_table(
        "enquiries",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("client_id", UUID, sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("raw_text", sa.Text, nullable=True),
        sa.Column("origin", sa.String(3), nullable=True),
        sa.Column("destination", sa.String(3), nullable=True),
        sa.Column("depart_date", sa.Date, nullable=True),
        sa.Column("return_date", sa.Date, nullable=True),
        sa.Column("adults", sa.SmallInteger, server_default="1", nullable=False),
        sa.Column("children_ages", postgresql.ARRAY(sa.SmallInteger), server_default="{}", nullable=False),
        sa.Column("cabin", sa.String(20), server_default="economy", nullable=False),
        sa.Column("budget_minor", sa.BigInteger, nullable=True),
        sa.Column("budget_currency", sa.String(3), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("status", sa.String(12), server_default="new", nullable=False),
        sa.Column("lost_reason", sa.String(200), nullable=True),
        _user_fk("assignee_user_id"),
        _user_fk("created_by"),
        _created(),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", TS, nullable=True),
        sa.UniqueConstraint("agency_id", "number", name="uq_enquiries_number"),
        sa.CheckConstraint("status IN ('new','quoting','quoted','won','lost')", name="ck_enquiries_status"),
        sa.CheckConstraint("source IN ('manual','pasted','copilot')", name="ck_enquiries_source"),
    )
    op.create_index("ix_enquiries_agency_status", "enquiries", ["agency_id", "status", "created_at"])
    op.create_table(
        "quotes",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("enquiry_id", UUID, sa.ForeignKey("enquiries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", UUID, sa.ForeignKey("clients.id", ondelete="SET NULL"), nullable=True),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("status", sa.String(12), server_default="draft", nullable=False),
        sa.Column("current_version", sa.Integer, server_default="0", nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("markup_kind", sa.String(8), server_default="percent", nullable=False),
        sa.Column("markup_value", sa.BigInteger, server_default="0", nullable=False),
        sa.Column("share_token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("share_expires_at", TS, nullable=True),
        sa.Column("sent_at", TS, nullable=True),
        sa.Column("first_viewed_at", TS, nullable=True),
        sa.Column("decided_at", TS, nullable=True),
        _user_fk("created_by"),
        _created(),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("agency_id", "number", name="uq_quotes_number"),
        sa.CheckConstraint(
            "status IN ('draft','sent','viewed','accepted','declined','expired')", name="ck_quotes_status"
        ),
        sa.CheckConstraint("markup_kind IN ('fixed','percent')", name="ck_quotes_markup_kind"),
        sa.CheckConstraint("markup_value >= 0", name="ck_quotes_markup_value"),
    )
    op.create_index("ix_quotes_agency_status", "quotes", ["agency_id", "status", "created_at"])
    op.create_table(
        "quote_versions",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("quote_id", UUID, sa.ForeignKey("quotes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("message", sa.Text, server_default="", nullable=False),
        sa.Column("options", postgresql.JSONB, nullable=False),
        sa.Column("totals", postgresql.JSONB, nullable=False),
        _user_fk("created_by"),
        _created(),
        sa.UniqueConstraint("quote_id", "version", name="uq_quote_versions_version"),
    )
    op.create_table(
        "activity_events",
        sa.Column("id", UUID, primary_key=True),
        _agency_fk(),
        sa.Column("occurred_at", TS, server_default=sa.func.now(), nullable=False),
        _user_fk("actor_user_id"),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("entity_type", sa.String(20), nullable=True),
        sa.Column("entity_id", UUID, nullable=True),
        sa.Column("summary", sa.String(300), nullable=False),
        sa.Column("data", postgresql.JSONB, server_default="{}", nullable=False),
    )
    op.create_index("ix_activity_agency_time", "activity_events", ["agency_id", "occurred_at"])
    op.create_table(
        "search_source_results",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _agency_fk(),
        sa.Column("search_kind", sa.String(8), nullable=False),
        sa.Column("search_id", UUID, nullable=True),
        sa.Column("supplier", sa.String(30), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("offer_count", sa.Integer, nullable=False),
        sa.Column("latency_ms", sa.Integer, nullable=False),
        sa.Column("occurred_at", TS, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("search_kind IN ('flights','hotels')", name="ck_ssr_kind"),
    )
    op.create_index("ix_ssr_agency_time", "search_source_results", ["agency_id", "occurred_at"])

    for table in ("agency_counters", "clients", "enquiries", "quotes", "quote_versions",
                  "activity_events", "search_source_results"):
        for statement in tenant_rls_statements(table):
            op.execute(statement)
    op.execute("REVOKE UPDATE, DELETE ON activity_events, quote_versions, search_source_results FROM travelmind_app")


def downgrade() -> None:
    for table in ("search_source_results", "activity_events", "quote_versions", "quotes",
                  "enquiries", "clients", "agency_counters"):
        op.drop_table(table)
    op.drop_column("users", "notifications_seen_at")
    op.drop_index("ix_agencies_demo_expiry", table_name="agencies")
    for column in ("updated_at", "demo_expires_at", "is_demo", "brand_color", "timezone", "currency", "country_code"):
        op.drop_column("agencies", column)
```

Note: `enquiries` and `quotes` rows are addressed by `(agency_id, number)`; `number` is allocated by `next_number`.

- [ ] **Step 4: Models, counters, profile service and router**

`backend/src/travelmind/workspace/models.py` — SQLAlchemy models mirroring the migration exactly (`Mapped[...]` style as in `offers/db_models.py`; `id` defaults `uuid4`; timestamps default `utcnow`; `tags`/`children_ages` use `ARRAY(String(40))`/`ARRAY(SmallInteger)` with `default=list`; JSONB via `sqlalchemy.dialects.postgresql.JSONB`). Register `import travelmind.workspace.models  # noqa: F401` in `migrations/env.py`.

`backend/src/travelmind/workspace/counters.py`:

```python
from typing import Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CounterKind = Literal["enquiry", "quote"]
_PREFIX: dict[CounterKind, str] = {"enquiry": "E", "quote": "Q"}
_NEXT_SQL = text(
    """
    INSERT INTO agency_counters (agency_id, kind, value) VALUES (:agency_id, :kind, 1)
    ON CONFLICT (agency_id, kind) DO UPDATE SET value = agency_counters.value + 1
    RETURNING value
    """
)


async def next_number(db: AsyncSession, agency_id: UUID | str, kind: CounterKind) -> int:
    """Allocate the next per-agency number. Row-locked by the upsert, so concurrent callers never collide."""
    return int((await db.execute(_NEXT_SQL, {"agency_id": str(agency_id), "kind": kind})).scalar_one())


def format_number(kind: CounterKind, n: int) -> str:
    return f"{_PREFIX[kind]}-{n:04d}"
```

`backend/src/travelmind/workspace/agency.py`: `AgencyProfile` (pydantic out model), `AgencyUpdate` (all optional: `name` 2–200 chars stripped; `country_code` 2 letters upper-cased; `currency` `^[A-Z]{3}$` after upper; `timezone` validated with `zoneinfo.ZoneInfo` (catch `ZoneInfoNotFoundError`/`ValueError` → "Unknown timezone."); `brand_color` `^#[0-9a-fA-F]{6}$`, stored lower-case), `default_timezone_for(country_code)`, `agency_router = APIRouter(prefix="/api/v1/agency")` with `GET ""` (AuthedUser) and `PATCH ""` (owner/admin via `require_role`), updating `updated_at`, recording activity `agency.updated` (Task 2 adds `record_activity`; in this task write the audit event via `record_event` only) and returning the profile. Include the router in `main.py`.

Identity changes: `SignupRequest.country_code: str = "IN"` (2 letters, upper-cased, validated against `^[A-Z]{2}$`); `service.signup` sets `country_code`, `currency=display_currency_for(country_code)`, `timezone=default_timezone_for(country_code)`; `AgencyOut` gains `country_code, currency, timezone, brand_color, is_demo`; `me_response` fills them. Hotels: `search_hotels` gains `guest_nationality: str` keyword (router passes the agency's `country_code`, loaded with `db.get(Agency, current.agency_id)`), forwarded to `LiteApiHotelSupplier.search(..., guest_nationality=...)`.

- [ ] **Step 5: Run the tests and checks, migrate dev DB**

Run: `uv run python -m pytest -q -W error && uv run ruff check . && uv run ruff format --check . && uv run python -m mypy src`, then `uv run python -m alembic upgrade head`.
Expected: all pass (the Plan 1 architecture tests also cover the new tables).

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(workspace): agency profile, workspace schema with RLS and per-agency numbering"
```

---

### Task 2: Activity log and clients API

**Files:**
- Create: `backend/src/travelmind/workspace/activity.py`, `backend/src/travelmind/workspace/clients.py` (schemas + service + router)
- Modify: `backend/src/travelmind/workspace/agency.py` (record `agency.updated` activity), `backend/src/travelmind/identity/invitations.py` (record `team.joined` on accept), `backend/src/travelmind/main.py`
- Test: `backend/tests/workspace/test_activity.py`, `backend/tests/workspace/test_clients_api.py`

**Interfaces:**
- Produces:
  - `ActivityKind = Literal["search.flights","search.hotels","client.created","enquiry.created","enquiry.status_changed","enquiry.assigned","quote.created","quote.version_added","quote.sent","quote.viewed","quote.accepted","quote.declined","quote.expired","team.joined","agency.updated","supplier.price_checked"]`
  - `record_activity(db, *, agency_id, kind, summary, actor_user_id=None, entity_type=None, entity_id=None, data=None, occurred_at=None) -> None` (adds the row; caller commits). `summary` is truncated to 300 chars; `data` must be a small dict of plain values — never secrets or prices beyond display strings.
  - Clients HTTP: `GET /api/v1/clients?q=&tag=&limit=50&offset=0` → `{items: [ClientOut], total}`; `POST /api/v1/clients` (`ClientCreate`) → 201 `ClientOut`; `GET/PATCH /api/v1/clients/{id}`; `DELETE /api/v1/clients/{id}` → 204, or 409 "This client has quotes, so it can't be deleted." when any quote references it.
  - `ClientOut{id, kind, name, email, phone, company_name, home_airport, notes, tags, created_at, updated_at, enquiry_count, quote_count}`; `ClientCreate{kind="individual", name (1–200), email?, phone? (≤40), company_name?, home_airport? (IATA, must exist in the airport index → else 422 "Unknown airport code XXX."), notes? (≤2000), tags (≤10, each 1–40 chars, lower-cased, de-duplicated)}`; duplicate email in the agency → 409 "A client with this email already exists."
  - Service functions (used by demo + later plans): `create_client(db, agency_id, actor_user_id, data: ClientCreate, *, now=None) -> Client`.

- [ ] **Step 1: Failing tests**

`backend/tests/workspace/test_activity.py`:

```python
import pytest
from sqlalchemy.exc import DBAPIError
from sqlalchemy import text

from tests.helpers import exec_as_tenant, signup
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.workspace.activity import record_activity


async def test_events_are_recorded_and_append_only(client):
    agency = (await signup(client)).json()["agency"]["id"]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        await record_activity(db, agency_id=agency, kind="client.created", summary="x" * 400)
        await db.commit()
    rows = await exec_as_tenant(agency, "SELECT kind, length(summary) FROM activity_events")
    assert rows == [("client.created", 300)]
    async with get_sessionmaker()() as db:
        await bind_tenant(db, agency)
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(text("DELETE FROM activity_events"))


async def test_profile_update_and_team_join_are_logged(client, app):
    agency = (await signup(client)).json()["agency"]["id"]
    await client.patch("/api/v1/agency", json={"name": "Alpha Journeys"})
    kinds = [r[0] for r in await exec_as_tenant(agency, "SELECT kind FROM activity_events ORDER BY occurred_at")]
    assert kinds == ["agency.updated"]
```

`backend/tests/workspace/test_clients_api.py`:

```python
from tests.helpers import make_client, signup

URL = "/api/v1/clients"


async def create(client, **fields):
    body = {"name": "Priya Sharma", "email": "priya@example.com", "tags": ["VIP", "vip", "family"]} | fields
    return await client.post(URL, json=body)


async def test_create_list_get_update(client, airports):
    await signup(client)
    r = await create(client, home_airport="del")
    assert r.status_code == 201
    made = r.json()
    assert made["tags"] == ["vip", "family"] and made["home_airport"] == "DEL" and made["quote_count"] == 0
    listing = (await client.get(URL)).json()
    assert listing["total"] == 1 and listing["items"][0]["name"] == "Priya Sharma"
    r = await client.patch(f"{URL}/{made['id']}", json={"phone": "+91 98100 00000", "tags": ["corporate"]})
    assert r.json()["phone"] == "+91 98100 00000" and r.json()["tags"] == ["corporate"]


async def test_search_and_tag_filter(client, airports):
    await signup(client)
    await create(client)
    await create(client, name="Nimbus Analytics", kind="company", email="travel@nimbus.example", tags=["corporate"])
    assert [c["name"] for c in (await client.get(URL, params={"q": "nimb"})).json()["items"]] == ["Nimbus Analytics"]
    assert [c["name"] for c in (await client.get(URL, params={"tag": "vip"})).json()["items"]] == ["Priya Sharma"]


async def test_validation(client, airports):
    await signup(client)
    assert (await create(client, home_airport="XXX")).json()["detail"] == "Unknown airport code XXX."
    await create(client)
    dup = await create(client, email="PRIYA@example.com")
    assert dup.status_code == 409 and dup.json()["detail"] == "A client with this email already exists."
    assert (await create(client, name="")).status_code == 422
    assert (await create(client, tags=[f"t{i}" for i in range(11)])).status_code == 422


async def test_clients_are_isolated(client, app, airports):
    await signup(client)
    made = (await create(client)).json()
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        assert (await other.get(URL)).json()["total"] == 0
        assert (await other.get(f"{URL}/{made['id']}")).status_code == 404
        assert (await other.patch(f"{URL}/{made['id']}", json={"name": "x"})).status_code == 404


async def test_creation_is_logged(client, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    await create(client)
    from tests.helpers import exec_as_tenant
    rows = await exec_as_tenant(agency, "SELECT kind, summary FROM activity_events WHERE kind = 'client.created'")
    assert rows == [("client.created", "Added client Priya Sharma")]


async def test_delete(client, airports):
    await signup(client)
    made = (await create(client)).json()
    assert (await client.delete(f"{URL}/{made['id']}")).status_code == 204
    assert (await client.get(f"{URL}/{made['id']}")).status_code == 404
```

(Task 4 adds the "client with quotes can't be deleted" test.)

- [ ] **Step 2: Run to verify failure** — `uv run python -m pytest tests/workspace -q` → FAIL.

- [ ] **Step 3: Implement** `activity.py` (the function above), `clients.py` (pydantic models with validators as listed; list query uses `ilike` on name/email/company_name with `%q%` escaped for `%`/`_`, `tags @> ARRAY[tag]`, ordered by `updated_at DESC`, `total` via `count(*)` over the same filter; counts via correlated subqueries on enquiries/quotes). Every mutation records activity (`client.created` summary "Added client {name}"). `team.joined` summary "{full_name} joined the team" recorded in `accept_invitation`. Routers use `AuthedUser`, `DbSession`; 404 detail "Client not found.". Include the router in `main.py`.

- [ ] **Step 4: Run tests and checks** (full backend suite with `-W error`, ruff, format, mypy).

- [ ] **Step 5: Commit** — `git commit -m "feat(workspace): activity log and clients API"`

---

### Task 3: Enquiries API with pipeline transitions

**Files:**
- Create: `backend/src/travelmind/workspace/enquiries.py` (schemas + service + router)
- Modify: `backend/src/travelmind/main.py`
- Test: `backend/tests/workspace/test_enquiries_api.py`

**Interfaces:**
- Consumes: `next_number`, `format_number`, `record_activity`, `Client`, airport index.
- Produces:
  - `EnquiryCreate{client_id?, source="manual", raw_text? (≤5000), origin?, destination? (IATA, validated against the index; must differ), depart_date?, return_date? (≥ depart), adults=1 (1–9), children_ages=[] (≤8, 0–17), cabin="economy", budget_minor? (>0), budget_currency? (required with budget), notes? (≤2000), assignee_user_id? (must be a user of this agency → else 422 "That teammate isn't in your agency.")}`
  - `EnquiryOut{id, number: "E-0001", client: {id,name}|null, source, raw_text, origin, destination, depart_date, return_date, adults, children_ages, cabin, budget: Money|null, notes, status, lost_reason, assignee: {id, full_name}|null, created_at, updated_at, closed_at, quote_count}`
  - HTTP: `GET /api/v1/enquiries?status=&assignee=&q=&limit=&offset=` → `{items, total}` (newest first); `POST` → 201; `GET/PATCH /{id}` (PATCH any create field except source/raw_text); `POST /{id}/status` body `{status, lost_reason?}`.
  - Transition rules (`ALLOWED`): `new→{quoting,quoted,lost}`, `quoting→{quoted,lost}`, `quoted→{won,lost,quoting}`, `lost→{new}`, `won→{}`. Invalid → 409 "Can't move an enquiry from {from} to {to}." `lost` requires `lost_reason` (1–200) → else 422. Entering `won`/`lost` sets `closed_at`; `lost→new` clears `closed_at` and `lost_reason`.
  - Service helpers used by Task 4 and the demo: `create_enquiry(db, agency_id, actor_user_id, data, *, now=None) -> Enquiry`; `set_enquiry_status(db, enquiry, to_status, actor_user_id, *, lost_reason=None, now=None) -> None` (validates, records `enquiry.status_changed` with summary "E-0007 moved to quoted"); changing assignee records `enquiry.assigned` with `data={"assignee_user_id": ...}`.

- [ ] **Step 1: Failing tests** (`test_enquiries_api.py`):

```python
from datetime import UTC, datetime, timedelta

from tests.helpers import exec_as_tenant, make_client, signup

URL = "/api/v1/enquiries"
DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


async def new(client, **fields):
    body = {"origin": "DEL", "destination": "BOM", "depart_date": DAY, "adults": 2} | fields
    return await client.post(URL, json=body)


async def test_create_numbers_and_logs(client, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    first, second = (await new(client)).json(), (await new(client)).json()
    assert (first["number"], second["number"], first["status"]) == ("E-0001", "E-0002", "new")
    assert await exec_as_tenant(agency, "SELECT count(*) FROM activity_events WHERE kind='enquiry.created'") == [(2,)]


async def test_status_transitions(client, airports):
    await signup(client)
    e = (await new(client)).json()
    move = lambda s, **kw: client.post(f"{URL}/{e['id']}/status", json={"status": s} | kw)  # noqa: E731
    assert (await move("won")).status_code == 409
    assert (await move("won")).json()["detail"] == "Can't move an enquiry from new to won."
    assert (await move("quoting")).status_code == 200
    assert (await move("quoted")).status_code == 200
    assert (await move("lost")).status_code == 422
    r = await move("lost", lost_reason="Chose another agency")
    assert r.json()["status"] == "lost" and r.json()["closed_at"] is not None
    r = await move("new")
    assert r.json()["closed_at"] is None and r.json()["lost_reason"] is None


async def test_validation(client, airports):
    await signup(client)
    assert (await new(client, destination="DEL")).status_code == 422
    assert (await new(client, origin="XXX")).json()["detail"] == "Unknown airport code XXX."
    assert (await new(client, budget_minor=5000000)).status_code == 422  # currency missing
    assert (await new(client, assignee_user_id="00000000-0000-0000-0000-000000000000")).json()["detail"] == "That teammate isn't in your agency."


async def test_filters(client, airports):
    await signup(client)
    await new(client)
    e2 = (await new(client, origin="BOM", destination="GOI")).json()
    await client.post(f"{URL}/{e2['id']}/status", json={"status": "quoting"})
    assert [x["number"] for x in (await client.get(URL, params={"status": "quoting"})).json()["items"]] == ["E-0002"]
    assert [x["number"] for x in (await client.get(URL, params={"q": "GOI"})).json()["items"]] == ["E-0002"]
    assert [x["number"] for x in (await client.get(URL, params={"q": "E-0001"})).json()["items"]] == ["E-0001"]


async def test_enquiries_are_isolated(client, app, airports):
    await signup(client)
    e = (await new(client)).json()
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        assert (await other.get(f"{URL}/{e['id']}")).status_code == 404
        assert (await other.post(f"{URL}/{e['id']}/status", json={"status": "quoting"})).status_code == 404
```

- [ ] **Step 2–4:** implement (`q` matches `E-####` exactly by number, otherwise route codes/client name/notes ilike), run full checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(workspace): enquiries with numbered pipeline and validated transitions"`

---

### Task 4: Quotes API — versions from cached offers, markup, send and status

**Files:**
- Create: `backend/src/travelmind/workspace/quotes.py` (schemas + service + router)
- Modify: `backend/src/travelmind/main.py`, `backend/src/travelmind/workspace/clients.py` (delete guard)
- Test: `backend/tests/workspace/test_quotes_api.py`

**Interfaces:**
- Consumes: `recall_offer(redis, agency_id, offer_id)`, `OfferView` (from `offers.schemas`), `set_enquiry_status`, `next_number`, `record_activity`, `hash_token/new_token` (identity.tokens).
- Produces:
  - `QuoteCreate{enquiry_id, currency? (default agency currency), markup_kind="percent", markup_value=0 (percent in basis points 0–10000 → 0–100%; fixed in minor units ≤ 10^9)}` → creates a `draft` quote with `current_version = 0`; enquiry `new→quoting`; activity `quote.created`.
  - `QuoteVersionCreate{offer_ids: list[str] (1–3, unique), message: str (≤4000), option_markups?: list[int|None] (same length; per-option override in the quote's markup kind)}` → loads each offer from the per-agency offer cache (missing → 422 "Offer {id} is no longer available. Run the search again."); every offer's `total.currency` must equal the quote currency (else 422 "Offer {id} is priced in {cur}; this quote is in {qcur}.").
  - Sell price per option: `percent` → `total + round_half_up(total * bp / 10000)`; `fixed` → `total + value`. Stored option JSON: `{"offer": <OfferView JSON with display_total/per_traveller/insight as last shown — rebuilt via offers.service._view(offer, offer.total, None)>, "markup_minor": int, "sell": {"amount_minor", "currency"}}`. `totals = {"currency", "min_sell_minor", "max_sell_minor", "options": n}`. `current_version += 1`; activity `quote.version_added`.
  - `POST /api/v1/quotes/{id}/send` (requires ≥1 version) → `{share_url: "/q/<token>", token, expires_at}`; token = `new_token()` (url-safe, ≥32 chars), stored as `hash_token(token)`; expiry = now + 14 days; status → `sent` (from draft/sent/viewed/expired; `accepted/declined` → 409); `sent_at` set on first send; enquiry → `quoted` (if new/quoting); activity `quote.sent`. Re-send rotates the token (old hash replaced).
  - `POST /api/v1/quotes/{id}/status` `{status: "accepted"|"declined"|"expired"}` → from sent/viewed only; sets `decided_at`; `accepted` → enquiry `won`; `declined` → enquiry `lost` with reason "Quote declined"; activities `quote.accepted/declined/expired`.
  - `GET /api/v1/quotes?status=&client_id=&enquiry_id=&limit=&offset=` → `{items: [QuoteSummary{id, number "Q-0001", status, currency, client, enquiry {id, number, origin, destination, depart_date}, current_version, min_sell_minor|null, sent_at, created_at}], total}`; `GET /api/v1/quotes/{id}` → `QuoteDetail = QuoteSummary + markup_kind, markup_value, share_expires_at, first_viewed_at, decided_at, versions: [{version, message, options, totals, created_at, created_by}]` (newest first). Never returns `share_token_hash`.
  - Service helpers for the demo: `create_quote(...)`, `add_version_from_views(db, quote, views: list[OfferView], message, actor, *, option_markups=None, now=None)` (same pricing, used when offers come straight from a search), `send_quote(db, quote, actor, *, now=None) -> str`, `decide_quote(db, quote, status, actor, *, now=None)`.
  - Clients: DELETE a client with quotes → 409 "This client has quotes, so it can't be deleted."

- [ ] **Step 1: Failing tests** (`test_quotes_api.py`):

```python
import hashlib
from datetime import UTC, datetime, timedelta

from tests.helpers import exec_as_tenant, make_client, signup

DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


async def setup_quote(client, markup_kind="percent", markup_value=1000):
    await signup(client)
    enquiry = (await client.post("/api/v1/enquiries", json={"origin": "DEL", "destination": "BOM", "depart_date": DAY})).json()
    offers = (await client.post("/api/v1/flights/search", json={"origin": "DEL", "destination": "BOM", "departure_date": DAY})).json()["offers"]
    quote = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"], "markup_kind": markup_kind, "markup_value": markup_value})).json()
    return enquiry, offers, quote


async def test_version_prices_come_from_the_offer_cache(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    assert quote["number"] == "Q-0001" and quote["status"] == "draft" and quote["currency"] == "INR"
    r = await client.post(f"/api/v1/quotes/{quote['id']}/versions", json={
        "offer_ids": [offers[0]["id"], offers[1]["id"]], "message": "Two good options",
        "sell_price": 1})  # unknown field ignored — prices are never taken from the client
    assert r.status_code == 201
    version = r.json()["versions"][0]
    first = version["options"][0]
    total = offers[0]["total"]["amount_minor"]
    assert first["markup_minor"] == round(total * 0.10)
    assert first["sell"] == {"amount_minor": total + round(total * 0.10), "currency": "INR"}
    assert version["totals"]["options"] == 2
    detail = (await client.get("/api/v1/enquiries/" + enquiry["id"])).json()
    assert detail["status"] == "quoting"


async def test_unknown_offer_is_rejected(client, airports):
    _, _, quote = await setup_quote(client)
    r = await client.post(f"/api/v1/quotes/{quote['id']}/versions", json={"offer_ids": ["sandbox~nope"], "message": ""})
    assert r.status_code == 422 and r.json()["detail"] == "Offer sandbox~nope is no longer available. Run the search again."


async def test_mixed_currency_options_are_rejected(client, airports):
    enquiry, offers, _ = await setup_quote(client)
    quote = (await client.post("/api/v1/quotes", json={"enquiry_id": enquiry["id"], "currency": "USD"})).json()
    r = await client.post(f"/api/v1/quotes/{quote['id']}/versions", json={"offer_ids": [offers[0]["id"]], "message": ""})
    assert r.status_code == 422 and r.json()["detail"] == f"Offer {offers[0]['id']} is priced in INR; this quote is in USD."


async def test_send_returns_token_once_and_stores_hash(client, airports):
    enquiry, offers, quote = await setup_quote(client)
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 409  # no version yet
    await client.post(f"/api/v1/quotes/{quote['id']}/versions", json={"offer_ids": [offers[0]["id"]], "message": "Hi"})
    sent = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()
    token = sent["token"]
    assert sent["share_url"] == f"/q/{token}" and len(token) >= 32
    detail = (await client.get(f"/api/v1/quotes/{quote['id']}")).json()
    assert detail["status"] == "sent" and "token" not in detail and "share_token_hash" not in detail
    stored = await exec_as_tenant((await client.get("/api/v1/agency")).json()["id"], "SELECT share_token_hash FROM quotes")
    assert stored == [(hashlib.sha256(token.encode()).hexdigest(),)]
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "quoted"


async def test_resend_rotates_the_token(client, airports):
    _, offers, quote = await setup_quote(client)
    await client.post(f"/api/v1/quotes/{quote['id']}/versions", json={"offer_ids": [offers[0]["id"]], "message": ""})
    first = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()["token"]
    second = (await client.post(f"/api/v1/quotes/{quote['id']}/send")).json()["token"]
    assert first != second


async def test_accept_wins_the_enquiry(client, airports):
    enquiry, offers, quote = await setup_quote(client, markup_kind="fixed", markup_value=150000)
    v = (await client.post(f"/api/v1/quotes/{quote['id']}/versions", json={"offer_ids": [offers[0]["id"]], "message": ""})).json()
    assert v["versions"][0]["options"][0]["markup_minor"] == 150000
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "accepted"})).status_code == 409  # still draft
    await client.post(f"/api/v1/quotes/{quote['id']}/send")
    r = await client.post(f"/api/v1/quotes/{quote['id']}/status", json={"status": "accepted"})
    assert r.json()["status"] == "accepted" and r.json()["decided_at"]
    assert (await client.get(f"/api/v1/enquiries/{enquiry['id']}")).json()["status"] == "won"
    assert (await client.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 409


async def test_quotes_are_isolated(client, app, airports):
    _, _, quote = await setup_quote(client)
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        assert (await other.get(f"/api/v1/quotes/{quote['id']}")).status_code == 404
        assert (await other.post(f"/api/v1/quotes/{quote['id']}/send")).status_code == 404


async def test_client_with_quotes_cannot_be_deleted(client, airports):
    await signup(client)
    c = (await client.post("/api/v1/clients", json={"name": "Priya"})).json()
    e = (await client.post("/api/v1/enquiries", json={"client_id": c["id"], "origin": "DEL", "destination": "BOM", "depart_date": DAY})).json()
    await client.post("/api/v1/quotes", json={"enquiry_id": e["id"]})
    r = await client.delete(f"/api/v1/clients/{c['id']}")
    assert r.status_code == 409 and r.json()["detail"] == "This client has quotes, so it can't be deleted."
```

- [ ] **Step 2–4:** implement; half-up rounding via `Decimal` (reuse `per_traveller_minor`-style helper in `workspace/quotes.py`: `apply_markup(total_minor, kind, value) -> int`, unit-tested with 10% of 523401 → 52340 and 0.5 cases); run full checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(workspace): quotes with frozen versions, server-side markup, share tokens and decisions"`

---

### Task 5: Search instrumentation — per-source results and activity

**Files:**
- Modify: `backend/src/travelmind/offers/service.py`, `backend/src/travelmind/hotels/service.py`
- Test: `backend/tests/offers/test_search_instrumentation.py`

**Interfaces:**
- Produces:
  - `search_flights(db, redis, settings, request, *, agency_id, user_id, suppliers: Sequence[FlightSupplier] | None = None, enforce_budget: bool = True, occurred_at: datetime | None = None)`. `suppliers` overrides `flight_suppliers(...)` (demo uses the sandbox only); `enforce_budget=False` skips the rate limit (demo only; not reachable from HTTP); `occurred_at` stamps `FlightSearchLog.created_at`, the source results and the activity event (demo back-dating). Fare snapshots are always observed "now" (global table).
  - Every flight search writes one `SearchSourceResult(search_kind="flights", search_id=log_row.id, supplier, status, offer_count, latency_ms, occurred_at)` per source and one activity `search.flights` with summary "Searched DEL → BOM for 2 travellers · 12 offers" and `data={"origin","destination","offers"}`; hotel searches write `search_kind="hotels"` rows (search_id null) and `search.hotels` activity "Searched hotels near BOM · 8 offers".
  - `reprice_offer` records `supplier.price_checked` ("Checked price for {carrier} {origin}→{destination}: confirmed" / "changed").
- All writes happen in the same transaction as the existing single commit.

- [ ] **Step 1: Failing tests:**

```python
from datetime import UTC, datetime, timedelta

from tests.helpers import exec_as_tenant, signup

DAY = (datetime.now(UTC).date() + timedelta(days=30)).isoformat()


async def test_flight_search_logs_sources_and_activity(client, airports):
    agency = (await signup(client)).json()["agency"]["id"]
    body = (await client.post("/api/v1/flights/search", json={"origin": "DEL", "destination": "BOM", "departure_date": DAY, "adults": 2})).json()
    rows = await exec_as_tenant(agency, "SELECT search_kind, supplier, status, offer_count FROM search_source_results")
    assert rows == [("flights", "sandbox", "ok", len(body["offers"]))]
    events = await exec_as_tenant(agency, "SELECT kind, summary FROM activity_events WHERE kind = 'search.flights'")
    assert events == [("search.flights", f"Searched DEL → BOM for 2 travellers · {len(body['offers'])} offers")]


async def test_backdated_demo_search(client, airports):
    from travelmind.config import get_settings
    from travelmind.db import bind_tenant, get_sessionmaker
    from travelmind.offers.models import FlightSearchRequest
    from travelmind.offers.service import search_flights
    from travelmind.offers.suppliers.sandbox import SandboxFlightSupplier
    from travelmind.reference.service import get_airport_index
    from redis.asyncio import Redis
    import os

    me = (await signup(client)).json()
    agency = me["agency"]["id"]
    when = datetime.now(UTC) - timedelta(days=12)
    redis = Redis.from_url(os.environ["TM_REDIS_URL"])
    try:
        async with get_sessionmaker()() as db:
            await bind_tenant(db, agency)
            index = await get_airport_index(db)
            for _ in range(40):  # far above the per-minute budget: enforce_budget=False
                await search_flights(db, redis, get_settings(), FlightSearchRequest(origin="DEL", destination="BOM", departure_date=DAY),
                                     agency_id=agency, user_id=None, suppliers=[SandboxFlightSupplier(index.get)],
                                     enforce_budget=False, occurred_at=when)
    finally:
        await redis.aclose()
    rows = await exec_as_tenant(agency, "SELECT count(*), min(created_at) FROM flight_searches")
    assert rows[0][0] == 40 and abs((rows[0][1] - when).total_seconds()) < 1
```

- [ ] **Step 2–4:** implement; keep the existing single commit; run full checks (existing search tests must stay green).

- [ ] **Step 5: Commit** — `git commit -m "feat(offers): record per-supplier results and activity for every search"`

---

### Task 6: Dashboard, notifications, onboarding and global search APIs

**Files:**
- Create: `backend/src/travelmind/dashboard/__init__.py`, `backend/src/travelmind/dashboard/metrics.py` (query functions), `backend/src/travelmind/dashboard/router.py` (all endpoints below), `backend/src/travelmind/dashboard/schemas.py`
- Modify: `backend/src/travelmind/main.py`
- Test: `backend/tests/dashboard/__init__.py`, `backend/tests/dashboard/fixtures.py` (a builder that inserts known rows with explicit timestamps through the workspace service helpers), `backend/tests/dashboard/test_summary.py`, `backend/tests/dashboard/test_panels.py`, `backend/tests/dashboard/test_notifications_search_onboarding.py`

**Interfaces:**
- Produces (all `AuthedUser`, tenant-bound, `range` ∈ `7d|30d|90d`, default `30d`; "now" and day boundaries use the agency timezone):
  - `GET /api/v1/dashboard/summary?range=` → `{range, currency, kpis: [Kpi]}` where `Kpi{key, label, value: number|null, unit: "count"|"percent"|"money"|"minutes"|"kg", previous: number|null, series: [{date: "YYYY-MM-DD", value: number}]}` for keys in this order:
    1. `open_enquiries` — count of enquiries with status in new/quoting/quoted right now; previous = the same count as of the range start (enquiries created before it and not closed before it); series = daily count of enquiries created.
    2. `quotes_sent` — quotes with `sent_at` in range; previous = the previous equal-length period; series = daily.
    3. `win_rate` — `won / (won + lost)` over enquiries closed in range, ×100 rounded to 1 dp; `null` when none closed; previous likewise; series = daily closed-won count.
    4. `pipeline_value` — unit money in agency currency: sum over quotes with status sent|viewed and `currency = agency currency` of the latest version's `totals.min_sell_minor`; previous = null; series = daily sum of `min_sell_minor` of quotes first sent that day.
    5. `response_time` — median minutes from enquiry `created_at` to its first quote `sent_at`, for enquiries whose first quote was sent in range; `null` when none; previous period likewise; series = daily median.
    6. `co2_quoted` — sum over versions of sent quotes (sent in range) of each option's `offer.co2_kg_per_passenger × (adults + children)` from the enquiry, for options with CO₂; unit kg; previous period likewise.
    7. `searches` — flight + hotel searches in range (from `search_source_results` distinct search or activity `search.*` count); previous period; daily series.
  - `GET /dashboard/pipeline` → `{currency, stages: [{status, count, value_minor}]}` for new, quoting, quoted, won, lost (value = latest-version min sell of the enquiry's most recent quote in agency currency, else 0).
  - `GET /dashboard/activity?limit=20&before=<iso>` → `{items: [{id, kind, summary, occurred_at, actor: {id, full_name}|null, entity_type, entity_id}]}` newest first.
  - `GET /dashboard/market-pulse` → `{currency, routes: [{origin, destination, current_minor, previous_minor, change_pct, samples, weekly: [int|null ×8], provenance: "LIVE"|"SANDBOX"|"MIXED"}]}` — from `flight_searches` where `children = 0`, `display_currency = agency currency`, `cheapest_minor IS NOT NULL`; per-traveller = `cheapest_minor / adults` (half-up); current = median over the last 7 days, previous = median over days 8–35; routes need ≥2 samples in each window; top 6 by `|change_pct|`; provenance from joined `search_source_results` suppliers (`sandbox` only → SANDBOX, no sandbox → LIVE, both → MIXED).
  - `GET /dashboard/supplier-health?range=24h|7d` → `{suppliers: [{supplier, kind, calls, ok, success_pct, p50_ms, p95_ms, avg_offers}]}` from `search_source_results` (percentile_cont), ordered by calls desc.
  - `GET /dashboard/team?range=` → `{members: [{user: {id, full_name, role}, enquiries, quotes_sent, won_value_minor}]}` for every active user in the agency (zeros included), ordered by won value desc then quotes.
  - `GET /dashboard/departures` → `{items: [{enquiry_id, number, client, origin, destination, depart_date, travellers}]}` — status `won`, `depart_date >= today`, ascending, limit 10.
  - `GET /api/v1/onboarding` → `{items: [{key, label, done, href}], completed, total}` keys in order: `profile` (an `agency.updated` event exists or `is_demo`), `supplier` (Duffel or LiteAPI key configured, or `is_demo`), `team` (≥2 active users), `fare_scan` (any flight search), `client` (any client), `quote` (any quote sent). Labels: "Add your agency details", "Connect a live supplier", "Invite a teammate", "Run your first fare scan", "Add a client", "Send your first quote"; hrefs `/app/settings`, `/app/suppliers`, `/app/team`, `/app/fares`, `/app` (opens new-enquiry), `/app`.
  - `GET /api/v1/notifications` → `{unread, items: [{id, kind, summary, occurred_at, read}]}` (latest 20): events of kinds `quote.viewed|quote.accepted|quote.declined` for quotes created by the user, `enquiry.assigned` where `data.assignee_user_id` = user, `team.joined`; never events the user caused. `POST /api/v1/notifications/seen` → 204, sets `users.notifications_seen_at = now` (identity service function `mark_notifications_seen(db, user_id)`).
  - `GET /api/v1/search?q=` (q ≥ 2 chars else 422) → `{clients: [{id,name,email,company_name}], enquiries: [{id, number, origin, destination, status}], quotes: [{id, number, status, client_name}]}`, ≤5 each, tenant-scoped (numbers match `E-`/`Q-` prefixes exactly).
- Metric SQL lives in `metrics.py` as functions `summary(db, agency, range_) -> SummaryOut`, etc., each taking `now: datetime` so tests can pin time.

- [ ] **Step 1: Failing tests** — `fixtures.py` builds, for one agency with explicit timestamps via the Task 2–4 service helpers (and direct `FlightSearchLog`/`SearchSourceResult` inserts for search history): 5 enquiries (2 new, 1 quoting, 1 won, 1 lost), 3 quotes (1 draft, 1 sent with min sell 600000 INR, 1 accepted), 4 flight searches DEL→BOM (adults 1; cheapest 500000/520000 in days 8–35 and 450000/460000 in the last 7 days), source results (sandbox ok ×3 with latencies 100/200/300, error ×1). Tests assert exact values:

```python
async def test_summary_values(seeded):  # seeded = (client, agency_id, now) fixture from fixtures.py
    client, _, _ = seeded
    kpis = {k["key"]: k for k in (await client.get("/api/v1/dashboard/summary", params={"range": "30d"})).json()["kpis"]}
    assert list(kpis) == ["open_enquiries", "quotes_sent", "win_rate", "pipeline_value", "response_time", "co2_quoted", "searches"]
    assert kpis["open_enquiries"]["value"] == 3
    assert kpis["quotes_sent"]["value"] == 2
    assert kpis["win_rate"]["value"] == 50.0
    assert kpis["pipeline_value"]["value"] == 600000 and kpis["pipeline_value"]["unit"] == "money"
    assert len(kpis["searches"]["series"]) == 30


async def test_empty_agency_dashboard(client):
    await signup(client)
    body = (await client.get("/api/v1/dashboard/summary")).json()
    values = {k["key"]: k["value"] for k in body["kpis"]}
    assert values == {"open_enquiries": 0, "quotes_sent": 0, "win_rate": None, "pipeline_value": 0,
                      "response_time": None, "co2_quoted": 0, "searches": 0}
    for path in ("pipeline", "activity", "market-pulse", "supplier-health", "team", "departures"):
        assert (await client.get(f"/api/v1/dashboard/{path}")).status_code == 200


async def test_market_pulse(seeded):
    client, _, _ = seeded
    route = (await client.get("/api/v1/dashboard/market-pulse")).json()["routes"][0]
    assert (route["origin"], route["destination"], route["current_minor"], route["previous_minor"]) == ("DEL", "BOM", 455000, 510000)
    assert route["change_pct"] == -10.8 and route["provenance"] == "SANDBOX" and len(route["weekly"]) == 8


async def test_supplier_health(seeded):
    client, _, _ = seeded
    s = (await client.get("/api/v1/dashboard/supplier-health", params={"range": "7d"})).json()["suppliers"][0]
    assert (s["supplier"], s["calls"], s["ok"], s["success_pct"], s["p50_ms"]) == ("sandbox", 4, 3, 75.0, 200)


async def test_dashboard_counts_only_own_agency(seeded, app):
    _, _, _ = seeded
    async with make_client(app) as other:
        await signup(other, email="owner@betatrips.com", agency_name="Beta Trips")
        values = {k["key"]: k["value"] for k in (await other.get("/api/v1/dashboard/summary")).json()["kpis"]}
        assert values["open_enquiries"] == 0 and values["searches"] == 0
        assert (await other.get("/api/v1/dashboard/activity")).json()["items"] == []
        assert (await other.get("/api/v1/search", params={"q": "E-0001"})).json()["enquiries"] == []
```

Plus tests for: pipeline stage counts; activity ordering + `before` paging; team members include zero rows; departures only future won; onboarding progression (new agency: `completed == 0`; after a search and a client: `fare_scan` and `client` done); notifications (owner creates and sends a quote; an invited agent marks it accepted → the owner has 1 unread `quote.accepted`, the agent has 0 (own action); owner `POST /notifications/seen` → unread 0); global search (by client name, `E-0002`, `Q-0001`; `q="a"` → 422).

- [ ] **Step 2–4:** implement with parameterised SQL (`text()` with bound params only), agency timezone via `AT TIME ZONE :tz`; `generate_series` for daily series so days with no rows are 0; run full checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): command center metrics, activity, market pulse, supplier health, notifications, onboarding and search"`

---

### Task 7: Demo workspace, platform facts and cleanup

**Files:**
- Create: `backend/src/travelmind/demo/__init__.py`, `backend/src/travelmind/demo/data.py` (curated fictional names, companies, notes, route list), `backend/src/travelmind/demo/generator.py`, `backend/src/travelmind/demo/router.py`, `backend/src/travelmind/demo/cleanup.py`, `backend/src/travelmind/platform.py` (facts endpoint)
- Modify: `backend/src/travelmind/config.py` (`demo_max_per_ip: int = 5`, `demo_window_seconds: int = 3600`, `demo_ttl_days: int = 7`, `demo_cleanup_interval_seconds: int = 3600`), `backend/src/travelmind/main.py` (lifespan: run cleanup at start and every interval unless `environment == "test"`), `backend/src/travelmind/identity/deps.py` (no change to auth; demo users are normal users)
- Test: `backend/tests/demo/__init__.py`, `backend/tests/demo/test_demo.py`, `backend/tests/test_platform_facts.py`

**Interfaces:**
- Produces:
  - `POST /api/v1/demo` (public; per-IP limit `demo_max_per_ip`/`demo_window_seconds` → 429 "Too many demo workspaces from your network. Please try again later.") → 201 `MeResponse` + session cookie. Creates agency `"Orbit Travel Co."` with `is_demo=true`, `demo_expires_at = now + demo_ttl_days`, country IN; owner user "Demo Presenter" (`presenter+<uuid4hex>@demo.travelmind.invalid`, random 32-byte password, never returned) and 3 agents ("Aarav Mehta", "Sara Khan", "Leo Fernandes", same email scheme); runs `seed_demo_workspace`.
  - `seed_demo_workspace(db, redis, settings, *, agency, users, now) -> DemoSummary{clients, enquiries, quotes, events, searches}` — deterministic with `random.Random(agency.id.int)`; writes ONLY through the workspace/offers service helpers (`create_client`, `create_enquiry`, `set_enquiry_status`, `create_quote`, `add_version_from_views`, `send_quote`, `decide_quote`, `search_flights(..., suppliers=[SandboxFlightSupplier], enforce_budget=False, occurred_at=...)`, `record_activity`), passing back-dated `now`/`occurred_at` values in working hours (09:00–19:00 agency time) spread over the last 30 days. Targets: 40 clients (≈30 individuals, 10 companies; emails `*@example.com`; phones `+91 90000 0xxxx`), 60 enquiries (status mix ≈ 12 new, 10 quoting, 16 quoted, 14 won, 8 lost; `won` departures between today+3 and today+75), 35 quotes with 1–3 versions each from real sandbox searches of their enquiry trip, 30 extra back-dated searches (so market pulse and supplier health populate). Assignees spread across the 4 users.
  - `delete_expired_demos(db, *, now) -> int` — `DELETE FROM agencies WHERE is_demo AND demo_expires_at < :now RETURNING id` (cascades remove all tenant rows); logs the count.
  - `POST /api/v1/demo/exit` = logout (revoke session, clear cookie) → 204.
  - `GET /api/v1/platform/facts` (public) → `{airports: int, suppliers: [{kind, connected: int}], routes_with_history: int}` — airports from the reference table; suppliers from `supplier_statuses(settings)` grouped by kind; routes = `count(DISTINCT (origin,destination))` over `fare_snapshots` with provenance LIVE/CACHED. Cached in Redis `platform:facts` for 300 s.
  - `MeResponse.agency.is_demo` true for demo sessions (from Task 1).

- [ ] **Step 1: Failing tests** (`test_demo.py`):

```python
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from tests.helpers import exec_as_tenant, make_client, signup
from travelmind.config import get_settings


async def test_demo_workspace_is_created_signed_in_and_labelled(client, airports):
    r = await client.post("/api/v1/demo")
    assert r.status_code == 201
    me = r.json()
    assert me["agency"]["is_demo"] is True and me["agency"]["name"] == "Orbit Travel Co."
    agency = me["agency"]["id"]
    counts = await exec_as_tenant(agency, """
        SELECT (SELECT count(*) FROM clients), (SELECT count(*) FROM enquiries),
               (SELECT count(*) FROM quotes), (SELECT count(*) FROM activity_events),
               (SELECT count(*) FROM flight_searches)""")
    clients, enquiries, quotes, events, searches = counts[0]
    assert clients == 40 and enquiries == 60 and quotes == 35 and events >= 200 and searches >= 60
    emails = await exec_as_tenant(agency, "SELECT email FROM clients WHERE email IS NOT NULL")
    assert all(e[0].endswith("@example.com") for e in emails)
    summary = {k["key"]: k["value"] for k in (await client.get("/api/v1/dashboard/summary")).json()["kpis"]}
    assert summary["open_enquiries"] > 0 and summary["quotes_sent"] > 0 and summary["win_rate"] is not None
    assert (await client.get("/api/v1/dashboard/departures")).json()["items"]


async def test_demo_workspace_is_isolated_and_labelled(client, app, airports):
    demo = (await client.post("/api/v1/demo")).json()["agency"]["id"]
    async with make_client(app) as real:
        await signup(real)
        assert (await real.get("/api/v1/clients")).json()["total"] == 0
        assert (await real.get("/api/v1/agency")).json()["is_demo"] is False
    offers = await exec_as_tenant(demo, "SELECT DISTINCT o->'offer'->>'provenance' FROM quote_versions, jsonb_array_elements(options) o")
    assert offers == [("SANDBOX",)]


def test_demo_plan_is_deterministic_and_fictional():
    from datetime import date

    from travelmind.demo.data import CLIENT_NAMES, COMPANY_NAMES
    from travelmind.demo.generator import build_demo_plan

    routes = [("DEL", "BOM"), ("BOM", "GOI"), ("DEL", "GOI")]
    a = build_demo_plan(seed=42, routes=routes, today=date(2026, 9, 30))
    b = build_demo_plan(seed=42, routes=routes, today=date(2026, 9, 30))
    assert a == b
    assert len(a.clients) == 40 and len(a.enquiries) == 60 and sum(1 for e in a.enquiries if e.quote_versions) == 35
    assert {c.name for c in a.clients} <= set(CLIENT_NAMES) | set(COMPANY_NAMES)
    assert all(c.email is None or c.email.endswith("@example.com") for c in a.clients)
    assert build_demo_plan(seed=7, routes=routes, today=date(2026, 9, 30)) != a


async def test_demo_is_rate_limited(client, airports, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_max_per_ip", 1)
    assert (await client.post("/api/v1/demo")).status_code == 201
    blocked = await client.post("/api/v1/demo")
    assert blocked.status_code == 429 and "Too many demo workspaces" in blocked.json()["detail"]


async def test_expired_demos_are_deleted_with_their_data(client, app, airports):
    from travelmind.db import get_sessionmaker
    from travelmind.demo.cleanup import delete_expired_demos

    demo = (await client.post("/api/v1/demo")).json()["agency"]["id"]
    async with make_client(app) as real:
        real_agency = (await signup(real, email="real@alpha.com", agency_name="Real Co")).json()["agency"]["id"]
    async with get_sessionmaker()() as db:
        assert await delete_expired_demos(db, now=datetime.now(UTC)) == 0
        assert await delete_expired_demos(db, now=datetime.now(UTC) + timedelta(days=8)) == 1
        await db.commit()
    assert await exec_as_tenant(demo, "SELECT count(*) FROM clients") == [(0,)]
    assert await exec_as_tenant(demo, "SELECT count(*) FROM activity_events") == [(0,)]
    async with get_sessionmaker()() as db:
        remaining = (await db.execute(text("SELECT id::text FROM agencies"))).scalars().all()
    assert remaining == [real_agency]


async def test_exit_signs_out(client, airports):
    await client.post("/api/v1/demo")
    assert (await client.post("/api/v1/demo/exit")).status_code == 204
    assert (await client.get("/api/v1/auth/me")).status_code == 401
```

Generator structure: `build_demo_plan(seed: int, routes: list[tuple[str, str]], today: date) -> DemoPlan` is pure (frozen dataclasses: `DemoPlan{clients: tuple[DemoClient,...], enquiries: tuple[DemoEnquiry,...], extra_searches: tuple[DemoSearch,...]}` where `DemoEnquiry` carries the trip, status path, day offsets and `quote_versions: tuple[DemoVersionSpec,...]` — how many options and markup, not prices); `seed_demo_workspace` executes a plan through the services, getting real prices from sandbox searches. `routes` is the curated list filtered to airports present in the index.

`test_platform_facts.py`:

```python
async def test_platform_facts_are_public_and_tenant_free(client, airports):
    body = (await client.get("/api/v1/platform/facts")).json()
    assert body["airports"] >= 6 and {s["kind"] for s in body["suppliers"]} >= {"flights", "hotels"}
    assert set(body) == {"airports", "suppliers", "routes_with_history"}
```

- [ ] **Step 2–4:** implement; `data.py` holds ≥60 fictional full names (mixed Indian + international), 15 fictional company names (e.g. "Nimbus Analytics Pvt Ltd", "Crestline Pharma", "Blue Harbour Logistics"), 12 note templates, 16 real routes (DEL-BOM, BOM-DXB, BLR-SIN, DEL-LHR, BOM-JFK, MAA-KUL, DEL-DXB, HYD-BLR, CCU-BKK, DEL-GOI, BOM-SIN, BLR-DXB, DEL-CDG, BOM-LHR, COK-DXB, AMD-BOM) — the demo skips a route whose airports aren't in the index (CI fixture) and falls back to routes that are; generator must run in < 8 s on the dev DB (measure and report). Run full checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(demo): one-click labelled demo workspace, platform facts and expiry cleanup"`

---

## Part B — Frontend

### Task 8: Design-system foundation

**Files:**
- Modify: `frontend/src/styles/theme.css` (new tokens), `frontend/src/styles/index.css` (utilities `tm-glass`, `tm-edge`, `tm-shimmer`, `tm-enter`), `frontend/src/ui/Panel.tsx` (variants), `frontend/src/ui/DesignGallery.tsx` (showcase new components)
- Create: `frontend/src/ui/Skeleton.tsx`, `EmptyState.tsx`, `StatusPill.tsx`, `Avatar.tsx`, `Tabs.tsx`, `Dialog.tsx`, `Drawer.tsx`, `Menu.tsx`, `Kbd.tsx`, `DataTable.tsx`, `toast/ToastProvider.tsx` + `toast/useToast.ts`, `SegmentedControl.tsx`
- Test: `frontend/src/ui/foundation.test.tsx`, `frontend/src/ui/DataTable.test.tsx`, `frontend/src/ui/toast/toast.test.tsx`

**Interfaces / contracts:**
- Tokens (both themes, AA-checked): `--tm-glass` (panel background with alpha), `--tm-edge` (1 px gradient border from primary 35% to line), `--tm-chart-1..6` categorical palette (dark: cyan `#22d3ee`, violet `#a78bfa`, amber `#fbbf24`, emerald `#34d399`, rose `#fb7185`, sky `#60a5fa`; daylight: `#0e7490`, `#6d28d9`, `#b45309`, `#047857`, `#be123c`, `#1d4ed8`), `--tm-chart-grid`, `--tm-chart-axis`; exposed in `@theme inline` as `--color-chart-1..6`.
- `Panel` gains `variant?: "default" | "glass" | "flat"`, `dense?: boolean` (padding 3), and `headerRight?` alias for actions; existing usage unchanged.
- `Skeleton({className, lines?})` — `aria-hidden`, shimmer disabled under reduced motion; `PanelSkeleton({title})` renders a Panel with 3 skeleton lines and `aria-busy="true"`.
- `EmptyState({icon, title, description, action?: {label, onClick | to}})` — `role="status"`; action renders a `Button` or router `Link`.
- `StatusPill({status})` — maps enquiry/quote statuses to tone + label: new→"New" primary, quoting→"Quoting" ai, quoted→"Quoted" warn, won→"Won" ok, lost→"Lost" neutral, draft→"Draft" neutral, sent→"Sent" primary, viewed→"Viewed" ai, accepted→"Accepted" ok, declined→"Declined" danger, expired→"Expired" neutral.
- `Avatar({name, size?})` — initials (first + last word), deterministic chart colour from the name hash, `aria-label={name}`; `AvatarStack({names, max=3})` shows "+N".
- `Tabs({tabs: [{id,label}], value, onChange, label})` — `role="tablist"`, arrow-key navigation, `aria-selected`.
- `SegmentedControl({options, value, onChange, label})` — radio group semantics (used for range 7d/30d/90d).
- `Dialog({open, onClose, title, children, footer?})` — native `<dialog>` with `showModal`, focus trapped by the browser, Escape closes, returns focus to the opener, labelled by title. `Drawer` same with side panel styling.
- `Menu({trigger, items: [{label, onSelect, icon?, danger?}]})` — button + `role="menu"`, arrow keys, Escape, closes on select/outside click.
- `Kbd({children})`.
- `DataTable<T>({columns: [{key, header, cell: (row)=>ReactNode, sortValue?: (row)=>string|number, align?}], rows, getRowId, caption, emptyState, loading, onRowClick?, initialSort?})` — `<table>` with `<caption className="sr-only">`, sortable headers are buttons with `aria-sort`, loading shows 5 skeleton rows, empty shows `emptyState`, row click also on Enter.
- Toasts: `ToastProvider` in `AppProviders`; `useToast()` → `toast({tone: "ok"|"warn"|"danger"|"info", title, description?})`; `role="status"` live region (danger uses `role="alert"`), auto-dismiss 5 s (paused on hover/focus), max 3 visible, dismiss button.

- [ ] **Step 1: Failing tests** (excerpt — write all of them):

```tsx
test("data table sorts, shows empty and loading states", async () => {
  const user = userEvent.setup();
  const rows = [{ id: "a", name: "Zed", n: 2 }, { id: "b", name: "Amy", n: 5 }];
  const columns = [
    { key: "name", header: "Name", cell: (r: (typeof rows)[number]) => r.name, sortValue: (r: (typeof rows)[number]) => r.name },
    { key: "n", header: "Trips", cell: (r: (typeof rows)[number]) => r.n, sortValue: (r: (typeof rows)[number]) => r.n, align: "right" as const },
  ];
  const { rerender } = render(<DataTable caption="Clients" columns={columns} rows={rows} getRowId={(r) => r.id} emptyState={<p>None</p>} />);
  await user.click(screen.getByRole("button", { name: "Name" }));
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("Amy");
  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
  rerender(<DataTable caption="Clients" columns={columns} rows={[]} getRowId={(r) => r.id} emptyState={<p>None</p>} />);
  expect(screen.getByText("None")).toBeInTheDocument();
  rerender(<DataTable caption="Clients" columns={columns} rows={[]} loading getRowId={(r) => r.id} emptyState={<p>None</p>} />);
  expect(screen.getByRole("table", { name: "Clients" })).toHaveAttribute("aria-busy", "true");
});

test("status pill labels", () => {
  render(<><StatusPill status="won" /><StatusPill status="declined" /></>);
  expect(screen.getByText("Won")).toBeInTheDocument();
  expect(screen.getByText("Declined")).toBeInTheDocument();
});

test("dialog is labelled, closes on Escape and returns focus", async () => { /* open via a button; press Escape; expect opener focused */ });
test("tabs move with arrow keys", async () => { /* ArrowRight selects next tab */ });
test("menu opens, navigates and selects", async () => { /* trigger click → role=menu; ArrowDown; Enter calls onSelect */ });
test("toasts announce and dismiss", async () => { /* toast({tone:"ok", title:"Saved"}) → role=status contains Saved; dismiss button removes it */ });
test("avatar initials and stack overflow", () => { /* "Priya Sharma" → "PS"; AvatarStack 5 names max 3 → "+2" */ });
test("empty state action is a link when given `to`", () => { /* renders link with name */ });
```

(jsdom lacks `HTMLDialogElement.showModal` — polyfill in `src/test/setup.ts`: set `open` attribute and dispatch `close` on `.close()`.)

- [ ] **Step 2–4:** implement; update DesignGallery with a section per component; run `npm test && npm run lint && npm run typecheck && npm run build`.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): design-system foundation — glass panels, tables, dialogs, menus, toasts, pills, avatars"`

---

### Task 9: Chart library

**Files:**
- Create: `frontend/src/ui/charts/scale.ts`, `Sparkline.tsx`, `AreaTrend.tsx`, `BarList.tsx`, `Funnel.tsx`, `Donut.tsx`, `LatencyBand.tsx`, `KpiTile.tsx`, `ChartTooltip.tsx`, `index.ts`
- Test: `frontend/src/ui/charts/charts.test.tsx`, `frontend/src/ui/charts/scale.test.ts`

**Contracts** (all SVG with `viewBox`, responsive width via `useElementSize` from `features/globe/useElementSize.ts` moved to `src/lib/useElementSize.ts`; colours only from `--color-chart-*`/tokens; each chart has `role="img"` and an `aria-label` summary, plus a visually hidden `<table>` of its data for screen readers; hover/focus tooltips; entrance animation disabled under reduced motion):
- `scale.ts`: `linearScale(domain: [number, number], range: [number, number]) -> (v) => number` (flat domain maps to range midpoint), `niceMax(max) -> number` (1, 2, 2.5, 5 × 10^k), `pathFromPoints(points: [number, number][]) -> string` ("M x y L …"), `areaPath(points, baselineY) -> string`.
- `Sparkline({values: number[], label, tone?: "primary"|"ok"|"warn"|"danger"|"ai", height=32})` — line + last-point dot; `aria-label` = `${label}: from ${first} to ${last}`; empty values → renders nothing.
- `AreaTrend({series: [{key, label, color (1–6), points: {date, value}[]}], height=180, valueFormat, label})` — shared y-axis (niceMax), date ticks (≤6, "12 Sep"), gridlines, areas with 15% opacity + lines; keyboard: the chart container is focusable, Left/Right moves a crosshair over dates, tooltip lists each series value; hidden table columns = Date + each series.
- `BarList({items: [{label, value, hint?}], valueFormat, label, max?})` — horizontal bars, labels left, values right (mono).
- `Funnel({stages: [{label, count, value?}], label, valueFormat})` — stacked horizontal steps narrowing by count with conversion % between steps (`round(next/prev*100)`, "—" when prev 0).
- `Donut({slices: [{label, value}], label, center?: ReactNode})` — ring, legend with %.
- `LatencyBand({p50, p95, max})` — bar with p50 marker and p95 extent, labels "p50 120 ms · p95 480 ms".
- `KpiTile({label, value: string, unit?, delta?: {pct: number|null, direction: "up"|"down"|"flat", good: boolean}, series?: number[], loading?, hint?})` — value in mono 2xl, delta chip (arrow + "12%" coloured ok/danger by `good`, "—" when null), sparkline; loading → skeleton; `aria-label` for the tile summarises value and change.

- [ ] **Step 1: Failing tests** (excerpt):

```ts
test("scales", () => {
  expect(linearScale([0, 10], [0, 100])(5)).toBe(50);
  expect(linearScale([3, 3], [0, 100])(3)).toBe(50);
  expect([niceMax(0.7), niceMax(7), niceMax(23), niceMax(180)]).toEqual([1, 10, 25, 200]);
  expect(pathFromPoints([[0, 1], [2, 3]])).toBe("M0 1L2 3");
});
```

```tsx
test("area trend exposes data to assistive tech and keyboard", async () => {
  const user = userEvent.setup();
  render(<AreaTrend label="Enquiries vs quotes" valueFormat={String} series={[
    { key: "e", label: "Enquiries", color: 1, points: [{ date: "2026-09-01", value: 3 }, { date: "2026-09-02", value: 5 }] },
    { key: "q", label: "Quotes", color: 2, points: [{ date: "2026-09-01", value: 1 }, { date: "2026-09-02", value: 4 }] },
  ]} />);
  expect(screen.getByRole("img", { name: /Enquiries vs quotes/ })).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Enquiries vs quotes data" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  await user.tab();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Enquiries\s*5/);
});

test("kpi tile shows value, delta and busy state", () => {
  const { rerender } = render(<KpiTile label="Quotes sent" value="24" delta={{ pct: 12, direction: "up", good: true }} series={[1, 2, 3]} />);
  expect(screen.getByText("24")).toBeInTheDocument();
  expect(screen.getByText("12%")).toBeInTheDocument();
  rerender(<KpiTile label="Win rate" value="—" delta={{ pct: null, direction: "flat", good: true }} />);
  expect(screen.getByText("—", { selector: "[data-delta]" })).toBeInTheDocument();
  rerender(<KpiTile label="Quotes sent" value="" loading />);
  expect(screen.getByRole("group", { name: "Quotes sent" })).toHaveAttribute("aria-busy", "true");
});

test("funnel conversion", () => {
  render(<Funnel label="Pipeline" valueFormat={String} stages={[{ label: "New", count: 10 }, { label: "Quoted", count: 4 }, { label: "Won", count: 0 }]} />);
  expect(screen.getByText("40%")).toBeInTheDocument();
  expect(screen.getByText("0%")).toBeInTheDocument();
});
```

Include the `AreaTrend` core in the plan's spirit: compute `x = linearScale([0, n-1], [padL, width-padR])`, `y = linearScale([0, niceMax(max)], [height-padB, padT])`, draw per series `<path d={areaPath(...)} fill="var(--color-chart-N)" fillOpacity={0.15}/>` then the line; crosshair index state; tooltip is an absolutely positioned `role="tooltip"` div.

- [ ] **Step 2–4:** implement; add a Charts section to DesignGallery with the live components on small inline data (gallery only — clearly a component showcase, not product data); run all frontend checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(ui): accessible SVG charts — sparkline, area trend, bar list, funnel, donut, latency band, KPI tile"`

---

### Task 10: Routing under `/app` and the new app shell

**Files:**
- Modify: `frontend/src/router.tsx`, `frontend/src/shell/AppShell.tsx`, `frontend/src/shell/NavRail.tsx` → replaced by `frontend/src/shell/Sidebar.tsx`, `frontend/src/shell/StatusBar.tsx`, `frontend/src/features/palette/CommandPalette.tsx`, `frontend/src/api/types.ts` (Me.agency fields), `frontend/src/test/fixtures.ts`, every test that renders an app path (`/` → `/app`, `/fares` → `/app/fares`, `/hotels` → `/app/hotels`, `/suppliers` → `/app/suppliers`, `/team` → `/app/team`, `/design` → `/app/design`), `frontend/e2e/*.spec.ts` (URLs only)
- Create: `frontend/src/shell/TopBar.tsx`, `frontend/src/shell/NotificationsBell.tsx`, `frontend/src/shell/UserMenu.tsx`, `frontend/src/shell/DemoBanner.tsx`, `frontend/src/api/workspace.ts` (agency, notifications, search, onboarding clients), `frontend/src/shell/shell-v2.test.tsx`

**Contracts:**
- Routes: `/` (landing, public; signed-in visitors are redirected to `/app` in `beforeLoad`), `/login`, `/signup`, `/invite/$token`, `/demo` (Task 12), `/app` (Command Center), `/app/fares`, `/app/hotels`, `/app/suppliers`, `/app/team`, `/app/design`. Legacy `/fares`, `/hotels`, `/suppliers`, `/team`, `/design` redirect to their `/app/...` paths (preserving search). `safeRedirect` defaults to `/app`. Login/signup success navigate to `/app`.
- `Me.agency` gains `country_code, currency, timezone, brand_color, is_demo`.
- Sidebar: `<nav aria-label="Primary">` with groups (`<h2>` visually styled eyebrows) **Operate**: Command Center (`/app`, exact), **Market**: Fare scan, Hotel scan, **Admin**: Crew roster (`/app/team`), Suppliers, Design system. Collapse toggle (`aria-expanded`, persisted in localStorage `tm-sidebar`) — collapsed shows icons with tooltips/aria-labels. Link names stay exactly "Command Center", "Fare scan", "Hotel scan", "Crew roster", "Suppliers", "Design system" (e2e uses "Fare scan", "Suppliers", "Crew roster").
- TopBar (`<header role="banner">`): brand mark (agency initials in a square tinted by `brand_color`), agency name, `DEMO WORKSPACE` badge when `is_demo`; center: search button "Search clients, quotes, airports…" + `Ctrl K` (opens the palette); right: `NotificationsBell`, `ThemeToggle`, `UserMenu` (button with Avatar + name → menu: "Settings" (disabled until Plan 5, hidden), "Design system", "Sign out"). The existing "Sign out" button text must remain reachable as a menuitem named "Sign out" (e2e uses `getByRole("button", { name: "Sign out" })` → update e2e to open the user menu first).
- `DemoBanner`: when `is_demo`, a slim bar above main: "You're exploring a demo workspace with sample data. It resets in N days." + "Exit demo" button (POST `/api/v1/demo/exit`, then `resetSessionState`, navigate to `/`).
- `NotificationsBell`: button "Notifications" with unread count badge (`aria-label="Notifications, 3 unread"`); popover lists items (summary + relative time); opening calls `POST /notifications/seen` and invalidates; polls every 60 s; empty state "You're all caught up."
- CommandPalette: when the search term ≥2 chars, also queries `GET /api/v1/search` and shows groups **Clients**, **Enquiries**, **Quotes**. Selecting a record closes the palette and opens a `Drawer` titled with the record (client: name, email, company; enquiry: number, route, status pill; quote: number, status pill, client) — Plan 5 replaces the drawer with full record pages. Navigation commands include all sidebar items.
- StatusBar: adds agency local time (e.g. `IST 14:05:09` from the agency timezone) and "N suppliers connected" (from `/api/v1/suppliers`).
- `resetSessionState` also clears notifications/search/workspace queries (it already removes all but `me`).

- [ ] **Step 1: Failing tests** (`shell-v2.test.tsx`, excerpt):

```tsx
test("signed-in visitors at / land in the app", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { router } = renderApp("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
});

test("legacy paths redirect under /app", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { router } = renderApp("/fares");
  await waitFor(() => expect(router.state.location.pathname).toBe("/app/fares"));
});

test("grouped navigation and collapse", async () => {
  mockApi(withSession(ME_OWNER, { ...commandCenterMocks() }));
  const { user } = renderApp("/app");
  const nav = await screen.findByRole("navigation", { name: "Primary" });
  for (const name of ["Command Center", "Fare scan", "Hotel scan", "Crew roster", "Suppliers", "Design system"]) {
    expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
  }
  await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
});

test("demo workspace is badged and can be exited", async () => {
  const { calls } = mockApi(withSession(ME_DEMO, { ...commandCenterMocks(), "POST /api/v1/demo/exit": { status: 204 } }));
  const { user, router } = renderApp("/app");
  expect(await screen.findByText("DEMO WORKSPACE")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Exit demo" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(calls.some((c) => c.path === "/api/v1/demo/exit")).toBe(true);
});

test("notifications show unread and mark seen", async () => {
  const { calls } = mockApi(withSession(ME_OWNER, { ...commandCenterMocks(),
    "GET /api/v1/notifications": { status: 200, body: { unread: 2, items: [{ id: "n1", kind: "quote.viewed", summary: "Priya viewed Q-0004", occurred_at: "2026-09-30T08:00:00Z", read: false }] } },
    "POST /api/v1/notifications/seen": { status: 204 } }));
  const { user } = renderApp("/app");
  await user.click(await screen.findByRole("button", { name: "Notifications, 2 unread" }));
  expect(screen.getByText("Priya viewed Q-0004")).toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/notifications/seen")).toBe(true));
});

test("sign out lives in the user menu", async () => { /* open "Asha Rao" menu → menuitem "Sign out" → POST logout */ });
test("palette finds clients, enquiries and quotes", async () => { /* type "pri" → group "Clients" option "Priya Sharma" */ });
```

`commandCenterMocks()` lives in `src/test/workspaceFixtures.ts` (Task 11 fills it with dashboard responses; in this task it returns empty-but-valid bodies for every `/api/v1/dashboard/*`, `/api/v1/onboarding`, `/api/v1/notifications` and `/api/v1/suppliers` endpoint). `ME_DEMO` = `ME_OWNER` with `agency.is_demo = true`.

- [ ] **Step 2–4:** implement; update every existing test path; run all frontend checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): app under /app with top bar, grouped sidebar, notifications, user menu, demo banner and record search"`

---

### Task 11: Command Center

**Files:**
- Create: `frontend/src/api/dashboard.ts` (types + client + query options), `frontend/src/features/command/CommandCenterPage.tsx`, `KpiRow.tsx`, `PipelinePanel.tsx`, `TrendPanel.tsx`, `RouteMapPanel.tsx`, `ActivityFeedPanel.tsx`, `MarketPulsePanel.tsx`, `SupplierHealthPanel.tsx`, `TeamPanel.tsx`, `DeparturesPanel.tsx`, `OnboardingChecklist.tsx`, `NewEnquiryDialog.tsx`, `format.ts` (relative time, compact money)
- Modify: `frontend/src/router.tsx` (`/app` → CommandCenterPage), `frontend/src/test/workspaceFixtures.ts`, `frontend/src/features/globe/*` (arcs from dashboard routes), remove `features/dashboard/MissionControlPage.tsx` + its test (superseded; RouteScanner and RecentRoutes are reused inside Command Center)
- Test: `frontend/src/features/command/CommandCenterPage.test.tsx`, `NewEnquiryDialog.test.tsx`, `format.test.ts`

**Contracts:**
- Page header: eyebrow "Command Center", `<h1>` "Good morning, {first name}" (morning/afternoon/evening by agency local time), agency local date, `SegmentedControl` label "Range" (7d/30d/90d; persisted in the URL search `?range=`), primary button "New enquiry" (opens `NewEnquiryDialog`).
- Layout (12-col grid ≥1280 px; 2 cols ≥768 px; 1 col below):
  1. `OnboardingChecklist` (full width, until `completed === total` or dismissed via localStorage per agency) — progress bar "3 of 6 done", items as links with check icons.
  2. `KpiRow` — 7 `KpiTile`s from summary (labels: "Open enquiries", "Quotes sent", "Win rate", "Pipeline value", "Response time", "CO₂ quoted", "Searches"); formats: count → `formatNumber`; percent → `12.5%`; money → `formatMoneyCompact` (new in `lib/money.ts`: `Intl.NumberFormat(locale, {style: "currency", currency, notation: "compact", maximumFractionDigits: 1})` on the major-unit value, en-IN for INR → "₹6.2L", en-US otherwise → "$12.4K"; tested); minutes → `formatDuration`; kg → `1,240 kg`; `null` → "—". Delta: `(value-previous)/previous`; `good` = up is good except response time (down is good).
  3. `PipelinePanel` (Funnel of new→quoting→quoted→won with value; lost shown as a muted line) · `TrendPanel` (AreaTrend: "Enquiries" from open_enquiries series, "Quotes sent", "Searches") · `TeamPanel` (leaderboard with Avatar, quotes sent, won value; BarList).
  4. `RouteMapPanel` (existing `GlobePanel` with arcs from recent enquiries' routes — from `/api/v1/enquiries?limit=50`; won arcs `active`) · `ActivityFeedPanel` (Timeline of `/dashboard/activity`, avatar, summary, relative time "5 min ago", "Load more", refetch every 20 s, icons per kind).
  5. `MarketPulsePanel` (rows: route "DEL → BOM", current per-traveller fare, change chip ▲/▼ %, Sparkline of weekly, provenance Badge; empty: "Run fare scans on your routes — trends appear after two weeks of searches.") · `SupplierHealthPanel` (per supplier: StatusDot, success %, LatencyBand, avg offers; range 24h/7d toggle; empty: "No supplier calls yet." + link "Open suppliers") · Quick route (existing `RouteScanner` with `onScanFares`).
  6. `DeparturesPanel` (DataTable: Departs, Client, Route, Travellers, Enquiry; empty: "Won trips with upcoming departures show here.") · Recent routes (existing `RecentRoutesPanel`).
  - Every panel: `PanelSkeleton` while loading, `EmptyState` when empty, inline error with retry button.
- `NewEnquiryDialog`: fields From/To (AirportPicker with local state, prefilled from routeStore), Depart/Return dates, Adults (clampGuests 1–9), Cabin, Client (select existing via `GET /api/v1/clients?q=` combobox or "New client" name field that creates the client first), Notes; submit "Create enquiry" → POST; success toast "Enquiry E-0007 created" and invalidates dashboard queries; validation errors shown inline via `needsGeneralError`.

- [ ] **Step 1: Failing tests** (excerpt):

```tsx
test("command center renders every panel from real API data", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: true })));
  renderApp("/app");
  expect(await screen.findByRole("heading", { level: 1, name: /Asha/ })).toBeInTheDocument();
  expect(await screen.findByRole("group", { name: /Open enquiries/ })).toHaveTextContent("12");
  expect(screen.getByRole("group", { name: /Win rate/ })).toHaveTextContent("58.3%");
  expect(screen.getByRole("region", { name: "Pipeline" })).toHaveTextContent("Quoted");
  expect(screen.getByRole("region", { name: "Market pulse" })).toHaveTextContent("DEL → BOM");
  expect(screen.getByRole("region", { name: "Supplier health" })).toHaveTextContent("sandbox");
  expect(screen.getByRole("region", { name: "Live activity" })).toHaveTextContent("Searched DEL → BOM");
  expect(screen.getByRole("table", { name: "Upcoming departures" })).toBeInTheDocument();
});

test("command center empty workspace", async () => {
  mockApi(withSession(ME_OWNER, commandCenterMocks({ populated: false })));
  renderApp("/app");
  expect(await screen.findByRole("group", { name: /Win rate/ })).toHaveTextContent("—");
  expect(screen.getByRole("region", { name: "Market pulse" })).toHaveTextContent("trends appear after two weeks");
  expect(screen.getByText("0 of 6 done")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/NaN|undefined/);
});

test("range switch refetches with the new range", async () => { /* click "90d" → summary called with range=90d; URL ?range=90d */ });
test("a failing panel shows retry without breaking others", async () => { /* market-pulse 500 → alert + Retry; KPIs still render */ });
test("new enquiry dialog creates an enquiry and toasts", async () => { /* fill DEL/BOM + new client "Priya" → POST /api/v1/clients then /api/v1/enquiries; toast "Enquiry E-0007 created" */ });
```

`workspaceFixtures.ts` `commandCenterMocks({populated})` returns realistic API bodies matching the backend schemas exactly (field-for-field with Task 6), used only in tests.

- [ ] **Step 2–4:** implement; run all frontend checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): Command Center — KPIs, pipeline, trends, route globe, live activity, market pulse, supplier health, team and departures"`

---

### Task 12: Landing page, demo launch and signup country

**Files:**
- Create: `frontend/src/features/landing/LandingPage.tsx`, `Hero.tsx`, `FeatureGrid.tsx`, `PlatformFacts.tsx`, `HowItWorks.tsx`, `LandingFooter.tsx`, `frontend/src/features/demo/DemoLaunchPage.tsx`, `frontend/src/api/platform.ts`
- Modify: `frontend/src/router.tsx` (`/` landing, `/demo`), `frontend/src/auth/SignupPage.tsx` (Country select, default India), `frontend/src/api/auth.ts`
- Test: `frontend/src/features/landing/LandingPage.test.tsx`, `frontend/src/features/demo/DemoLaunchPage.test.tsx`, additions to `auth.test.tsx`

**Contracts:**
- Landing (public, dark Mission Control styling, no sign-in required; top nav: logo "TRAVELMIND", links "Features", "How it works", "Sign in", button "Start free"):
  - Hero: `<h1>` "The mission control for modern travel agencies", sub-copy "Search live airline and hotel inventory, see what every fare really means, and send polished quotes in minutes — every price labelled with where it came from.", buttons "Explore live demo" (→ `/demo`) and "Start free" (→ `/signup`), and a lazy-loaded globe (reuse `RouteGlobe`) with a fixed set of real popular routes as arcs (illustrative, labelled "Popular routes" — airports only, no prices).
  - `PlatformFacts` from `/api/v1/platform/facts`: "{airports} airports indexed", "{n} suppliers connected", "{routes} routes with fare history"; loading skeletons; hidden on error.
  - `FeatureGrid` (6 cards): "Every source at once" (fan-out search with per-supplier status), "Honest prices" (Live / Cached / Sandbox labels, ≈ conversions), "Fare intelligence" (per-traveller good/typical/high), "CO₂ per passenger" (Google Travel Impact Model), "Quotes in minutes" (options, markup, share links — "Coming in the next release" badge until Plan 5 ships), "Built for teams" (roles, isolated agency data, audit log).
  - `HowItWorks`: 3 steps (Capture the enquiry → Scan every supplier → Send the quote).
  - Footer: "© 2026 TravelMind", links Sign in / Start free.
- `/demo` page: on mount POSTs `/api/v1/demo`; shows "Preparing your demo workspace…" with a progress animation (static under reduced motion) and the steps list; on success sets `me` query data and navigates to `/app`; on 429 shows the detail and a "Start free instead" link; on other errors a retry button.
- Signup: Country `SelectField` with options India (IN, default), United Arab Emirates (AE), United Kingdom (GB), United States (US), Singapore (SG); always sends `country_code`; hint "Sets your currency and time zone." Test: choosing United Arab Emirates sends `country_code: "AE"`.

- [ ] **Step 1: Failing tests** (excerpt):

```tsx
test("landing shows the pitch and real platform facts", async () => {
  mockApi(withSession(null, { "GET /api/v1/platform/facts": { status: 200, body: { airports: 8801, suppliers: [{ kind: "flights", connected: 1 }, { kind: "hotels", connected: 0 }], routes_with_history: 42 } } }));
  renderApp("/");
  expect(await screen.findByRole("heading", { level: 1, name: "The mission control for modern travel agencies" })).toBeInTheDocument();
  expect(await screen.findByText("8,801")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Explore live demo" })).toHaveAttribute("href", "/demo");
  expect(screen.getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/signup");
});

test("demo launch signs in and opens the command center", async () => {
  mockApi(withSession(null, { "POST /api/v1/demo": { status: 201, body: ME_DEMO }, ...commandCenterMocks({ populated: true }) }));
  const { router } = renderApp("/demo");
  expect(screen.getByText("Preparing your demo workspace…")).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
});

test("demo rate limit is explained", async () => {
  mockApi(withSession(null, { "POST /api/v1/demo": { status: 429, body: { detail: "Too many demo workspaces from your network. Please try again later." } } }));
  renderApp("/demo");
  expect(await screen.findByRole("alert")).toHaveTextContent("Too many demo workspaces");
  expect(screen.getByRole("link", { name: "Start free instead" })).toHaveAttribute("href", "/signup");
});
```

Note: `withSession(null, …)` must allow `/demo` to call the API while signed out — `/demo` is a public route. The `me` query after demo creation is set from the POST response (`queryClient.setQueryData(qk.me, body)`), then `resetSessionState`-style cleanup of other queries is not needed (fresh session).

- [ ] **Step 2–4:** implement; run all frontend checks.

- [ ] **Step 5: Commit** — `git commit -m "feat(frontend): landing page, one-click demo launch and country at signup"`

---

### Task 13: End-to-end, docs, and run it

**Files:**
- Create: `frontend/e2e/demo.spec.ts`, `frontend/e2e/command-center.spec.ts`
- Modify: `frontend/e2e/golden-path.spec.ts`, `frontend/e2e/fare-scan.spec.ts`, `frontend/e2e/support.ts` (URLs under `/app`; sign out via user menu), `README.md` (product tour: landing, demo, Command Center; new endpoints; screenshots section placeholder-free), `.github/workflows/frontend.yml` (nothing new unless the e2e needs it)

**Contracts:**
- `demo.spec.ts`: visit `/` → click "Explore live demo" → lands on `/app` → "DEMO WORKSPACE" visible → KPI "Open enquiries" tile shows a number > 0 → "Live activity" region has ≥ 5 items → Market pulse or Supplier health shows rows → "Exit demo" returns to `/`.
- `command-center.spec.ts`: sign up (country India) → onboarding shows "0 of 6 done" → "New enquiry" dialog: DEL → BOM, new client "Priya Sharma", create → toast "Enquiry E-0001 created" → KPI "Open enquiries" shows 1 → onboarding shows "Add a client" done → run a fare scan from the sidebar → back to Command Center, "Searches" KPI ≥ 1 and activity shows "Searched DEL → BOM".
- Existing e2e updated for `/app` URLs and the user-menu sign out.
- Final step — run the app for the owner:
  1. Backend: `uv run python -m alembic upgrade head` (dev DB), then start the API on :8010 in the background (`uv run python -m uvicorn travelmind.main:create_app --factory --port 8010`, log to a scratch file).
  2. Frontend: `npm run dev` on :5173 in the background.
  3. Verify: `curl -s localhost:8010/health`, `curl -s localhost:5173/ | head`, `POST /api/v1/demo` via curl returns 201 (then discard the cookie).
  4. Leave both running and report the URLs (`http://localhost:5173/` landing, `/demo`, `/app`).
- Full verification before commit: backend suite + lint/format/mypy; frontend test/lint/typecheck/build; e2e against a dedicated API on :8011 (`TM_FX_ENABLED=false TM_SIGNUP_MAX_PER_IP=1000 TM_DEMO_MAX_PER_IP=1000`), stopping the :8011 API afterwards.

- [ ] **Step 1: Write the e2e specs and doc changes.**
- [ ] **Step 2: Run e2e (all pass twice).**
- [ ] **Step 3: Full verification.**
- [ ] **Step 4: Commit** — `git commit -m "test(e2e): demo and command center journeys; document the product tour"`
- [ ] **Step 5: Start the app on :8010/:5173 and report URLs** (after the final review; see execution notes).
