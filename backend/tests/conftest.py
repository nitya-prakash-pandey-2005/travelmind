import os
import sys

os.environ["TM_ENVIRONMENT"] = "test"
os.environ["TM_DATABASE_URL"] = os.environ.get(
    "TM_TEST_DATABASE_URL",
    "postgresql+asyncpg://travelmind_app:app_dev_pw@localhost:5433/travelmind_test",
)
os.environ["TM_MIGRATION_DATABASE_URL"] = os.environ.get(
    "TM_TEST_MIGRATION_DATABASE_URL",
    "postgresql+asyncpg://travelmind_owner:owner_dev_pw@localhost:5433/travelmind_test",
)
os.environ["TM_REDIS_URL"] = os.environ.get("TM_TEST_REDIS_URL", "redis://localhost:6380/15")
# Process env beats backend/.env, so these switch off any real supplier or model keys and the FX
# feed a developer's .env may hold. TM_SANDBOX_SUPPLIER is only unset here, so a value for it in
# backend/.env still applies: tests that depend on it build Settings(_env_file=None).
for _key in (
    "TM_DUFFEL_TOKEN",
    "TM_LITEAPI_KEY",
    "TM_GOOGLE_TIM_API_KEY",
    "TM_TRAVELPAYOUTS_TOKEN",
    "TM_GOOGLE_API_KEY",
    "GOOGLE_API_KEY",
    "TM_OPENTRIPMAP_KEY",
    "TM_OSM_CONTACT",
):
    os.environ[_key] = ""
os.environ["TM_FX_ENABLED"] = "false"
os.environ.pop("TM_SANDBOX_SUPPLIER", None)

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from redis.asyncio import Redis  # noqa: E402
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
            (
                await conn.execute(
                    text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
                    )
                )
            )
            .scalars()
            .all()
        )
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


@pytest.fixture(autouse=True)
async def clean_redis():
    client = Redis.from_url(os.environ["TM_REDIS_URL"])
    await client.flushdb()
    await client.aclose()
    yield


@pytest.fixture(autouse=True)
async def close_shared_clients():
    """Each test runs on its own event loop; the process-wide Redis pool and httpx clients hold
    sockets bound to the loop that opened them, so close them after every test. The read cache's
    breaker, the supplier guards (breakers and concurrency limits) and the session cache are
    process-wide too: they start fresh in every test, whatever an earlier one did. So do the
    Gemini SDK clients, which hold their own HTTP pools."""
    from travelmind.identity.sessioncache import reset_session_cache
    from travelmind.readcache import reset_breaker
    from travelmind.resilience import reset_guards

    reset_breaker()
    reset_guards()
    reset_session_cache()
    yield
    from travelmind.cache import close_redis
    from travelmind.http import close_http_clients
    from travelmind.jobs import close_job_queue

    reset_breaker()
    reset_guards()
    gemini = sys.modules.get("travelmind.agent.gemini")  # only once a test has loaded it
    if gemini is not None:
        await gemini.close_clients()
    await close_http_clients()
    await close_job_queue()
    await close_redis()


@pytest.fixture
async def airports():
    """Load the reference fixture airports (DEL, BOM, GOI, GOX, GOA, GRU, …) and a fresh index."""
    from tests.reference.data import fixture_text
    from travelmind.reference.importer import load_reference_data, parse_airports, parse_countries
    from travelmind.reference.service import reset_airport_index

    reset_airport_index()
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    try:
        await load_reference_data(
            engine,
            parse_countries(fixture_text("countries.csv")),
            parse_airports(fixture_text("airports.csv")),
        )
    finally:
        await engine.dispose()
    yield
    reset_airport_index()
