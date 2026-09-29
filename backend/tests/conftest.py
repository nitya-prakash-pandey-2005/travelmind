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
os.environ["TM_REDIS_URL"] = os.environ.get("TM_TEST_REDIS_URL", "redis://localhost:6380/15")

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
