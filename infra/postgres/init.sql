-- Runs once, as the postgres superuser, when the data volume is first created.
-- Reset with: docker compose down -v
CREATE ROLE travelmind_owner LOGIN PASSWORD 'owner_dev_pw';
CREATE ROLE travelmind_app LOGIN PASSWORD 'app_dev_pw' NOBYPASSRLS;

CREATE DATABASE travelmind OWNER travelmind_owner;
CREATE DATABASE travelmind_test OWNER travelmind_owner;

\connect travelmind
CREATE EXTENSION IF NOT EXISTS vector;
GRANT USAGE ON SCHEMA public TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO travelmind_app;

\connect travelmind_test
CREATE EXTENSION IF NOT EXISTS vector;
GRANT USAGE ON SCHEMA public TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO travelmind_app;
ALTER DEFAULT PRIVILEGES FOR ROLE travelmind_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO travelmind_app;
