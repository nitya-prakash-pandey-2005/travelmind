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
