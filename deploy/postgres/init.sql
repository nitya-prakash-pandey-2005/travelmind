-- Runs once, as the postgres superuser, when the deploy stack's data volume is first created.
-- Same roles and grants as infra/postgres/init.sql (the dev stack), with these differences:
--   * passwords come from the container environment (APP_DB_PASSWORD, OWNER_DB_PASSWORD, set in
--     deploy/.env). If either is unset or empty, this script stops with an error: there is no
--     fallback to dev passwords;
--   * the app role carries its statement timeout, because PgBouncer does not forward the
--     statement_timeout startup parameter the app sets when it connects directly;
--   * pg_stat_statements is created (the server preloads it, see deploy/docker-compose.yml);
--   * no travelmind_test database.
-- If it fails, the volume is left half-initialised and the next start skips this script: fix
-- deploy/.env, then reset with: docker compose -f deploy/docker-compose.yml -p travelmind-prod down -v
\set ON_ERROR_STOP on
\getenv app_password APP_DB_PASSWORD
\getenv owner_password OWNER_DB_PASSWORD
\if :{?app_password}
\else
\set app_password ''
\endif
\if :{?owner_password}
\else
\set owner_password ''
\endif
SELECT :'app_password' = '' AS app_password_missing,
       :'owner_password' = '' AS owner_password_missing \gset
\if :app_password_missing
DO $$ BEGIN RAISE EXCEPTION 'APP_DB_PASSWORD is not set: set it in deploy/.env'; END $$;
\endif
\if :owner_password_missing
DO $$ BEGIN RAISE EXCEPTION 'OWNER_DB_PASSWORD is not set: set it in deploy/.env'; END $$;
\endif

CREATE ROLE travelmind_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE travelmind_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
-- Every app transaction is capped; the arq worker raises it per transaction (SET LOCAL).
ALTER ROLE travelmind_app SET statement_timeout = '5s';

CREATE DATABASE travelmind OWNER travelmind_owner;

\connect travelmind
CREATE EXTENSION IF NOT EXISTS vector;
-- Query statistics for load tests and slow-query hunting (read as postgres; deploy/README.md).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
GRANT USAGE ON SCHEMA public TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO travelmind_app;
