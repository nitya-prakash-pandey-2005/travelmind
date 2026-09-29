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
