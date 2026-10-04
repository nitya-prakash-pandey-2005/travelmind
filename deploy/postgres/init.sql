-- Runs once, as the postgres superuser, when the deploy stack's data volume is first created.
-- Same roles and grants as infra/postgres/init.sql (the dev stack), with three differences:
--   * passwords come from the container environment (APP_DB_PASSWORD, OWNER_DB_PASSWORD, set in
--     deploy/.env), falling back to the dev defaults in deploy/.env.example;
--   * the app role carries its statement timeout, because PgBouncer does not forward the
--     statement_timeout startup parameter the app sets when it connects directly;
--   * no travelmind_test database.
-- Reset with: docker compose -f deploy/docker-compose.yml -p travelmind-prod down -v
\getenv app_password APP_DB_PASSWORD
\getenv owner_password OWNER_DB_PASSWORD
\if :{?app_password}
\else
\set app_password app_dev_pw
\endif
\if :{?owner_password}
\else
\set owner_password owner_dev_pw
\endif

CREATE ROLE travelmind_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE travelmind_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
-- Every app transaction is capped; the arq worker raises it per transaction (SET LOCAL).
ALTER ROLE travelmind_app SET statement_timeout = '5s';

CREATE DATABASE travelmind OWNER travelmind_owner;

\connect travelmind
CREATE EXTENSION IF NOT EXISTS vector;
GRANT USAGE ON SCHEMA public TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO travelmind_app;
