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
