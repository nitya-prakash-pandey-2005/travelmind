import ast
import os
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

SRC = Path(__file__).resolve().parents[1] / "src" / "travelmind"
IDENTITY_MODELS = "travelmind.identity.models"


def _module_name(path: Path) -> str:
    parts = ("travelmind", *path.relative_to(SRC).with_suffix("").parts)
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def _identity_models_imports(source: str, module: str, *, is_package: bool = False) -> list[str]:
    """Import statements in `source` (module `module`) that reach travelmind.identity.models."""
    package = module if is_package else module.rpartition(".")[0]
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
            if any(n == IDENTITY_MODELS or n.startswith(IDENTITY_MODELS + ".") for n in names):
                found.append(ast.unparse(node))
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                parts = package.split(".")
                base = parts[: max(len(parts) - (node.level - 1), 0)]
                target = ".".join([*base, node.module] if node.module else base)
            else:
                target = node.module or ""
            if target == IDENTITY_MODELS or target.startswith(IDENTITY_MODELS + "."):
                found.append(ast.unparse(node))
            elif target == "travelmind.identity" and any(a.name == "models" for a in node.names):
                found.append(ast.unparse(node))
    return found


def test_identity_tables_are_only_imported_inside_identity():
    """agencies/users/sessions have no RLS, so only travelmind.identity may query them."""
    offenders = []
    for path in SRC.rglob("*.py"):
        if path.relative_to(SRC).parts[0] == "identity":
            continue
        hits = _identity_models_imports(
            path.read_text(encoding="utf-8"),
            _module_name(path),
            is_package=path.name == "__init__.py",
        )
        offenders += [f"{path.relative_to(SRC)}: {hit}" for hit in hits]
    assert offenders == [], f"Use travelmind.identity.deps/service instead: {offenders}"


@pytest.mark.parametrize(
    ("source", "module", "is_package"),
    [
        ("import travelmind.identity.models", "travelmind.reference.router", False),
        ("import travelmind.identity.models as m", "travelmind.reference.router", False),
        ("from travelmind.identity.models import User", "travelmind.reference.router", False),
        ("from travelmind.identity import deps, models", "travelmind.reference.router", False),
        ("from travelmind.identity import models as m", "travelmind.reference.router", False),
        ("from ..identity import models", "travelmind.reference.router", False),
        ("from ..identity.models import User", "travelmind.reference.router", False),
        ("from .identity import models", "travelmind", True),
        ("from .identity.models import User", "travelmind.main", False),
        ("def f():\n    from travelmind.identity import models", "travelmind.cache", False),
    ],
)
def test_identity_import_guard_catches_every_import_form(source, module, is_package):
    assert _identity_models_imports(source, module, is_package=is_package) != []


@pytest.mark.parametrize(
    ("source", "module"),
    [
        ("# see travelmind.identity.models for the schema", "travelmind.reference.router"),
        ('DOC = "travelmind.identity.models"', "travelmind.reference.router"),
        ("from travelmind.identity.deps import AuthedUser", "travelmind.reference.router"),
        ("from travelmind.identity import deps", "travelmind.reference.router"),
        ("from ..identity import router", "travelmind.reference.router"),
        ("from .models import Airport", "travelmind.reference.service"),
    ],
)
def test_identity_import_guard_ignores_non_imports_and_other_modules(source, module):
    assert _identity_models_imports(source, module) == []


def test_every_tenant_table_uses_the_rls_helper():
    """Each migration that creates a table with agency_id must call tenant_rls_statements."""
    versions = Path(__file__).resolve().parents[1] / "migrations" / "versions"
    offenders = []
    for path in versions.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        creates_table = "create_table" in source or "CREATE TABLE" in source
        if creates_table and '"agency_id"' in source and "tenant_rls_statements" not in source:
            offenders.append(path.name)
    assert offenders == []


# Identity table: RLS would block login lookups by email, so it is guarded by code instead.
# quote_share_tokens maps a public link to its agency before any tenant is known, so it can't
# use the tenant policy; the app role has no privileges on it at all and reaches it only through
# two definer functions (see migration 0006 and test_app_role_cannot_read_token_table).
NON_RLS_TABLES_WITH_AGENCY_ID = {"users", "quote_share_tokens"}


async def test_every_tenant_table_has_forced_rls_in_the_migrated_schema():
    """Checks the real catalog, not migration text: RLS enabled + forced, tenant policy present."""
    engine = create_async_engine(os.environ["TM_MIGRATION_DATABASE_URL"], poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        """
                        SELECT c.relname,
                               c.relrowsecurity,
                               c.relforcerowsecurity,
                               EXISTS (
                                   SELECT 1 FROM pg_policy p
                                   WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
                               ) AS has_policy
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public'
                          AND c.relkind IN ('r', 'p')
                          AND EXISTS (
                              SELECT 1 FROM pg_attribute a
                              WHERE a.attrelid = c.oid
                                AND a.attname = 'agency_id'
                                AND NOT a.attisdropped
                          )
                        ORDER BY c.relname
                        """
                    )
                )
            ).all()
    finally:
        await engine.dispose()

    tenant_tables = {row.relname: row for row in rows}
    for name in NON_RLS_TABLES_WITH_AGENCY_ID:
        tenant_tables.pop(name, None)
    # Guard against a vacuous pass (e.g. wrong schema or database).
    assert {"invitations", "audit_log"} <= tenant_tables.keys()
    offenders = [
        f"{name}: rls={row.relrowsecurity} force={row.relforcerowsecurity} "
        f"tenant_isolation={row.has_policy}"
        for name, row in tenant_tables.items()
        if not (row.relrowsecurity and row.relforcerowsecurity and row.has_policy)
    ]
    assert offenders == [], (
        f"Tenant tables must use travelmind.db.tenant_rls_statements(): {offenders}"
    )
