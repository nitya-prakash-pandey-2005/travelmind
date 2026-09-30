from sqlalchemy import text

from tests.helpers import run_as_owner
from travelmind.db import get_sessionmaker

TENANT_TABLES = [
    "agency_counters",
    "clients",
    "enquiries",
    "quotes",
    "quote_versions",
    "activity_events",
    "search_source_results",
]


async def test_workspace_tables_force_rls():
    async with get_sessionmaker()() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname = ANY(:names)"
                ),
                {"names": TENANT_TABLES},
            )
        ).all()
    assert {r.relname for r in rows} == set(TENANT_TABLES)
    assert all(r.relrowsecurity and r.relforcerowsecurity for r in rows)


async def test_append_only_tables_deny_update_and_delete():
    async with get_sessionmaker()() as db:
        rows = (
            await db.execute(
                text(
                    "SELECT table_name, privilege_type FROM information_schema.role_table_grants "
                    "WHERE grantee = 'travelmind_app' AND table_name = ANY(:names)"
                ),
                {"names": ["activity_events", "quote_versions", "search_source_results"]},
            )
        ).all()
    granted = {(r.table_name, r.privilege_type) for r in rows}
    for table in ("activity_events", "quote_versions", "search_source_results"):
        assert (table, "INSERT") in granted and (table, "SELECT") in granted
        assert (table, "UPDATE") not in granted and (table, "DELETE") not in granted


async def test_agencies_have_profile_columns_with_defaults():
    await run_as_owner("INSERT INTO agencies (id, name) VALUES (gen_random_uuid(), 'X')")
    async with get_sessionmaker()() as db:
        row = (
            await db.execute(
                text("SELECT country_code, currency, timezone, brand_color, is_demo FROM agencies")
            )
        ).one()
    assert tuple(row) == ("IN", "INR", "Asia/Kolkata", "#22d3ee", False)
