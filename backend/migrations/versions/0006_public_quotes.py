"""public quote links: share-token lookup for the unauthenticated quote page, accepted option

Revision ID: 0006_public_quotes
Revises: 0005_ssr_search_index
Create Date: 2026-09-30

`quotes` has FORCE RLS, so even an owner-run function can't find a quote without knowing its
agency. The token → agency mapping lives in `quote_share_tokens`, which the application role
can't read at all: it only reaches it through two narrow SECURITY DEFINER functions. The public
page resolves an exact token hash to its agency, binds the tenant and reads under RLS as usual.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_public_quotes"
down_revision: str | None = "0005_ssr_search_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UPGRADE = [
    """
    CREATE TABLE quote_share_tokens (
      token_hash text PRIMARY KEY,
      quote_id uuid NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
      agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE
    )
    """,
    "REVOKE ALL ON quote_share_tokens FROM travelmind_app",
    # Public read: exact hash match only; returns the agency so the app can bind the tenant.
    # Definer functions pin search_path (pg_catalog first, pg_temp last) and qualify every table.
    """
    CREATE FUNCTION public_quote_agency(p_token_hash text) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS
      $$ SELECT agency_id FROM public.quote_share_tokens WHERE token_hash = p_token_hash $$
    """,
    # Called by send_quote inside the tenant-bound transaction, after the quote's new
    # share_token_hash is flushed. The quote must be visible under the caller's RLS context
    # (quotes policy uses app.agency_id), so one agency can't register a token for another
    # agency's quote; and the hash must be the quote's own current one, so no caller can register
    # a token of its choosing.
    """
    CREATE FUNCTION set_quote_share_token(p_quote_id uuid, p_token_hash text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
      DECLARE
        v_agency uuid := NULLIF(current_setting('app.agency_id', true), '')::uuid;
        v_hash text;
      BEGIN
        IF v_agency IS NULL THEN
          RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
        END IF;
        SELECT q.share_token_hash INTO v_hash FROM public.quotes q
          WHERE q.id = p_quote_id AND q.agency_id = v_agency;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'quote not found' USING ERRCODE = 'P0002';
        END IF;
        IF v_hash IS NULL OR p_token_hash IS NULL OR v_hash <> p_token_hash THEN
          RAISE EXCEPTION 'share token does not match the quote' USING ERRCODE = '22023';
        END IF;
        DELETE FROM public.quote_share_tokens WHERE quote_id = p_quote_id;
        INSERT INTO public.quote_share_tokens (token_hash, quote_id, agency_id)
          VALUES (v_hash, p_quote_id, v_agency);
      END $$
    """,
    "REVOKE ALL ON FUNCTION public_quote_agency(text), set_quote_share_token(uuid, text) "
    "FROM PUBLIC",
    "GRANT EXECUTE ON FUNCTION public_quote_agency(text), set_quote_share_token(uuid, text) "
    "TO travelmind_app",
    # Back-fill links already sent. FORCE RLS would hide every quote from the owner too, so it
    # is lifted for this one statement (inside the migration's transaction) and restored.
    "ALTER TABLE quotes NO FORCE ROW LEVEL SECURITY",
    """
    INSERT INTO quote_share_tokens (token_hash, quote_id, agency_id)
    SELECT share_token_hash, id, agency_id FROM quotes WHERE share_token_hash IS NOT NULL
    """,
    "ALTER TABLE quotes FORCE ROW LEVEL SECURITY",
]


def upgrade() -> None:
    for statement in _UPGRADE:
        op.execute(statement)
    # The option the client accepted on the public page (index into the sent version's options).
    op.add_column("quotes", sa.Column("accepted_option", sa.SmallInteger, nullable=True))


def downgrade() -> None:
    op.drop_column("quotes", "accepted_option")
    op.execute("DROP FUNCTION set_quote_share_token(uuid, text)")
    op.execute("DROP FUNCTION public_quote_agency(text)")
    op.execute("DROP TABLE quote_share_tokens")
