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
