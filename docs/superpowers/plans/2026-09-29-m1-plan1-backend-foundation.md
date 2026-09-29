# M1 · Plan 1 — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prototype backend with a production-grade FastAPI foundation: multi-tenant Postgres with row-level security, agency signup/login/sessions, team invitations, audit log, security middleware, and real airport reference data from OurAirports.

**Architecture:** A modular monolith in `backend/src/travelmind/` (one package per module: `identity`, `audit`, `reference`). PostgreSQL 16 (Docker, host port 5433) enforces tenant isolation with RLS; the app connects as a non-owner, non-bypass role and sets `app.agency_id` per transaction. Identity tables (`agencies`, `users`, `sessions`) are platform-level and only touched by `travelmind.identity`. Redis backs login rate limiting.

**Tech Stack:** Python 3.12 (uv), FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, Pydantic v2 + pydantic-settings, argon2-cffi, redis-py (asyncio), structlog, rapidfuzz, httpx, pytest + pytest-asyncio, ruff, mypy, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-29-travelmind-saas-design.md` (§4 tenancy, §5 architecture, §11 security, §13 M1 items 1–4 backend parts)

### Where this plan sits in Milestone 1

| Plan | Scope | Depends on |
|---|---|---|
| **1 (this)** | Repo restructure, DB + RLS, identity, invitations, audit, security middleware, reference data, CI | — |
| 2 | Supplier adapters (sandbox, Duffel, LiteAPI), canonical `Offer`, fan-out search, fare snapshots + route insights, Google TIM carbon, airline reference list from Duffel | 1 |
| 3 | Agent (provider interface, tools, grounding guard, SSE run trace), quotes, eval harness | 1, 2 |
| 4 | Mission Control frontend (TypeScript), replaces legacy `frontend/` | 1–3 |

## Global Constraints

- Python **3.12** only (`requires-python = ">=3.12,<3.13"`, pinned with `uv python pin 3.12`). All backend commands run from `backend/` via `uv run`.
- PostgreSQL 16 + pgvector image `pgvector/pgvector:pg16`, **host port 5433**. Redis 7, host port 6379 (tests use DB 15).
- The app connects as `travelmind_app` (`NOBYPASSRLS`, not table owner). Migrations and reference imports run as `travelmind_owner`.
- Every tenant data table has `agency_id` + RLS enabled **and forced** with policy `tenant_isolation`, created only via `travelmind.db.tenant_rls_statements()`. The only non-RLS tables are identity tables (`agencies`, `users`, `sessions`) and global reference tables (`countries`, `airports`); code outside `travelmind/identity/` must never import `travelmind.identity.models`.
- Tenant context is set only through `travelmind.db.bind_tenant()`; it is transaction-local (`set_config(..., true)`).
- Emails are stored trimmed + lowercased (DB check constraint enforces lowercase).
- User-facing error messages are plain language. Unhandled errors return HTTP 500 `{"detail": "Something went wrong on our side. Please try again.", "trace_id": <request id>}` and never leak internals.
- Session cookie: `tm_session`, httpOnly, SameSite=Lax, `Secure` controlled by `TM_COOKIE_SECURE`.
- All settings come from env vars prefixed `TM_` (see `backend/.env.example`).
- No card data is handled anywhere.
- FastAPI dependencies use the `Annotated[...]` style (no `Depends()` in default values).

## Review Focus

1. **Email typed with different case/whitespace** (`" Owner@Agency.COM "`) must resolve to the same account for signup-duplicate checks and login — pinned in Task 3 `test_email_is_normalized`.
2. **Tenant context leaking across pooled connections or after commit** — a request for tenant A must never see tenant B's rows, and a connection reused after a tenant transaction must carry no tenant — pinned in Task 2 `test_tenant_setting_is_transaction_local` and `test_tenant_context_survives_commit_in_same_session`.
3. **Expired or logged-out session cookies** must yield 401 with a plain message, never 500 or silent access — pinned in Task 3 `test_logout_revokes_session_server_side` and `test_expired_session_is_rejected`.
4. **Invitation links that are reused, expired, forged with another agency's id, or garbage** must be rejected with one plain message — pinned in Task 4 invitation tests.
5. **Ambiguous airport queries**: `"goa"` is Genoa's IATA code but an Indian agent means Goa (GOI/GOX); accented names (`"sao paulo"`) and typos (`"dehli"`) must still resolve — pinned in Task 5 `AirportIndex` tests.

---

### Task 1: Backend skeleton, config, logging, request IDs, error handling

Removes the prototype backend and creates the new `backend/` project with a health endpoint.

**Files:**
- Delete: `src/`, `scripts/`, `tests/` (root), `requirements.txt`, `.env.example` (root), local untracked `venv/` and `data/`
- Create: `backend/pyproject.toml`, `backend/.env.example`, `backend/src/travelmind/__init__.py`, `backend/src/travelmind/config.py`, `backend/src/travelmind/observability.py`, `backend/src/travelmind/middleware.py`, `backend/src/travelmind/health.py`, `backend/src/travelmind/main.py`
- Test: `backend/tests/__init__.py`, `backend/tests/helpers.py`, `backend/tests/conftest.py`, `backend/tests/test_health.py`

**Interfaces:**
- Produces: `travelmind.config.get_settings() -> Settings`; `travelmind.main.create_app() -> FastAPI`; `travelmind.middleware.REQUEST_ID_HEADER = "X-Request-ID"`, `RequestIdMiddleware`, `unhandled_exception_handler`; `tests.helpers.make_client(app, *, raise_app_exceptions=True) -> httpx.AsyncClient`; pytest fixtures `app`, `client`.

- [ ] **Step 1: Remove the prototype backend**

```bash
cd /d/travel-rag-agent
git rm -r -q src scripts requirements.txt .env.example
rm -rf tests venv data
git status --short
```
Expected: deletions listed for `src/`, `scripts/`, `requirements.txt`, `.env.example`. The root `.env` (holds the Gemini key, git-ignored) and `frontend/` stay.

- [ ] **Step 2: Create the uv project**

Create `backend/pyproject.toml`:

```toml
[project]
name = "travelmind"
version = "0.1.0"
description = "TravelMind API — AI copilot for travel agencies and corporate travel"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "pydantic>=2.9",
  "pydantic-settings>=2.6",
  "email-validator>=2.2",
  "sqlalchemy[asyncio]>=2.0.36",
  "asyncpg>=0.30",
  "alembic>=1.14",
  "argon2-cffi>=23.1",
  "redis>=5.2",
  "structlog>=24.4",
  "httpx>=0.28",
  "rapidfuzz>=3.10",
]

[dependency-groups]
dev = ["pytest>=8.3", "pytest-asyncio>=0.24", "ruff>=0.8", "mypy>=1.13"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/travelmind"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "ASYNC"]

[tool.mypy]
python_version = "3.12"
plugins = ["pydantic.mypy"]
ignore_missing_imports = true
```

Create `backend/.env.example`:

```dotenv
TM_ENVIRONMENT=development
TM_DATABASE_URL=postgresql+asyncpg://travelmind_app:app_dev_pw@localhost:5433/travelmind
TM_MIGRATION_DATABASE_URL=postgresql+asyncpg://travelmind_owner:owner_dev_pw@localhost:5433/travelmind
TM_REDIS_URL=redis://localhost:6379/0
TM_ALLOWED_ORIGINS=["http://localhost:5173"]
TM_COOKIE_SECURE=false
TM_LOG_LEVEL=INFO
```

Run:
```bash
cd /d/travel-rag-agent/backend
uv python pin 3.12
mkdir -p src/travelmind tests
touch src/travelmind/__init__.py tests/__init__.py
cp .env.example .env
uv sync
```
Expected: uv downloads Python 3.12 if needed, creates `.venv`, installs deps, and `.python-version` contains `3.12`.

- [ ] **Step 3: Write the failing tests**

Create `backend/tests/helpers.py`:

```python
import httpx
from fastapi import FastAPI


def make_client(app: FastAPI, *, raise_app_exceptions: bool = True) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions)
    return httpx.AsyncClient(transport=transport, base_url="http://test")
```

Create `backend/tests/conftest.py`:

```python
import os

os.environ["TM_ENVIRONMENT"] = "test"

import pytest  # noqa: E402

from tests.helpers import make_client  # noqa: E402


@pytest.fixture
def app():
    from travelmind.main import create_app

    return create_app()


@pytest.fixture
async def client(app):
    async with make_client(app) as c:
        yield c
```

Create `backend/tests/test_health.py`:

```python
from tests.helpers import make_client
from travelmind.main import create_app


async def test_health_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert len(r.headers["X-Request-ID"]) == 32


async def test_request_id_is_echoed(client):
    r = await client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"


async def test_unsafe_request_id_is_replaced(client):
    r = await client.get("/health", headers={"X-Request-ID": "<script>alert(1)</script>"})
    assert r.headers["X-Request-ID"] != "<script>alert(1)</script>"
    assert len(r.headers["X-Request-ID"]) == 32


async def test_unhandled_error_returns_plain_message_with_trace_id():
    app = create_app()

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    async with make_client(app, raise_app_exceptions=False) as c:
        r = await c.get("/boom")

    assert r.status_code == 500
    assert r.json()["detail"] == "Something went wrong on our side. Please try again."
    assert r.json()["trace_id"] == r.headers["X-Request-ID"]
    assert "secret internal detail" not in r.text
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `uv run pytest tests/test_health.py -v`
Expected: FAIL / collection error — `ModuleNotFoundError: No module named 'travelmind.main'`.

- [ ] **Step 5: Implement config, logging, middleware, health, app factory**

Create `backend/src/travelmind/config.py`:

```python
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TM_", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = (
        "postgresql+asyncpg://travelmind_app:app_dev_pw@localhost:5433/travelmind"
    )
    migration_database_url: str = (
        "postgresql+asyncpg://travelmind_owner:owner_dev_pw@localhost:5433/travelmind"
    )
    redis_url: str = "redis://localhost:6379/0"
    allowed_origins: list[str] = ["http://localhost:5173"]
    session_cookie_name: str = "tm_session"
    session_ttl_hours: int = 24 * 14
    invitation_ttl_hours: int = 24 * 7
    cookie_secure: bool = False
    login_max_attempts: int = 10
    login_window_seconds: int = 15 * 60
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

Create `backend/src/travelmind/observability.py`:

```python
import logging

import structlog


def configure_logging(level: str) -> None:
    logging.basicConfig(format="%(message)s", level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
    )
```

Create `backend/src/travelmind/middleware.py`:

```python
import re
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
log = structlog.get_logger()


def _request_id_from(request: Request) -> str:
    supplied = request.headers.get(REQUEST_ID_HEADER, "")
    return supplied if _VALID_REQUEST_ID.fullmatch(supplied) else uuid.uuid4().hex


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = _request_id_from(request)
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or uuid.uuid4().hex
    log.error("unhandled_error", request_id=request_id, exc_info=exc)
    return JSONResponse(
        {
            "detail": "Something went wrong on our side. Please try again.",
            "trace_id": request_id,
        },
        status_code=500,
        headers={REQUEST_ID_HEADER: request_id},
    )
```

Create `backend/src/travelmind/health.py`:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

Create `backend/src/travelmind/main.py`:

```python
from fastapi import FastAPI

from travelmind.config import get_settings
from travelmind.health import router as health_router
from travelmind.middleware import RequestIdMiddleware, unhandled_exception_handler
from travelmind.observability import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="TravelMind API", version="0.1.0")
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.include_router(health_router)
    return app
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_health.py -v`
Expected: 4 passed.

- [ ] **Step 7: Lint and commit**

```bash
uv run ruff check . --fix && uv run ruff format .
cd /d/travel-rag-agent
git add -A backend
git commit -m "feat(backend): new FastAPI skeleton with request IDs and safe 500s; remove prototype backend"
```

---

### Task 2: Postgres, Redis, migrations, tenant-scoped sessions with RLS

**Files:**
- Create: `docker-compose.yml`, `infra/postgres/init.sql`, `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/script.py.mako`, `backend/migrations/versions/0001_identity.py`, `backend/src/travelmind/db.py`, `backend/src/travelmind/identity/__init__.py`, `backend/src/travelmind/identity/models.py`, `backend/src/travelmind/audit/__init__.py`, `backend/src/travelmind/audit/models.py`
- Modify: `backend/src/travelmind/health.py` (DB check), `backend/tests/conftest.py` (DB fixtures), `backend/tests/test_health.py`
- Test: `backend/tests/db/__init__.py`, `backend/tests/db/test_tenant_isolation.py`

**Interfaces:**
- Consumes: `get_settings()` (Task 1).
- Produces:
  - `travelmind.db.Base` (DeclarativeBase), `utcnow() -> datetime`
  - `travelmind.db.get_engine() -> AsyncEngine`, `get_sessionmaker() -> async_sessionmaker[AsyncSession]`
  - `travelmind.db.get_db() -> AsyncIterator[AsyncSession]` and `DbSession = Annotated[AsyncSession, Depends(get_db)]`
  - `travelmind.db.bind_tenant(session: AsyncSession, agency_id: UUID) -> None`
  - `travelmind.db.tenant_rls_statements(table: str) -> list[str]`
  - Models: `identity.models.Agency(id, name, created_at)`, `User(id, agency_id, email, full_name, password_hash, role, is_active, created_at)`, `UserSession(id, user_id, token_hash, created_at, expires_at, revoked_at, user_agent, ip_address)`, `Invitation(id, agency_id, email, role, token_hash, invited_by_user_id, created_at, expires_at, accepted_at)`; `audit.models.AuditEvent(id, agency_id, actor_user_id, action, entity_type, entity_id, before, after, created_at)`
  - Test fixtures: session-wide `migrated_database`, per-test `clean_database` (truncates every public table).

- [ ] **Step 1: Add Docker services**

Create `infra/postgres/init.sql`:

```sql
-- Runs once, as the postgres superuser, when the data volume is first created.
-- Reset with: docker compose down -v
CREATE ROLE travelmind_owner LOGIN PASSWORD 'owner_dev_pw';
CREATE ROLE travelmind_app LOGIN PASSWORD 'app_dev_pw' NOBYPASSRLS;

CREATE DATABASE travelmind OWNER travelmind_owner;
CREATE DATABASE travelmind_test OWNER travelmind_owner;

\connect travelmind
CREATE EXTENSION IF NOT EXISTS vector;
GRANT USAGE ON SCHEMA public TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO travelmind_app;

\connect travelmind_test
CREATE EXTENSION IF NOT EXISTS vector;
GRANT USAGE ON SCHEMA public TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO travelmind_app;
```

Create `docker-compose.yml` (repo root):

```yaml
name: travelmind
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  pgdata:
```

Run:
```bash
cd /d/travel-rag-agent
docker compose up -d --wait
docker compose exec postgres psql -U postgres -c "\du"
```
Expected: both containers healthy; roles `travelmind_owner` and `travelmind_app` listed, `travelmind_app` without Superuser/Bypass RLS.

- [ ] **Step 2: Write the failing tests**

Replace `backend/tests/conftest.py`:

```python
import os

os.environ["TM_ENVIRONMENT"] = "test"
os.environ["TM_DATABASE_URL"] = os.environ.get(
    "TM_TEST_DATABASE_URL",
    "postgresql+asyncpg://travelmind_app:app_dev_pw@localhost:5433/travelmind_test",
)
os.environ["TM_MIGRATION_DATABASE_URL"] = os.environ.get(
    "TM_TEST_MIGRATION_DATABASE_URL",
    "postgresql+asyncpg://travelmind_owner:owner_dev_pw@localhost:5433/travelmind_test",
)
os.environ["TM_REDIS_URL"] = os.environ.get("TM_TEST_REDIS_URL", "redis://localhost:6379/15")

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from tests.helpers import make_client  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", os.environ["TM_MIGRATION_DATABASE_URL"])
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
async def clean_database():
    yield
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    async with engine.begin() as conn:
        tables = (
            await conn.execute(
                text(
                    "SELECT tablename FROM pg_tables "
                    "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
                )
            )
        ).scalars().all()
        if tables:
            await conn.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
    await engine.dispose()


@pytest.fixture
def app():
    from travelmind.main import create_app

    return create_app()


@pytest.fixture
async def client(app):
    async with make_client(app) as c:
        yield c
```

Replace `backend/tests/test_health.py`:

```python
from tests.helpers import make_client
from travelmind.db import get_db
from travelmind.main import create_app


async def test_health_reports_database_ok(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}
    assert len(r.headers["X-Request-ID"]) == 32


async def test_health_reports_degraded_when_database_down(app, client):
    class BrokenSession:
        async def execute(self, *args, **kwargs):
            raise ConnectionRefusedError("database is down")

    async def broken_db():
        yield BrokenSession()

    app.dependency_overrides[get_db] = broken_db
    r = await client.get("/health")
    assert r.status_code == 503
    assert r.json() == {"status": "degraded", "database": "unavailable"}


async def test_request_id_is_echoed(client):
    r = await client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"


async def test_unsafe_request_id_is_replaced(client):
    r = await client.get("/health", headers={"X-Request-ID": "<script>alert(1)</script>"})
    assert r.headers["X-Request-ID"] != "<script>alert(1)</script>"
    assert len(r.headers["X-Request-ID"]) == 32


async def test_unhandled_error_returns_plain_message_with_trace_id():
    app = create_app()

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    async with make_client(app, raise_app_exceptions=False) as c:
        r = await c.get("/boom")

    assert r.status_code == 500
    assert r.json()["detail"] == "Something went wrong on our side. Please try again."
    assert r.json()["trace_id"] == r.headers["X-Request-ID"]
    assert "secret internal detail" not in r.text
```

Create `backend/tests/db/__init__.py` (empty) and `backend/tests/db/test_tenant_isolation.py`:

```python
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from travelmind.audit.models import AuditEvent
from travelmind.db import bind_tenant, get_sessionmaker
from travelmind.identity.models import Agency, Invitation, User


async def _seed_agency(name: str) -> tuple[Agency, User]:
    slug = name.lower()
    async with get_sessionmaker()() as db:
        agency = Agency(id=uuid4(), name=name)
        db.add(agency)
        await db.flush()
        owner = User(
            id=uuid4(),
            agency_id=agency.id,
            email=f"owner@{slug}.com",
            full_name=f"{name} Owner",
            password_hash="not-a-real-hash",
            role="owner",
        )
        db.add(owner)
        await db.flush()
        await bind_tenant(db, agency.id)
        db.add(
            Invitation(
                agency_id=agency.id,
                email=f"agent@{slug}.com",
                role="agent",
                token_hash=uuid4().hex,
                invited_by_user_id=owner.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await db.commit()
        return agency, owner


async def test_tenant_sees_only_own_rows():
    alpha, _ = await _seed_agency("Alpha")
    await _seed_agency("Beta")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        emails = (await db.scalars(select(Invitation.email))).all()
    assert emails == ["agent@alpha.com"]


async def test_no_tenant_context_sees_nothing():
    await _seed_agency("Alpha")
    async with get_sessionmaker()() as db:
        assert (await db.scalars(select(Invitation))).all() == []


async def test_cannot_write_rows_for_another_tenant():
    alpha, _ = await _seed_agency("Alpha")
    beta, beta_owner = await _seed_agency("Beta")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        db.add(
            Invitation(
                agency_id=beta.id,
                email="sneaky@beta.com",
                role="agent",
                token_hash=uuid4().hex,
                invited_by_user_id=beta_owner.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        with pytest.raises(DBAPIError, match="row-level security"):
            await db.flush()


async def test_tenant_context_survives_commit_in_same_session():
    alpha, _ = await _seed_agency("Alpha")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        first = (await db.scalars(select(Invitation.email))).all()
        await db.commit()
        second = (await db.scalars(select(Invitation.email))).all()
    assert first == second == ["agent@alpha.com"]


async def test_tenant_setting_is_transaction_local():
    alpha, _ = await _seed_agency("Alpha")
    engine = create_async_engine(os.environ["TM_DATABASE_URL"], poolclass=NullPool)
    async with engine.connect() as conn:
        async with conn.begin():
            await conn.execute(
                text("SELECT set_config('app.agency_id', :aid, true)"), {"aid": str(alpha.id)}
            )
        async with conn.begin():
            leftover = await conn.scalar(text("SELECT current_setting('app.agency_id', true)"))
            visible = (await conn.execute(text("SELECT count(*) FROM invitations"))).scalar()
    await engine.dispose()
    assert leftover in ("", None)
    assert visible == 0


async def test_audit_log_is_append_only():
    alpha, owner = await _seed_agency("Alpha")
    async with get_sessionmaker()() as db:
        await bind_tenant(db, alpha.id)
        db.add(
            AuditEvent(
                agency_id=alpha.id,
                actor_user_id=owner.id,
                action="test.event",
                entity_type="test",
                entity_id="1",
            )
        )
        await db.commit()
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(update(AuditEvent).values(action="tampered"))
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest -v`
Expected: FAIL — `alembic.ini` not found / `ModuleNotFoundError: No module named 'travelmind.db'`.

- [ ] **Step 4: Implement the database layer**

Create `backend/src/travelmind/db.py`:

```python
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import NullPool

from travelmind.config import get_settings

TENANT_SETTING = "app.agency_id"
_SET_TENANT_SQL = text("SELECT set_config(:key, :agency_id, true)")


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


class TenantSession(Session):
    """Sync session class; every transaction it begins carries the bound tenant for RLS."""


@event.listens_for(TenantSession, "after_begin")
def _apply_tenant(session, transaction, connection):  # type: ignore[no-untyped-def]
    agency_id = session.info.get("agency_id")
    if agency_id is not None:
        connection.execute(_SET_TENANT_SQL, {"key": TENANT_SETTING, "agency_id": str(agency_id)})


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    kwargs: dict[str, Any] = (
        {"poolclass": NullPool} if settings.environment == "test" else {"pool_pre_ping": True}
    )
    return create_async_engine(settings.database_url, **kwargs)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        get_engine(), expire_on_commit=False, sync_session_class=TenantSession
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


async def bind_tenant(session: AsyncSession, agency_id: UUID) -> None:
    """Scope this session to one agency. Applies now and to every later transaction."""
    session.info["agency_id"] = agency_id
    if session.in_transaction():
        await session.execute(
            _SET_TENANT_SQL, {"key": TENANT_SETTING, "agency_id": str(agency_id)}
        )


def tenant_rls_statements(table: str) -> list[str]:
    """SQL that enables and forces the standard tenant-isolation policy on a table."""
    condition = f"agency_id = NULLIF(current_setting('{TENANT_SETTING}', true), '')::uuid"
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        f"CREATE POLICY tenant_isolation ON {table} USING ({condition}) WITH CHECK ({condition})",
    ]
```

Create `backend/src/travelmind/identity/__init__.py` and `backend/src/travelmind/audit/__init__.py` (both empty).

Create `backend/src/travelmind/identity/models.py`:

```python
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base, utcnow


class Agency(Base):
    __tablename__ = "agencies"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    ip_address: Mapped[str | None] = mapped_column(String(64))


class Invitation(Base):
    """Tenant data (RLS). Lives in identity because only identity may create users from it."""

    __tablename__ = "invitations"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(String(20))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    invited_by_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

Create `backend/src/travelmind/audit/models.py`:

```python
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base, utcnow


class AuditEvent(Base):
    __tablename__ = "audit_log"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    agency_id: Mapped[UUID] = mapped_column(ForeignKey("agencies.id", ondelete="CASCADE"))
    actor_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(64))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
```

- [ ] **Step 5: Set up Alembic and the first migration**

Create `backend/alembic.ini`:

```ini
[alembic]
script_location = %(here)s/migrations
prepend_sys_path = .
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARNING
handlers = console
qualname =

[logger_sqlalchemy]
level = WARNING
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

Create `backend/migrations/env.py`:

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

import travelmind.audit.models  # noqa: F401  (register tables)
import travelmind.identity.models  # noqa: F401
from travelmind.config import get_settings
from travelmind.db import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or get_settings().migration_database_url


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = create_async_engine(_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(_run_async())
```

Create `backend/migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

Create `backend/migrations/versions/0001_identity.py`:

```python
"""identity tables, invitations and audit log with tenant RLS

Revision ID: 0001_identity
Revises:
Create Date: 2026-09-29
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from travelmind.db import tenant_rls_statements

revision: str = "0001_identity"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "agencies",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        _created_at(),
    )
    op.create_table(
        "users",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("full_name", sa.String(200), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        _created_at(),
        sa.CheckConstraint("role IN ('owner', 'admin', 'agent')", name="ck_users_role"),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lower"),
    )
    op.create_index("ix_users_agency_id", "users", ["agency_id"])
    op.create_table(
        "sessions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table(
        "invitations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "invited_by_user_id",
            UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('admin', 'agent')", name="ck_invitations_role"),
    )
    op.create_index("ix_invitations_agency_id", "invitations", ["agency_id"])
    op.create_table(
        "audit_log",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "agency_id", UUID, sa.ForeignKey("agencies.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "actor_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("before", postgresql.JSONB, nullable=True),
        sa.Column("after", postgresql.JSONB, nullable=True),
        _created_at(),
    )
    op.create_index("ix_audit_log_agency_created", "audit_log", ["agency_id", "created_at"])

    for table in ("invitations", "audit_log"):
        for statement in tenant_rls_statements(table):
            op.execute(statement)
    op.execute("REVOKE UPDATE, DELETE ON audit_log FROM travelmind_app")


def downgrade() -> None:
    for table in ("audit_log", "invitations", "sessions", "users", "agencies"):
        op.drop_table(table)
```

- [ ] **Step 6: Add the database check to /health**

Replace `backend/src/travelmind/health.py`:

```python
import structlog
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from travelmind.db import DbSession

router = APIRouter()
log = structlog.get_logger()


@router.get("/health")
async def health(db: DbSession) -> JSONResponse:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        log.warning("health_database_unavailable", error=str(exc))
        return JSONResponse({"status": "degraded", "database": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ok", "database": "ok"})
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && uv run pytest -v`
Expected: all tests in `tests/test_health.py` and `tests/db/test_tenant_isolation.py` pass (11 passed).

- [ ] **Step 8: Apply migrations to the dev database and commit**

```bash
cd /d/travel-rag-agent/backend
uv run alembic upgrade head
uv run ruff check . --fix && uv run ruff format .
cd ..
git add -A docker-compose.yml infra backend
git commit -m "feat(db): Postgres with forced tenant RLS, identity/audit schema, Alembic migrations"
```

---

### Task 3: Signup, login, logout, sessions, current user

**Files:**
- Create: `backend/src/travelmind/identity/passwords.py`, `identity/tokens.py`, `identity/schemas.py`, `identity/service.py`, `identity/cookies.py`, `identity/deps.py`, `identity/router.py`, `backend/src/travelmind/audit/service.py`
- Modify: `backend/src/travelmind/main.py` (include auth router), `backend/tests/helpers.py` (auth + SQL helpers)
- Test: `backend/tests/identity/__init__.py`, `backend/tests/identity/test_passwords_tokens.py`, `backend/tests/identity/test_auth.py`

**Interfaces:**
- Consumes: `DbSession`, `bind_tenant`, `get_settings`, models from Task 2.
- Produces:
  - `travelmind.audit.service.record_event(db, *, agency_id: UUID, actor_user_id: UUID | None, action: str, entity_type: str, entity_id: str, before: dict | None = None, after: dict | None = None) -> None`
  - `travelmind.identity.tokens.new_token() -> str`, `hash_token(token: str) -> str`, `make_scoped_token(agency_id: UUID) -> tuple[str, str]` (returns `(token, secret)`), `split_scoped_token(token: str) -> tuple[UUID, str] | None`
  - `travelmind.identity.passwords.hash_password(password: str) -> str`, `verify_password(password_hash: str, password: str) -> bool`
  - `travelmind.identity.service`: `SessionContext(user_agent: str | None, ip_address: str | None)`, `start_session(db, user, ctx) -> str`, `signup(db, *, agency_name, full_name, email, password, ctx) -> tuple[User, Agency, str]`, `login(db, *, email, password, ctx) -> tuple[User, Agency, str]`, `get_user_for_session_token(db, token) -> User | None`, `revoke_session(db, token) -> None`, `get_user_and_agency(db, user_id) -> tuple[User, Agency]`, `list_team(db, agency_id) -> list[User]`; exceptions `EmailAlreadyRegistered`, `InvalidCredentials`
  - `travelmind.identity.deps.CurrentUser(id, agency_id, email, full_name, role)`, `get_current_user`, `AuthedUser = Annotated[CurrentUser, Depends(get_current_user)]`, `require_role(*roles) -> dependency`, `session_context(request) -> SessionContext`
  - `travelmind.identity.cookies.set_session_cookie(response, token)`, `clear_session_cookie(response)`
  - `travelmind.identity.schemas`: `NormalizedEmail`, `SignupRequest`, `LoginRequest`, `UserOut`, `AgencyOut`, `MeResponse`
  - `travelmind.identity.router.auth_router` (prefix `/api/v1/auth`), `me_response(user, agency) -> MeResponse`
  - HTTP: `POST /api/v1/auth/signup` → 201 `MeResponse` + cookie; `POST /api/v1/auth/login` → 200 `MeResponse` + cookie; `POST /api/v1/auth/logout` → 204; `GET /api/v1/auth/me` → 200 `MeResponse`
  - Test helpers: `DEFAULT_PASSWORD`, `signup(client, **overrides)`, `run_as_owner(sql, params=None)`, `exec_as_tenant(agency_id, sql, params=None) -> list[tuple]`

- [ ] **Step 1: Write the failing unit tests**

Create `backend/tests/identity/__init__.py` (empty) and `backend/tests/identity/test_passwords_tokens.py`:

```python
from uuid import uuid4

from travelmind.identity.passwords import hash_password, verify_password
from travelmind.identity.tokens import hash_token, make_scoped_token, new_token, split_scoped_token


def test_password_hash_roundtrip():
    hashed = hash_password("correct-horse-battery")
    assert hashed != "correct-horse-battery"
    assert verify_password(hashed, "correct-horse-battery")
    assert not verify_password(hashed, "wrong-password-123")


def test_verify_password_with_garbage_hash_is_false():
    assert not verify_password("not-an-argon2-hash", "anything")


def test_tokens_are_random_and_hashed():
    a, b = new_token(), new_token()
    assert a != b and len(a) >= 40
    assert hash_token(a) == hash_token(a)
    assert hash_token(a) != a and len(hash_token(a)) == 64


def test_scoped_token_roundtrip():
    agency_id = uuid4()
    token, secret = make_scoped_token(agency_id)
    assert split_scoped_token(token) == (agency_id, secret)


def test_split_scoped_token_rejects_garbage():
    assert split_scoped_token("no-dot-here") is None
    assert split_scoped_token("not-a-uuid.secret") is None
    assert split_scoped_token(f"{uuid4()}.") is None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/identity/test_passwords_tokens.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'travelmind.identity.passwords'`.

- [ ] **Step 3: Implement passwords and tokens**

Create `backend/src/travelmind/identity/passwords.py`:

```python
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False
```

Create `backend/src/travelmind/identity/tokens.py`:

```python
import hashlib
import secrets
from uuid import UUID


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def make_scoped_token(agency_id: UUID) -> tuple[str, str]:
    """Token of the form '<agency_id>.<secret>'. Only the secret's hash is stored.

    The agency id lets us set the tenant before looking the token up under RLS;
    tampering with it just makes the lookup miss.
    """
    secret = new_token()
    return f"{agency_id}.{secret}", secret


def split_scoped_token(token: str) -> tuple[UUID, str] | None:
    prefix, sep, secret = token.partition(".")
    if not sep or not secret:
        return None
    try:
        return UUID(prefix), secret
    except ValueError:
        return None
```

Run: `uv run pytest tests/identity/test_passwords_tokens.py -v`
Expected: 5 passed.

- [ ] **Step 4: Write the failing API tests**

Replace `backend/tests/helpers.py`:

```python
import os
from typing import Any
from uuid import UUID

import httpx
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

DEFAULT_PASSWORD = "correct-horse-battery"


def make_client(app: FastAPI, *, raise_app_exceptions: bool = True) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def signup(
    client: httpx.AsyncClient,
    *,
    email: str = "owner@alphatravels.com",
    agency_name: str = "Alpha Travels",
    full_name: str = "Asha Owner",
    password: str = DEFAULT_PASSWORD,
) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/signup",
        json={
            "agency_name": agency_name,
            "full_name": full_name,
            "email": email,
            "password": password,
        },
    )


async def run_as_owner(sql: str, params: dict[str, Any] | None = None) -> None:
    """Run SQL as the table owner (for identity tables, which have no RLS)."""
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.execute(text(sql), params or {})
    await engine.dispose()


async def exec_as_tenant(
    agency_id: UUID | str, sql: str, params: dict[str, Any] | None = None
) -> list[tuple[Any, ...]]:
    """Run SQL as the app role inside one tenant's RLS context."""
    engine = create_async_engine(os.environ["TM_DATABASE_URL"], poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT set_config('app.agency_id', :aid, true)"), {"aid": str(agency_id)}
        )
        result = await conn.execute(text(sql), params or {})
        rows = [tuple(row) for row in result] if result.returns_rows else []
    await engine.dispose()
    return rows
```

Create `backend/tests/identity/test_auth.py`:

```python
from tests.helpers import DEFAULT_PASSWORD, exec_as_tenant, make_client, run_as_owner, signup

LOGIN = "/api/v1/auth/login"
SESSION_COOKIE = "tm_session"


async def test_signup_creates_agency_owner_and_session(client):
    r = await signup(client)
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["email"] == "owner@alphatravels.com"
    assert body["user"]["role"] == "owner"
    assert body["agency"]["name"] == "Alpha Travels"
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json() == body


async def test_session_cookie_is_httponly_and_lax(client):
    r = await signup(client)
    set_cookie = r.headers["set-cookie"].lower()
    assert set_cookie.startswith(f"{SESSION_COOKIE}=")
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


async def test_email_is_normalized(client, app):
    r = await signup(client, email="  Owner@AlphaTravels.COM ")
    assert r.status_code == 201
    assert r.json()["user"]["email"] == "owner@alphatravels.com"
    async with make_client(app) as other:
        duplicate = await signup(other, email="OWNER@alphatravels.com", agency_name="Copycat")
        assert duplicate.status_code == 409
        assert duplicate.json() == {"detail": "An account with this email already exists."}
        login = await other.post(
            LOGIN, json={"email": "owner@ALPHATRAVELS.com", "password": DEFAULT_PASSWORD}
        )
        assert login.status_code == 200


async def test_short_password_is_rejected(client):
    r = await signup(client, password="short")
    assert r.status_code == 422


async def test_login_failures_are_generic(client, app):
    await signup(client)
    async with make_client(app) as anon:
        wrong = await anon.post(
            LOGIN, json={"email": "owner@alphatravels.com", "password": "wrong-password-123"}
        )
        unknown = await anon.post(
            LOGIN, json={"email": "nobody@alphatravels.com", "password": "wrong-password-123"}
        )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid email or password."}


async def test_me_requires_session(client):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "Please sign in."}


async def test_logout_revokes_session_server_side(client, app):
    await signup(client)
    token = client.cookies.get(SESSION_COOKIE)
    out = await client.post("/api/v1/auth/logout")
    assert out.status_code == 204
    async with make_client(app) as replay:
        r = await replay.get("/api/v1/auth/me", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    assert r.status_code == 401


async def test_expired_session_is_rejected(client):
    await signup(client)
    await run_as_owner("UPDATE sessions SET expires_at = now() - interval '1 minute'")
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "Your session has expired. Please sign in again."}


async def test_signup_and_login_are_audited(client, app):
    body = (await signup(client)).json()
    async with make_client(app) as again:
        await again.post(
            LOGIN, json={"email": "owner@alphatravels.com", "password": DEFAULT_PASSWORD}
        )
    rows = await exec_as_tenant(
        body["agency"]["id"], "SELECT action FROM audit_log ORDER BY created_at"
    )
    assert [row[0] for row in rows] == ["agency.created", "auth.login"]
```

- [ ] **Step 5: Run to verify they fail**

Run: `uv run pytest tests/identity/test_auth.py -v`
Expected: FAIL — 404 Not Found on `/api/v1/auth/signup` (route doesn't exist).

- [ ] **Step 6: Implement audit service, schemas, service, cookies, deps, router**

Create `backend/src/travelmind/audit/service.py`:

```python
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.audit.models import AuditEvent


async def record_event(
    db: AsyncSession,
    *,
    agency_id: UUID,
    actor_user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """Append an audit event. The session must already be bound to `agency_id`."""
    db.add(
        AuditEvent(
            agency_id=agency_id,
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before=before,
            after=after,
        )
    )
    await db.flush()
```

Create `backend/src/travelmind/identity/schemas.py`:

```python
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, EmailStr, StringConstraints


def _normalize_email(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


NormalizedEmail = Annotated[EmailStr, BeforeValidator(_normalize_email)]
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
AgencyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]
NewPassword = Annotated[str, StringConstraints(min_length=10, max_length=256)]


class SignupRequest(BaseModel):
    agency_name: AgencyName
    full_name: PersonName
    email: NormalizedEmail
    password: NewPassword


class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: Annotated[str, StringConstraints(max_length=256)]


class UserOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str


class AgencyOut(BaseModel):
    id: UUID
    name: str


class MeResponse(BaseModel):
    user: UserOut
    agency: AgencyOut
```

Create `backend/src/travelmind/identity/service.py`:

```python
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.audit.service import record_event
from travelmind.config import get_settings
from travelmind.db import bind_tenant
from travelmind.identity.models import Agency, User, UserSession
from travelmind.identity.passwords import hash_password, verify_password
from travelmind.identity.tokens import hash_token, new_token

# Verified against when the email is unknown, so response time doesn't reveal which emails exist.
_TIMING_DUMMY_HASH = hash_password("timing-equalizer-not-a-real-password")


class EmailAlreadyRegistered(Exception):
    pass


class InvalidCredentials(Exception):
    pass


@dataclass(frozen=True)
class SessionContext:
    user_agent: str | None
    ip_address: str | None


def start_session(db: AsyncSession, user: User, ctx: SessionContext) -> str:
    token = new_token()
    ttl = timedelta(hours=get_settings().session_ttl_hours)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + ttl,
            user_agent=ctx.user_agent[:500] if ctx.user_agent else None,
            ip_address=ctx.ip_address,
        )
    )
    return token


async def signup(
    db: AsyncSession,
    *,
    agency_name: str,
    full_name: str,
    email: str,
    password: str,
    ctx: SessionContext,
) -> tuple[User, Agency, str]:
    if await db.scalar(select(User.id).where(User.email == email)) is not None:
        raise EmailAlreadyRegistered
    agency = Agency(id=uuid4(), name=agency_name)
    user = User(
        id=uuid4(),
        agency_id=agency.id,
        email=email,
        full_name=full_name,
        password_hash=hash_password(password),
        role="owner",
    )
    try:
        db.add(agency)
        await db.flush()
        db.add(user)
        await db.flush()
    except IntegrityError as exc:  # concurrent signup with the same email
        await db.rollback()
        raise EmailAlreadyRegistered from exc
    await bind_tenant(db, agency.id)
    await record_event(
        db,
        agency_id=agency.id,
        actor_user_id=user.id,
        action="agency.created",
        entity_type="agency",
        entity_id=str(agency.id),
        after={"name": agency.name},
    )
    token = start_session(db, user, ctx)
    await db.commit()
    return user, agency, token


async def login(
    db: AsyncSession, *, email: str, password: str, ctx: SessionContext
) -> tuple[User, Agency, str]:
    user = await db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        verify_password(_TIMING_DUMMY_HASH, password)
        raise InvalidCredentials
    if not verify_password(user.password_hash, password):
        raise InvalidCredentials
    agency = await db.get_one(Agency, user.agency_id)
    await bind_tenant(db, user.agency_id)
    await record_event(
        db,
        agency_id=user.agency_id,
        actor_user_id=user.id,
        action="auth.login",
        entity_type="user",
        entity_id=str(user.id),
    )
    token = start_session(db, user, ctx)
    await db.commit()
    return user, agency, token


async def get_user_for_session_token(db: AsyncSession, token: str) -> User | None:
    return await db.scalar(
        select(User)
        .join(UserSession, UserSession.user_id == User.id)
        .where(
            UserSession.token_hash == hash_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(UTC),
            User.is_active.is_(True),
        )
    )


async def revoke_session(db: AsyncSession, token: str) -> None:
    await db.execute(
        update(UserSession)
        .where(UserSession.token_hash == hash_token(token), UserSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()


async def get_user_and_agency(db: AsyncSession, user_id: UUID) -> tuple[User, Agency]:
    user = await db.get_one(User, user_id)
    agency = await db.get_one(Agency, user.agency_id)
    return user, agency


async def list_team(db: AsyncSession, agency_id: UUID) -> list[User]:
    # `users` has no RLS, so the agency filter here is the isolation boundary.
    result = await db.scalars(
        select(User).where(User.agency_id == agency_id).order_by(User.created_at, User.email)
    )
    return list(result.all())
```

Create `backend/src/travelmind/identity/cookies.py`:

```python
from starlette.responses import Response

from travelmind.config import get_settings


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
```

Create `backend/src/travelmind/identity/deps.py`:

```python
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status

from travelmind.config import get_settings
from travelmind.db import DbSession, bind_tenant
from travelmind.identity import service


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    agency_id: UUID
    email: str
    full_name: str
    role: str


async def get_current_user(request: Request, db: DbSession) -> CurrentUser:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")
    user = await service.get_user_for_session_token(db, token)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again."
        )
    await bind_tenant(db, user.agency_id)
    return CurrentUser(
        id=user.id,
        agency_id=user.agency_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
    )


AuthedUser = Annotated[CurrentUser, Depends(get_current_user)]


def require_role(*roles: str) -> Callable[..., Awaitable[CurrentUser]]:
    async def _require(user: AuthedUser) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to do that.")
        return user

    return _require


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def session_context(request: Request) -> service.SessionContext:
    return service.SessionContext(
        user_agent=request.headers.get("user-agent"), ip_address=client_ip(request)
    )
```

Create `backend/src/travelmind/identity/router.py`:

```python
from fastapi import APIRouter, HTTPException, Request, Response, status

from travelmind.config import get_settings
from travelmind.db import DbSession
from travelmind.identity import service
from travelmind.identity.cookies import clear_session_cookie, set_session_cookie
from travelmind.identity.deps import AuthedUser, session_context
from travelmind.identity.models import Agency, User
from travelmind.identity.schemas import (
    AgencyOut,
    LoginRequest,
    MeResponse,
    SignupRequest,
    UserOut,
)

auth_router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def me_response(user: User, agency: Agency) -> MeResponse:
    return MeResponse(
        user=UserOut(id=user.id, email=user.email, full_name=user.full_name, role=user.role),
        agency=AgencyOut(id=agency.id, name=agency.name),
    )


@auth_router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup_route(
    body: SignupRequest, request: Request, response: Response, db: DbSession
) -> MeResponse:
    try:
        user, agency, token = await service.signup(
            db,
            agency_name=body.agency_name,
            full_name=body.full_name,
            email=body.email,
            password=body.password,
            ctx=session_context(request),
        )
    except service.EmailAlreadyRegistered:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An account with this email already exists."
        ) from None
    set_session_cookie(response, token)
    return me_response(user, agency)


@auth_router.post("/login")
async def login_route(
    body: LoginRequest, request: Request, response: Response, db: DbSession
) -> MeResponse:
    try:
        user, agency, token = await service.login(
            db, email=body.email, password=body.password, ctx=session_context(request)
        )
    except service.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.") from None
    set_session_cookie(response, token)
    return me_response(user, agency)


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_route(request: Request, db: DbSession) -> Response:
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        await service.revoke_session(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response)
    return response


@auth_router.get("/me")
async def me_route(current: AuthedUser, db: DbSession) -> MeResponse:
    user, agency = await service.get_user_and_agency(db, current.id)
    return me_response(user, agency)
```

Modify `backend/src/travelmind/main.py` — add the import and include the router after `health_router`:

```python
from travelmind.identity.router import auth_router
```
```python
    app.include_router(auth_router)
```

- [ ] **Step 7: Run all tests**

Run: `uv run pytest -v`
Expected: all pass (Task 1–3 tests).

- [ ] **Step 8: Commit**

```bash
uv run ruff check . --fix && uv run ruff format .
cd .. && git add -A backend
git commit -m "feat(identity): agency signup, login/logout, revocable cookie sessions, audit events"
```

---

### Task 4: Security middleware, login rate limiting, invitations, team list

**Files:**
- Create: `backend/src/travelmind/cache.py`, `backend/src/travelmind/identity/ratelimit.py`, `backend/src/travelmind/identity/invitations.py`
- Modify: `backend/src/travelmind/middleware.py` (origin check), `backend/src/travelmind/identity/schemas.py` (invitation/team schemas), `backend/src/travelmind/identity/router.py` (rate-limited login; invitations + team routers), `backend/src/travelmind/main.py` (CORS, origin check, routers), `backend/tests/conftest.py` (Redis cleanup)
- Test: `backend/tests/identity/test_security.py`, `backend/tests/identity/test_invitations.py`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces:
  - `travelmind.cache.get_redis()` dependency and `RedisClient = Annotated[Redis, Depends(get_redis)]`
  - `travelmind.identity.ratelimit.LoginRateLimiter(redis, max_attempts, window_seconds)` with `async hit(key) -> bool`, `async reset(key) -> None`
  - `travelmind.middleware.OriginCheckMiddleware(app, allowed_origins: list[str])`
  - `travelmind.identity.invitations`: `create_invitation(db, *, agency_id, invited_by_user_id, email, role) -> tuple[Invitation, str]`, `list_pending_invitations(db, agency_id) -> list[Invitation]`, `accept_invitation(db, *, token, full_name, password, ctx) -> tuple[User, Agency, str]`; exceptions `InvitationConflict`, `InvalidInvitation`; constant `INVALID_INVITATION_MESSAGE`
  - HTTP: `POST /api/v1/invitations` (owner/admin) → 201 `{id, email, role, created_at, expires_at, token}`; `GET /api/v1/invitations` (owner/admin) → pending list without tokens; `POST /api/v1/invitations/accept` → 201 `MeResponse` + cookie; `GET /api/v1/team` → `[{id, email, full_name, role}]`

- [ ] **Step 1: Add Redis cleanup to test fixtures**

Add to `backend/tests/conftest.py` (imports at the top with the other `# noqa: E402` imports, fixture at the bottom):

```python
from redis.asyncio import Redis  # noqa: E402
```
```python
@pytest.fixture(autouse=True)
async def clean_redis():
    client = Redis.from_url(os.environ["TM_REDIS_URL"])
    await client.flushdb()
    await client.aclose()
    yield
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/identity/test_security.py`:

```python
from tests.helpers import signup

LOGIN = "/api/v1/auth/login"
WRONG = {"email": "owner@alphatravels.com", "password": "wrong-password-123"}


async def test_cross_site_post_is_blocked(client):
    r = await client.post(LOGIN, json=WRONG, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert r.json() == {"detail": "Cross-site request blocked."}


async def test_same_site_post_is_allowed(client):
    await signup(client)
    r = await client.post(LOGIN, json=WRONG, headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 401


async def test_cors_preflight_allows_frontend_origin(client):
    r = await client.options(
        LOGIN,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert r.headers["access-control-allow-credentials"] == "true"


async def test_login_is_rate_limited_per_email(client):
    await signup(client)
    for _ in range(10):
        r = await client.post(LOGIN, json=WRONG)
        assert r.status_code == 401
    blocked = await client.post(LOGIN, json=WRONG)
    assert blocked.status_code == 429
    assert "Too many sign-in attempts" in blocked.json()["detail"]
    other = await client.post(
        LOGIN, json={"email": "someone@else.com", "password": "wrong-password-123"}
    )
    assert other.status_code == 401
```

Create `backend/tests/identity/test_invitations.py`:

```python
from tests.helpers import DEFAULT_PASSWORD, exec_as_tenant, make_client, signup

INVITE = "/api/v1/invitations"
ACCEPT = "/api/v1/invitations/accept"
INVALID = {"detail": "This invitation link is invalid or has expired."}


async def _invite(client, email="agent@alphatravels.com", role="agent"):
    return await client.post(INVITE, json={"email": email, "role": role})


async def _accept(client, token, full_name="Ravi Agent"):
    return await client.post(
        ACCEPT, json={"token": token, "full_name": full_name, "password": DEFAULT_PASSWORD}
    )


async def test_owner_invites_agent_who_joins_same_agency(client, app):
    owner = (await signup(client)).json()
    invite = await _invite(client)
    assert invite.status_code == 201
    assert invite.json()["email"] == "agent@alphatravels.com"
    async with make_client(app) as invitee:
        joined = await _accept(invitee, invite.json()["token"])
        assert joined.status_code == 201
        assert joined.json()["user"]["role"] == "agent"
        assert joined.json()["agency"]["id"] == owner["agency"]["id"]
        assert (await invitee.get("/api/v1/auth/me")).status_code == 200
    team = await client.get("/api/v1/team")
    assert {m["email"] for m in team.json()} == {
        "owner@alphatravels.com",
        "agent@alphatravels.com",
    }


async def test_agent_cannot_invite(client, app):
    await signup(client)
    token = (await _invite(client)).json()["token"]
    async with make_client(app) as agent:
        await _accept(agent, token)
        r = await _invite(agent, email="another@alphatravels.com")
    assert r.status_code == 403


async def test_owner_role_cannot_be_invited(client):
    await signup(client)
    r = await _invite(client, role="owner")
    assert r.status_code == 422


async def test_invitation_cannot_be_reused(client, app):
    await signup(client)
    token = (await _invite(client)).json()["token"]
    async with make_client(app) as first:
        assert (await _accept(first, token)).status_code == 201
    async with make_client(app) as second:
        r = await _accept(second, token, full_name="Imposter")
    assert r.status_code == 400
    assert r.json() == INVALID


async def test_expired_invitation_is_rejected(client, app):
    owner = (await signup(client)).json()
    token = (await _invite(client)).json()["token"]
    await exec_as_tenant(
        owner["agency"]["id"], "UPDATE invitations SET expires_at = now() - interval '1 minute'"
    )
    async with make_client(app) as invitee:
        r = await _accept(invitee, token)
    assert r.status_code == 400
    assert r.json() == INVALID


async def test_forged_or_garbage_tokens_are_rejected(client, app):
    await signup(client)
    token = (await _invite(client)).json()["token"]
    async with make_client(app) as beta:
        beta_body = (
            await signup(beta, email="owner@betatrips.com", agency_name="Beta Trips")
        ).json()
    _, secret = token.split(".", 1)
    forged = f"{beta_body['agency']['id']}.{secret}"
    async with make_client(app) as attacker:
        assert (await _accept(attacker, forged)).json() == INVALID
        assert (await _accept(attacker, "not-a-token-at-all")).json() == INVALID


async def test_cannot_invite_someone_with_an_account(client, app):
    await signup(client)
    async with make_client(app) as beta:
        await signup(beta, email="owner@betatrips.com", agency_name="Beta Trips")
    r = await _invite(client, email="owner@betatrips.com")
    assert r.status_code == 409


async def test_pending_invitations_and_team_are_tenant_scoped(client, app):
    await signup(client)
    await _invite(client, email="a1@alphatravels.com")
    async with make_client(app) as beta:
        await signup(beta, email="owner@betatrips.com", agency_name="Beta Trips")
        await _invite(beta, email="b1@betatrips.com")
        listed = (await beta.get(INVITE)).json()
        team = (await beta.get("/api/v1/team")).json()
    assert [i["email"] for i in listed] == ["b1@betatrips.com"]
    assert "token" not in listed[0]
    assert [m["email"] for m in team] == ["owner@betatrips.com"]
```

- [ ] **Step 3: Run to verify they fail**

Run: `uv run pytest tests/identity/test_security.py tests/identity/test_invitations.py -v`
Expected: FAIL — cross-site POST returns 401 not 403; invitation routes return 404.

- [ ] **Step 4: Implement Redis dependency and rate limiter**

Create `backend/src/travelmind/cache.py`:

```python
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
from redis.asyncio import Redis

from travelmind.config import get_settings


async def get_redis() -> AsyncIterator[Redis]:
    client = Redis.from_url(get_settings().redis_url)
    try:
        yield client
    finally:
        await client.aclose()


RedisClient = Annotated[Redis, Depends(get_redis)]
```

Create `backend/src/travelmind/identity/ratelimit.py`:

```python
import structlog
from redis.asyncio import Redis
from redis.exceptions import RedisError

log = structlog.get_logger()


class LoginRateLimiter:
    """Fixed-window counter. Fails open (allows) if Redis is unreachable, and logs it."""

    def __init__(self, redis: Redis, max_attempts: int, window_seconds: int) -> None:
        self._redis = redis
        self._max = max_attempts
        self._window = window_seconds

    async def hit(self, key: str) -> bool:
        try:
            count = await self._redis.incr(key)
            if count == 1:
                await self._redis.expire(key, self._window)
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error=str(exc))
            return True
        return count <= self._max

    async def reset(self, key: str) -> None:
        try:
            await self._redis.delete(key)
        except RedisError as exc:
            log.warning("rate_limiter_unavailable", error=str(exc))
```

- [ ] **Step 5: Implement the origin check middleware**

Append to `backend/src/travelmind/middleware.py`:

```python
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """Blocks state-changing browser requests from origins we don't serve (CSRF defence)."""

    def __init__(self, app, allowed_origins: list[str]) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._allowed = frozenset(allowed_origins)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        origin = request.headers.get("origin")
        if request.method in UNSAFE_METHODS and origin is not None and origin not in self._allowed:
            return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
        return await call_next(request)
```

- [ ] **Step 6: Implement invitations**

In `backend/src/travelmind/identity/schemas.py`, add `from datetime import datetime` to the top import block and change `from typing import Annotated` to `from typing import Annotated, Literal`. Then append:

```python
InvitableRole = Literal["admin", "agent"]


class InvitationCreate(BaseModel):
    email: NormalizedEmail
    role: InvitableRole


class InvitationOut(BaseModel):
    id: UUID
    email: str
    role: str
    created_at: datetime
    expires_at: datetime


class InvitationCreated(InvitationOut):
    token: str


class InvitationAccept(BaseModel):
    token: Annotated[str, StringConstraints(min_length=10, max_length=200)]
    full_name: PersonName
    password: NewPassword


class TeamMember(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
```

Create `backend/src/travelmind/identity/invitations.py`:

```python
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.audit.service import record_event
from travelmind.config import get_settings
from travelmind.db import bind_tenant
from travelmind.identity.models import Agency, Invitation, User
from travelmind.identity.passwords import hash_password
from travelmind.identity.service import SessionContext, start_session
from travelmind.identity.tokens import hash_token, make_scoped_token, split_scoped_token

INVALID_INVITATION_MESSAGE = "This invitation link is invalid or has expired."


class InvitationConflict(Exception):
    pass


class InvalidInvitation(Exception):
    pass


async def create_invitation(
    db: AsyncSession, *, agency_id: UUID, invited_by_user_id: UUID, email: str, role: str
) -> tuple[Invitation, str]:
    if await db.scalar(select(User.id).where(User.email == email)) is not None:
        raise InvitationConflict
    token, secret = make_scoped_token(agency_id)
    invitation = Invitation(
        agency_id=agency_id,
        email=email,
        role=role,
        token_hash=hash_token(secret),
        invited_by_user_id=invited_by_user_id,
        expires_at=datetime.now(UTC) + timedelta(hours=get_settings().invitation_ttl_hours),
    )
    db.add(invitation)
    await db.flush()
    await record_event(
        db,
        agency_id=agency_id,
        actor_user_id=invited_by_user_id,
        action="invitation.created",
        entity_type="invitation",
        entity_id=str(invitation.id),
        after={"email": email, "role": role},
    )
    await db.commit()
    return invitation, token


async def list_pending_invitations(db: AsyncSession, agency_id: UUID) -> list[Invitation]:
    result = await db.scalars(
        select(Invitation)
        .where(
            Invitation.agency_id == agency_id,
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > datetime.now(UTC),
        )
        .order_by(Invitation.created_at)
    )
    return list(result.all())


async def accept_invitation(
    db: AsyncSession, *, token: str, full_name: str, password: str, ctx: SessionContext
) -> tuple[User, Agency, str]:
    parsed = split_scoped_token(token)
    if parsed is None:
        raise InvalidInvitation
    agency_id, secret = parsed
    await bind_tenant(db, agency_id)
    invitation = await db.scalar(
        select(Invitation).where(Invitation.token_hash == hash_token(secret)).with_for_update()
    )
    now = datetime.now(UTC)
    if invitation is None or invitation.accepted_at is not None or invitation.expires_at <= now:
        raise InvalidInvitation
    if await db.scalar(select(User.id).where(User.email == invitation.email)) is not None:
        raise InvalidInvitation
    user = User(
        id=uuid4(),
        agency_id=invitation.agency_id,
        email=invitation.email,
        full_name=full_name,
        password_hash=hash_password(password),
        role=invitation.role,
    )
    try:
        db.add(user)
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise InvalidInvitation from exc
    invitation.accepted_at = now
    await record_event(
        db,
        agency_id=invitation.agency_id,
        actor_user_id=user.id,
        action="invitation.accepted",
        entity_type="invitation",
        entity_id=str(invitation.id),
    )
    agency = await db.get_one(Agency, invitation.agency_id)
    session_token = start_session(db, user, ctx)
    await db.commit()
    return user, agency, session_token
```

- [ ] **Step 7: Wire routes (rate-limited login, invitations, team)**

In `backend/src/travelmind/identity/router.py`, replace `login_route` with the rate-limited version and add the new routers. Add these imports:

```python
from typing import Annotated

from fastapi import Depends

from travelmind.cache import RedisClient
from travelmind.identity import invitations
from travelmind.identity.deps import CurrentUser, client_ip, require_role
from travelmind.identity.ratelimit import LoginRateLimiter
from travelmind.identity.schemas import (
    InvitationAccept,
    InvitationCreate,
    InvitationCreated,
    InvitationOut,
    TeamMember,
)
```

Replace `login_route`:

```python
@auth_router.post("/login")
async def login_route(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    redis: RedisClient,
) -> MeResponse:
    settings = get_settings()
    limiter = LoginRateLimiter(redis, settings.login_max_attempts, settings.login_window_seconds)
    key = f"rl:login:{client_ip(request) or 'unknown'}:{body.email}"
    if not await limiter.hit(key):
        minutes = settings.login_window_seconds // 60
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many sign-in attempts. Please wait {minutes} minutes and try again.",
        )
    try:
        user, agency, token = await service.login(
            db, email=body.email, password=body.password, ctx=session_context(request)
        )
    except service.InvalidCredentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.") from None
    await limiter.reset(key)
    set_session_cookie(response, token)
    return me_response(user, agency)
```

Append to the same file:

```python
invitations_router = APIRouter(prefix="/api/v1/invitations", tags=["team"])
team_router = APIRouter(prefix="/api/v1/team", tags=["team"])
ManagerUser = Annotated[CurrentUser, Depends(require_role("owner", "admin"))]


@invitations_router.post("", status_code=status.HTTP_201_CREATED)
async def create_invitation_route(
    body: InvitationCreate, current: ManagerUser, db: DbSession
) -> InvitationCreated:
    try:
        invitation, token = await invitations.create_invitation(
            db,
            agency_id=current.agency_id,
            invited_by_user_id=current.id,
            email=body.email,
            role=body.role,
        )
    except invitations.InvitationConflict:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This person already has a TravelMind account."
        ) from None
    return InvitationCreated(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
        token=token,
    )


@invitations_router.get("")
async def list_invitations_route(current: ManagerUser, db: DbSession) -> list[InvitationOut]:
    pending = await invitations.list_pending_invitations(db, current.agency_id)
    return [
        InvitationOut(
            id=i.id, email=i.email, role=i.role, created_at=i.created_at, expires_at=i.expires_at
        )
        for i in pending
    ]


@invitations_router.post("/accept", status_code=status.HTTP_201_CREATED)
async def accept_invitation_route(
    body: InvitationAccept, request: Request, response: Response, db: DbSession
) -> MeResponse:
    try:
        user, agency, token = await invitations.accept_invitation(
            db,
            token=body.token,
            full_name=body.full_name,
            password=body.password,
            ctx=session_context(request),
        )
    except invitations.InvalidInvitation:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, invitations.INVALID_INVITATION_MESSAGE
        ) from None
    set_session_cookie(response, token)
    return me_response(user, agency)


@team_router.get("")
async def team_route(current: AuthedUser, db: DbSession) -> list[TeamMember]:
    members = await service.list_team(db, current.agency_id)
    return [
        TeamMember(id=m.id, email=m.email, full_name=m.full_name, role=m.role) for m in members
    ]
```

Replace `backend/src/travelmind/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from travelmind.config import get_settings
from travelmind.health import router as health_router
from travelmind.identity.router import auth_router, invitations_router, team_router
from travelmind.middleware import (
    REQUEST_ID_HEADER,
    OriginCheckMiddleware,
    RequestIdMiddleware,
    unhandled_exception_handler,
)
from travelmind.observability import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="TravelMind API", version="0.1.0")
    # Starlette runs the last-added middleware first: RequestId → CORS → OriginCheck → app.
    app.add_middleware(OriginCheckMiddleware, allowed_origins=settings.allowed_origins)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(invitations_router)
    app.include_router(team_router)
    return app
```

- [ ] **Step 8: Run all tests**

Run: `uv run pytest -v`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
uv run ruff check . --fix && uv run ruff format .
cd .. && git add -A backend
git commit -m "feat(identity): team invitations, login rate limiting, CORS + cross-site request blocking"
```

---

### Task 5: Airport reference data (OurAirports) and fuzzy airport search

**Files:**
- Create: `backend/src/travelmind/reference/__init__.py`, `reference/models.py`, `reference/importer.py`, `reference/search.py`, `reference/service.py`, `reference/router.py`, `reference/cli.py`, `backend/migrations/versions/0002_reference.py`
- Modify: `backend/migrations/env.py` (register models), `backend/src/travelmind/main.py` (router)
- Test: `backend/tests/reference/__init__.py`, `tests/reference/data.py`, `tests/reference/conftest.py`, `tests/reference/fixtures/airports.csv`, `tests/reference/fixtures/countries.csv`, `tests/reference/test_importer.py`, `tests/reference/test_search.py`, `tests/reference/test_api.py`

**Interfaces:**
- Consumes: `Base`, `DbSession`, `AuthedUser`, `get_settings`.
- Produces (Plan 2 uses `get_airport_index(db).get(code)` for coordinates and city names):
  - `travelmind.reference.importer.CountryRow(code, name, continent)`, `AirportRow(iata_code, ident, name, city, country_code, airport_type, scheduled_service, latitude, longitude, keywords)`, `parse_countries(text: str) -> list[CountryRow]`, `parse_airports(text: str) -> list[AirportRow]`, `load_reference_data(engine, countries, airports) -> ImportResult(countries: int, airports: int)`
  - `travelmind.reference.search.fold(text) -> str`, `AirportRecord(iata_code, name, city, country_code, country_name, airport_type, scheduled_service, latitude, longitude, keywords)`, `AirportHit(airport: AirportRecord, score: float)`, `AirportIndex(airports)` with `.search(query: str, limit: int = 8) -> list[AirportHit]` and `.get(iata_code: str) -> AirportRecord | None`
  - `travelmind.reference.service.get_airport_index(db) -> AirportIndex`, `reset_airport_index() -> None`
  - HTTP: `GET /api/v1/reference/airports?q=<2..100 chars>&limit=<1..25, default 8>` (auth required) → `[{iata_code, name, city, country_code, country_name, latitude, longitude}]`
  - CLI: `uv run python -m travelmind.reference.cli import-ourairports [--airports-file PATH] [--countries-file PATH]`

- [ ] **Step 1: Create CSV fixtures**

Create `backend/tests/reference/__init__.py` (empty).

Create `backend/tests/reference/fixtures/countries.csv` (UTF-8):

```csv
"id","code","name","continent","wikipedia_link","keywords"
302634,"IN","India","AS","https://en.wikipedia.org/wiki/India",
302622,"IT","Italy","EU","https://en.wikipedia.org/wiki/Italy",
302791,"BR","Brazil","SA","https://en.wikipedia.org/wiki/Brazil",
302748,"NA","Namibia","AF","https://en.wikipedia.org/wiki/Namibia",
```

Create `backend/tests/reference/fixtures/airports.csv` (UTF-8):

```csv
"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","gps_code","iata_code","local_code","home_link","wikipedia_link","keywords"
1,"VIDP","large_airport","Indira Gandhi International Airport",28.5665,77.103104,777,"AS","IN","IN-DL","New Delhi","yes","VIDP","DEL",,,,"Palam, Delhi"
2,"VABB","large_airport","Chhatrapati Shivaji Maharaj International Airport",19.0887,72.8679,39,"AS","IN","IN-MM","Mumbai","yes","VABB","BOM",,,,"Bombay, Sahar"
3,"VOGO","medium_airport","Dabolim Airport",15.3808,73.8314,150,"AS","IN","IN-GA","Vasco da Gama","yes","VOGO","GOI",,,,"Goa"
4,"VOGA","medium_airport","Manohar International Airport",15.7442,73.8606,560,"AS","IN","IN-GA","Mopa","yes","VOGA","GOX",,,,"Goa, Mopa"
5,"LIMJ","medium_airport","Genoa Cristoforo Colombo Airport",44.4133,8.8375,13,"EU","IT","IT-42","Genova","yes","LIMJ","GOA",,,,"Genova"
6,"SBGR","large_airport","São Paulo/Guarulhos International Airport",-23.4356,-46.4731,2459,"SA","BR","BR-SP","São Paulo","yes","SBGR","GRU",,,,
7,"XXCL","closed","Old Closed Field",10.0,10.0,0,"AS","IN","IN-DL","Nowhere","no",,"XXC",,,,
8,"XHEL","heliport","City Heliport",11.0,11.0,0,"AS","IN","IN-DL","Somewhere","no",,"HLP",,,,
9,"XDUP","small_airport","Old Delhi Strip",28.6,77.2,700,"AS","IN","IN-DL","Delhi","no",,"DEL",,,,
10,"XNOI","small_airport","No IATA Strip",12.0,12.0,0,"AS","IN","IN-DL","Nowhere","no",,,,,,
11,"XBAD","small_airport","Bad Coordinates Strip","abc",12.0,0,"AS","IN","IN-DL","Nowhere","no",,"BAD",,,,
12,"XZZZ","large_airport","Unknown Country Airport",1.0,1.0,0,"AS","ZZ","ZZ-1","Nowhere","yes",,"ZZZ",,,,
```

Create `backend/tests/reference/data.py`:

```python
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")
```

Create `backend/tests/reference/conftest.py`:

```python
import os

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from tests.reference.data import fixture_text
from travelmind.reference.importer import load_reference_data, parse_airports, parse_countries
from travelmind.reference.service import reset_airport_index


@pytest.fixture(autouse=True)
def fresh_airport_index():
    reset_airport_index()
    yield
    reset_airport_index()


@pytest.fixture
async def reference_data():
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    try:
        return await load_reference_data(
            engine,
            parse_countries(fixture_text("countries.csv")),
            parse_airports(fixture_text("airports.csv")),
        )
    finally:
        await engine.dispose()
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/reference/test_importer.py`:

```python
import os

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from tests.reference.data import FIXTURES, fixture_text
from travelmind.reference.importer import load_reference_data, parse_airports, parse_countries


def test_parse_countries_keeps_namibia_code_na():
    countries = {c.code: c.name for c in parse_countries(fixture_text("countries.csv"))}
    assert countries == {"IN": "India", "IT": "Italy", "BR": "Brazil", "NA": "Namibia"}


def test_parse_airports_filters_and_dedupes():
    airports = {a.iata_code: a for a in parse_airports(fixture_text("airports.csv"))}
    assert set(airports) == {"DEL", "BOM", "GOI", "GOX", "GOA", "GRU", "ZZZ"}
    assert airports["DEL"].name == "Indira Gandhi International Airport"
    assert airports["GRU"].city == "São Paulo"
    assert airports["BOM"].scheduled_service is True


async def _engine(url_env: str):
    return create_async_engine(os.environ[url_env], poolclass=NullPool)


async def test_load_skips_unknown_countries_and_removes_stale_airports(reference_data):
    assert reference_data.airports == 6  # ZZZ dropped: country ZZ is unknown
    engine = await _engine("TM_MIGRATION_DATABASE_URL")
    countries = parse_countries(fixture_text("countries.csv"))
    without_gru = [a for a in parse_airports(fixture_text("airports.csv")) if a.iata_code != "GRU"]
    await load_reference_data(engine, countries, without_gru)
    async with engine.connect() as conn:
        codes = (await conn.execute(text("SELECT iata_code FROM airports"))).scalars().all()
    await engine.dispose()
    assert sorted(codes) == ["BOM", "DEL", "GOA", "GOI", "GOX"]


async def test_load_refuses_to_wipe_data_with_empty_input(reference_data):
    engine = await _engine("TM_MIGRATION_DATABASE_URL")
    with pytest.raises(ValueError, match="No airports"):
        await load_reference_data(engine, parse_countries(fixture_text("countries.csv")), [])
    await engine.dispose()


async def test_app_role_cannot_modify_reference_data(reference_data):
    engine = await _engine("TM_DATABASE_URL")
    with pytest.raises(DBAPIError, match="permission denied"):
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM airports"))
    await engine.dispose()


def test_cli_imports_files(capsys):
    from travelmind.reference.cli import main

    main(
        [
            "import-ourairports",
            "--airports-file",
            str(FIXTURES / "airports.csv"),
            "--countries-file",
            str(FIXTURES / "countries.csv"),
        ]
    )
    assert "Imported 4 countries and 6 airports" in capsys.readouterr().out
```

Create `backend/tests/reference/test_search.py`:

```python
from travelmind.reference.search import AirportIndex, AirportRecord, fold


def _airport(code, name, city, country="IN", kind="large_airport", scheduled=True, keywords=None):
    return AirportRecord(
        iata_code=code,
        name=name,
        city=city,
        country_code=country,
        country_name={"IN": "India", "IT": "Italy", "BR": "Brazil", "GB": "United Kingdom"}[
            country
        ],
        airport_type=kind,
        scheduled_service=scheduled,
        latitude=0.0,
        longitude=0.0,
        keywords=keywords,
    )


INDEX = AirportIndex(
    [
        _airport("DEL", "Indira Gandhi International Airport", "New Delhi", keywords="Palam"),
        _airport("BOM", "Chhatrapati Shivaji Maharaj International Airport", "Mumbai",
                 keywords="Bombay, Sahar"),
        _airport("GOI", "Dabolim Airport", "Vasco da Gama", kind="medium_airport", keywords="Goa"),
        _airport("GOX", "Manohar International Airport", "Mopa", kind="medium_airport",
                 keywords="Goa, Mopa"),
        _airport("GOA", "Genoa Cristoforo Colombo Airport", "Genova", country="IT",
                 kind="medium_airport"),
        _airport("GRU", "São Paulo/Guarulhos International Airport", "São Paulo", country="BR"),
        _airport("LHR", "London Heathrow Airport", "London", country="GB"),
        _airport("LGW", "London Gatwick Airport", "London", country="GB"),
    ]
)


def codes(query, limit=8):
    return [hit.airport.iata_code for hit in INDEX.search(query, limit)]


def test_fold_strips_accents_case_and_spaces():
    assert fold("  São   PAULO ") == "sao paulo"


def test_exact_iata_code_ranks_first():
    assert codes("bom")[0] == "BOM"
    assert codes("DEL")[0] == "DEL"


def test_old_city_names_resolve():
    assert codes("Bombay")[0] == "BOM"


def test_goa_means_india_before_genoa():
    assert codes("goa")[:3] == ["GOI", "GOX", "GOA"]


def test_typo_still_finds_delhi():
    assert codes("dehli")[0] == "DEL"


def test_accented_city_matches_plain_query():
    assert codes("sao paulo")[0] == "GRU"


def test_city_with_several_airports_returns_all():
    assert set(codes("london")) >= {"LHR", "LGW"}


def test_short_or_empty_queries_return_nothing():
    assert codes("x") == []
    assert codes("   ") == []


def test_limit_is_respected():
    assert len(codes("airport", limit=2)) == 2


def test_get_by_code():
    assert INDEX.get("gru").city == "São Paulo"
    assert INDEX.get("XXX") is None
```

Create `backend/tests/reference/test_api.py`:

```python
from tests.helpers import signup

URL = "/api/v1/reference/airports"


async def test_search_requires_sign_in(client, reference_data):
    r = await client.get(URL, params={"q": "delhi"})
    assert r.status_code == 401


async def test_search_returns_ranked_airports(client, reference_data):
    await signup(client)
    r = await client.get(URL, params={"q": "delhi"})
    assert r.status_code == 200
    first = r.json()[0]
    assert first["iata_code"] == "DEL"
    assert first["country_name"] == "India"
    assert first["city"] == "New Delhi"
    assert isinstance(first["latitude"], float)


async def test_goa_query_returns_indian_airports_first(client, reference_data):
    await signup(client)
    r = await client.get(URL, params={"q": "Goa", "limit": 2})
    assert [a["iata_code"] for a in r.json()] == ["GOI", "GOX"]


async def test_query_validation(client, reference_data):
    await signup(client)
    assert (await client.get(URL, params={"q": "d"})).status_code == 422
    assert (await client.get(URL, params={"q": "delhi", "limit": 100})).status_code == 422
```

- [ ] **Step 3: Run to verify they fail**

Run: `uv run pytest tests/reference -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'travelmind.reference'`.

- [ ] **Step 4: Implement models and migration**

Create `backend/src/travelmind/reference/__init__.py` (empty) and `backend/src/travelmind/reference/models.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from travelmind.db import Base


class Country(Base):
    __tablename__ = "countries"

    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    continent: Mapped[str | None] = mapped_column(String(2))


class Airport(Base):
    __tablename__ = "airports"

    iata_code: Mapped[str] = mapped_column(String(3), primary_key=True)
    ident: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(200))
    country_code: Mapped[str] = mapped_column(ForeignKey("countries.code"))
    airport_type: Mapped[str] = mapped_column(String(32))
    scheduled_service: Mapped[bool]
    latitude: Mapped[float]
    longitude: Mapped[float]
    keywords: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

Add to `backend/migrations/env.py` next to the other model imports:

```python
import travelmind.reference.models  # noqa: F401
```

Create `backend/migrations/versions/0002_reference.py`:

```python
"""global reference data: countries and airports

Revision ID: 0002_reference
Revises: 0001_identity
Create Date: 2026-09-29
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_reference"
down_revision: str | None = "0001_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "countries",
        sa.Column("code", sa.String(2), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("continent", sa.String(2), nullable=True),
    )
    op.create_table(
        "airports",
        sa.Column("iata_code", sa.String(3), primary_key=True),
        sa.Column("ident", sa.String(16), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("city", sa.String(200), nullable=True),
        sa.Column("country_code", sa.String(2), sa.ForeignKey("countries.code"), nullable=False),
        sa.Column("airport_type", sa.String(32), nullable=False),
        sa.Column("scheduled_service", sa.Boolean, nullable=False),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("keywords", sa.Text, nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # Reference data is written only by the importer (owner role); the app just reads it.
    op.execute("REVOKE INSERT, UPDATE, DELETE ON countries, airports FROM travelmind_app")


def downgrade() -> None:
    op.drop_table("airports")
    op.drop_table("countries")
```

- [ ] **Step 5: Implement the importer**

Create `backend/src/travelmind/reference/importer.py`:

```python
import csv
import io
from collections.abc import Iterator, Sequence
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from travelmind.reference.models import Airport, Country

# Airports without these types (closed, heliport, seaplane_base, balloonport) are ignored.
AIRPORT_TYPE_RANK = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}
_BATCH_SIZE = 1000


@dataclass(frozen=True)
class CountryRow:
    code: str
    name: str
    continent: str | None


@dataclass(frozen=True)
class AirportRow:
    iata_code: str
    ident: str
    name: str
    city: str | None
    country_code: str
    airport_type: str
    scheduled_service: bool
    latitude: float
    longitude: float
    keywords: str | None


@dataclass(frozen=True)
class ImportResult:
    countries: int
    airports: int


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def parse_countries(csv_text: str) -> list[CountryRow]:
    # csv (not pandas) on purpose: pandas would read Namibia's code "NA" as a missing value.
    rows = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        code = (row.get("code") or "").strip().upper()
        name = _clean(row.get("name"))
        if len(code) == 2 and name:
            rows.append(CountryRow(code=code, name=name, continent=_clean(row.get("continent"))))
    return rows


def _rank(airport: AirportRow) -> tuple[bool, int]:
    return airport.scheduled_service, AIRPORT_TYPE_RANK[airport.airport_type]


def parse_airports(csv_text: str) -> list[AirportRow]:
    best: dict[str, AirportRow] = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        iata = (row.get("iata_code") or "").strip().upper()
        airport_type = (row.get("type") or "").strip()
        if len(iata) != 3 or not iata.isalpha() or airport_type not in AIRPORT_TYPE_RANK:
            continue
        try:
            latitude = float(row["latitude_deg"])
            longitude = float(row["longitude_deg"])
        except (KeyError, TypeError, ValueError):
            continue
        candidate = AirportRow(
            iata_code=iata,
            ident=(row.get("ident") or "").strip(),
            name=_clean(row.get("name")) or iata,
            city=_clean(row.get("municipality")),
            country_code=(row.get("iso_country") or "").strip().upper(),
            airport_type=airport_type,
            scheduled_service=(row.get("scheduled_service") or "").strip().lower() == "yes",
            latitude=latitude,
            longitude=longitude,
            keywords=_clean(row.get("keywords")),
        )
        current = best.get(iata)
        if current is None or _rank(candidate) > _rank(current):
            best[iata] = candidate
    return sorted(best.values(), key=lambda a: a.iata_code)


def _batches(items: list[dict[str, Any]]) -> Iterator[list[dict[str, Any]]]:
    for start in range(0, len(items), _BATCH_SIZE):
        yield items[start : start + _BATCH_SIZE]


async def load_reference_data(
    engine: AsyncEngine, countries: Sequence[CountryRow], airports: Sequence[AirportRow]
) -> ImportResult:
    """Upsert countries and airports; remove airports that disappeared from the source."""
    country_codes = {c.code for c in countries}
    kept = [a for a in airports if a.country_code in country_codes]
    if not kept:
        raise ValueError("No airports parsed; refusing to wipe existing reference data.")

    async with engine.begin() as conn:
        for batch in _batches([asdict(c) for c in countries]):
            stmt = pg_insert(Country).values(batch)
            await conn.execute(
                stmt.on_conflict_do_update(
                    index_elements=[Country.code],
                    set_={"name": stmt.excluded.name, "continent": stmt.excluded.continent},
                )
            )
        airport_rows = [asdict(a) for a in kept]
        update_columns = [c for c in airport_rows[0] if c != "iata_code"]
        for batch in _batches(airport_rows):
            stmt = pg_insert(Airport).values(batch)
            await conn.execute(
                stmt.on_conflict_do_update(
                    index_elements=[Airport.iata_code],
                    set_={**{c: stmt.excluded[c] for c in update_columns}, "updated_at": func.now()},
                )
            )
        await conn.execute(
            text("DELETE FROM airports WHERE NOT (iata_code = ANY(:codes))"),
            {"codes": [a.iata_code for a in kept]},
        )
    return ImportResult(countries=len(countries), airports=len(kept))
```

- [ ] **Step 6: Implement the search index, service, router, CLI**

Create `backend/src/travelmind/reference/search.py`:

```python
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

from rapidfuzz import fuzz

# Former/common names agents type that don't appear in OurAirports city names.
# Checked before IATA codes because e.g. "GOA" is Genoa's code but an Indian agent means Goa.
CITY_ALIASES: dict[str, tuple[str, ...]] = {
    "goa": ("GOI", "GOX"),
    "bombay": ("BOM",),
    "madras": ("MAA",),
    "calcutta": ("CCU",),
    "bangalore": ("BLR",),
    "bengaluru": ("BLR",),
    "cochin": ("COK",),
    "trivandrum": ("TRV",),
    "poona": ("PNQ",),
    "baroda": ("BDQ",),
    "benares": ("VNS",),
    "banaras": ("VNS",),
    "delhi": ("DEL",),
    "new delhi": ("DEL",),
    "gurgaon": ("DEL",),
    "gurugram": ("DEL",),
    "noida": ("DEL",),
}
TYPE_BOOST = {"large_airport": 15, "medium_airport": 8, "small_airport": 0}
SCHEDULED_BOOST = 10
MIN_FUZZY_SCORE = 70.0
ALIAS_SCORE = 1100.0
IATA_SCORE = 1000.0


def fold(value: str) -> str:
    """Lowercase, strip accents, and collapse whitespace: '  São PAULO ' -> 'sao paulo'."""
    decomposed = unicodedata.normalize("NFKD", value)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(stripped.lower().split())


@dataclass(frozen=True)
class AirportRecord:
    iata_code: str
    name: str
    city: str | None
    country_code: str
    country_name: str
    airport_type: str
    scheduled_service: bool
    latitude: float
    longitude: float
    keywords: str | None


@dataclass(frozen=True)
class AirportHit:
    airport: AirportRecord
    score: float


@dataclass(frozen=True)
class _Folded:
    airport: AirportRecord
    city: str
    name: str
    keywords: str


class AirportIndex:
    """In-memory fuzzy index over ~9k airports; fast enough to search on every keystroke."""

    def __init__(self, airports: Iterable[AirportRecord]) -> None:
        self._entries = [
            _Folded(a, fold(a.city or ""), fold(a.name), fold(a.keywords or "")) for a in airports
        ]
        self._by_code = {e.airport.iata_code: e.airport for e in self._entries}

    def get(self, iata_code: str) -> AirportRecord | None:
        return self._by_code.get(iata_code.strip().upper())

    def search(self, query: str, limit: int = 8) -> list[AirportHit]:
        q = fold(query)
        if len(q) < 2:
            return []
        aliases = CITY_ALIASES.get(q, ())
        hits = []
        for entry in self._entries:
            score = self._score(q, entry, aliases)
            if score is not None:
                hits.append(AirportHit(entry.airport, score))
        hits.sort(key=lambda h: (-h.score, h.airport.iata_code))
        return hits[:limit]

    @staticmethod
    def _score(q: str, entry: _Folded, aliases: tuple[str, ...]) -> float | None:
        airport = entry.airport
        boost = TYPE_BOOST.get(airport.airport_type, 0) + (
            SCHEDULED_BOOST if airport.scheduled_service else 0
        )
        if airport.iata_code in aliases:
            return ALIAS_SCORE + boost
        if len(q) == 3 and q.upper() == airport.iata_code:
            return IATA_SCORE + boost
        fuzzy = max(
            fuzz.WRatio(q, entry.city) if entry.city else 0.0,
            fuzz.WRatio(q, entry.name),
            fuzz.WRatio(q, entry.keywords) if entry.keywords else 0.0,
        )
        if fuzzy < MIN_FUZZY_SCORE:
            return None
        return fuzzy + boost
```

Create `backend/src/travelmind/reference/service.py`:

```python
import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from travelmind.reference.models import Airport, Country
from travelmind.reference.search import AirportIndex, AirportRecord

INDEX_TTL_SECONDS = 3600
_index: AirportIndex | None = None
_loaded_at = 0.0


async def get_airport_index(db: AsyncSession) -> AirportIndex:
    """Process-wide index, rebuilt hourly so a nightly re-import shows up without a restart."""
    global _index, _loaded_at
    if _index is None or time.monotonic() - _loaded_at > INDEX_TTL_SECONDS:
        rows = await db.execute(
            select(Airport, Country.name).join(Country, Country.code == Airport.country_code)
        )
        _index = AirportIndex(
            AirportRecord(
                iata_code=airport.iata_code,
                name=airport.name,
                city=airport.city,
                country_code=airport.country_code,
                country_name=country_name,
                airport_type=airport.airport_type,
                scheduled_service=airport.scheduled_service,
                latitude=airport.latitude,
                longitude=airport.longitude,
                keywords=airport.keywords,
            )
            for airport, country_name in rows.all()
        )
        _loaded_at = time.monotonic()
    return _index


def reset_airport_index() -> None:
    global _index, _loaded_at
    _index = None
    _loaded_at = 0.0
```

Create `backend/src/travelmind/reference/router.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel

from travelmind.db import DbSession
from travelmind.identity.deps import AuthedUser
from travelmind.reference.search import AirportRecord
from travelmind.reference.service import get_airport_index

reference_router = APIRouter(prefix="/api/v1/reference", tags=["reference"])


class AirportOut(BaseModel):
    iata_code: str
    name: str
    city: str | None
    country_code: str
    country_name: str
    latitude: float
    longitude: float

    @classmethod
    def from_record(cls, record: AirportRecord) -> "AirportOut":
        return cls(
            iata_code=record.iata_code,
            name=record.name,
            city=record.city,
            country_code=record.country_code,
            country_name=record.country_name,
            latitude=record.latitude,
            longitude=record.longitude,
        )


@reference_router.get("/airports")
async def search_airports_route(
    q: Annotated[str, Query(min_length=2, max_length=100)],
    _current: AuthedUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=25)] = 8,
) -> list[AirportOut]:
    index = await get_airport_index(db)
    return [AirportOut.from_record(hit.airport) for hit in index.search(q, limit)]
```

Create `backend/src/travelmind/reference/cli.py`:

```python
import argparse
import asyncio
from pathlib import Path

import httpx
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from travelmind.config import get_settings
from travelmind.reference.importer import load_reference_data, parse_airports, parse_countries

OURAIRPORTS_BASE = "https://davidmegginson.github.io/ourairports-data"


def _read_or_download(path: str | None, filename: str) -> str:
    if path:
        return Path(path).read_text(encoding="utf-8")
    response = httpx.get(f"{OURAIRPORTS_BASE}/{filename}", timeout=60, follow_redirects=True)
    response.raise_for_status()
    return response.text


async def _import(airports_file: str | None, countries_file: str | None) -> None:
    countries = parse_countries(_read_or_download(countries_file, "countries.csv"))
    airports = parse_airports(_read_or_download(airports_file, "airports.csv"))
    engine = create_async_engine(get_settings().migration_database_url, poolclass=NullPool)
    try:
        result = await load_reference_data(engine, countries, airports)
    finally:
        await engine.dispose()
    print(f"Imported {result.countries} countries and {result.airports} airports")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="travelmind.reference.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser("import-ourairports", help="Load OurAirports reference data")
    importer.add_argument("--airports-file", help="Local airports.csv (default: download)")
    importer.add_argument("--countries-file", help="Local countries.csv (default: download)")
    args = parser.parse_args(argv)
    asyncio.run(_import(args.airports_file, args.countries_file))


if __name__ == "__main__":
    main()
```

Modify `backend/src/travelmind/main.py` — import and include the router after `team_router`:

```python
from travelmind.reference.router import reference_router
```
```python
    app.include_router(reference_router)
```

- [ ] **Step 7: Run all tests**

Run: `uv run pytest -v`
Expected: all pass.

- [ ] **Step 8: Load real data into the dev database and smoke-test**

```bash
uv run alembic upgrade head
uv run python -m travelmind.reference.cli import-ourairports
```
Expected: `Imported ~249 countries and ~8,000–9,500 airports` (exact counts vary nightly).

Then start the API (`uv run uvicorn travelmind.main:create_app --factory --port 8000`), and in a second terminal:
```bash
curl -s -c /tmp/tm.txt -X POST localhost:8000/api/v1/auth/signup -H 'Content-Type: application/json' \
  -d '{"agency_name":"Smoke Test Travels","full_name":"Smoke Tester","email":"smoke@smoketest.com","password":"correct-horse-battery"}'
curl -s -b /tmp/tm.txt 'localhost:8000/api/v1/reference/airports?q=goa&limit=3'
curl -s -b /tmp/tm.txt 'localhost:8000/api/v1/reference/airports?q=dehli&limit=1'
```
Expected: first response has `"iata_code":"GOI"` then `"GOX"`; second has `"DEL"`. Stop the server.

- [ ] **Step 9: Commit**

```bash
uv run ruff check . --fix && uv run ruff format .
cd .. && git add -A backend
git commit -m "feat(reference): OurAirports import and fuzzy airport search with Indian city aliases"
```

---

### Task 6: Architecture guard, CI, developer docs

**Files:**
- Create: `backend/tests/test_architecture.py`, `.github/workflows/backend.yml`, `.pre-commit-config.yaml`
- Modify: `README.md` (rewrite), `docs/superpowers/specs/2026-09-29-travelmind-saas-design.md` (§4 identity-table note)

**Interfaces:**
- Consumes: whole backend.
- Produces: CI that runs lint, format check, type check, and tests on every push/PR.

- [ ] **Step 1: Write the architecture test**

Create `backend/tests/test_architecture.py`:

```python
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "travelmind"


def test_identity_tables_are_only_imported_inside_identity():
    """agencies/users/sessions have no RLS, so only travelmind.identity may query them."""
    offenders = []
    for path in SRC.rglob("*.py"):
        if path.relative_to(SRC).parts[0] == "identity":
            continue
        if "identity.models" in path.read_text(encoding="utf-8"):
            offenders.append(str(path.relative_to(SRC)))
    assert offenders == [], f"Use travelmind.identity.deps/service instead: {offenders}"


def test_every_tenant_table_uses_the_rls_helper():
    """Each migration that creates a table with agency_id must call tenant_rls_statements."""
    versions = Path(__file__).resolve().parents[1] / "migrations" / "versions"
    offenders = []
    for path in versions.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        if '"agency_id"' in source and "tenant_rls_statements" not in source:
            offenders.append(path.name)
    assert offenders == []
```

- [ ] **Step 2: Run it**

Run: `cd backend && uv run pytest tests/test_architecture.py -v`
Expected: 2 passed (the guard protects future plans; it passes on correct code).

- [ ] **Step 3: Type-check and fix any findings**

Run: `uv run mypy src`
Expected: `Success: no issues found`. If mypy reports issues, fix them in the named files (do not add blanket `ignore_errors`), then re-run `uv run pytest -q`.

- [ ] **Step 4: Add CI and pre-commit**

Create `.github/workflows/backend.yml`:

```yaml
name: backend

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
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
        ports: ["6379:6379"]
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync --locked
      - name: Create roles and databases
        run: psql -h localhost -p 5433 -U postgres -f ../infra/postgres/init.sql
        env:
          PGPASSWORD: postgres
      - run: uv run ruff check .
      - run: uv run ruff format --check .
      - run: uv run mypy src
      - run: uv run pytest -q
```

Create `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: ruff-check
        name: ruff check
        entry: uv run --directory backend ruff check --fix .
        language: system
        types: [python]
        pass_filenames: false
      - id: ruff-format
        name: ruff format
        entry: uv run --directory backend ruff format .
        language: system
        types: [python]
        pass_filenames: false
```

- [ ] **Step 5: Rewrite the README**

Replace `README.md`:

````markdown
# TravelMind

AI copilot for travel agencies and corporate travel: quotes from live supplier inventory,
every price verified against real offers, fare intelligence, policy and approvals.

> Status: Milestone 1 in progress. Plan 1 (backend foundation) is complete.
> `frontend/` is the legacy prototype UI and is replaced in M1 Plan 4.

## Layout

| Path | What |
|---|---|
| `backend/` | FastAPI app (`src/travelmind`), Alembic migrations, tests |
| `infra/postgres/init.sql` | Creates DB roles (`travelmind_owner`, `travelmind_app`) and databases |
| `docker-compose.yml` | Postgres 16 + pgvector (port 5433), Redis 7 (port 6379) |
| `docs/superpowers/specs/` | Product/architecture spec |
| `docs/superpowers/plans/` | Implementation plans |

## Run locally

Prerequisites: Docker Desktop, [uv](https://docs.astral.sh/uv/).

```bash
docker compose up -d --wait
cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run python -m travelmind.reference.cli import-ourairports
uv run uvicorn travelmind.main:create_app --factory --reload
```

API docs: http://localhost:8000/docs

## Test

```bash
cd backend
uv run pytest            # needs docker compose services running
uv run ruff check . && uv run mypy src
```

Reset the local database completely: `docker compose down -v && docker compose up -d --wait`.

## Security model (short)

- Tenant data tables use Postgres row-level security (forced); the app connects as a role
  that cannot bypass it. Identity tables are only accessed through `travelmind.identity`.
- Sessions are opaque, revocable, httpOnly cookies; passwords use Argon2.
- Cross-site state-changing requests are rejected; login is rate limited.
````

- [ ] **Step 6: Record the identity-table decision in the spec**

In `docs/superpowers/specs/2026-09-29-travelmind-saas-design.md` §4, after the bullet starting "Every row carries `agency_id`", add:

```markdown
- Exception (decided in M1 Plan 1): identity tables `agencies`, `users`, `sessions` have no RLS because login must look users up before the tenant is known. They are accessed only through `travelmind.identity` (enforced by an architecture test), and `users` queries always filter by `agency_id`. Invitations use `<agency_id>.<secret>` tokens so they stay under RLS.
```

- [ ] **Step 7: Full verification and commit**

```bash
cd /d/travel-rag-agent/backend
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q
cd ..
git add -A
git commit -m "chore: architecture guard tests, CI workflow, pre-commit, README"
git push
```
Expected: all checks pass locally; after push, the `backend` GitHub Actions workflow goes green.
