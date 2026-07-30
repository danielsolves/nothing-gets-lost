-- packages/db/migrations/005_readonly_role.sql
-- The role behind the public SQL console. Defence in depth: even if the statement
-- guard in the application had a hole, this role cannot write and cannot see any
-- table except the four views.
--
-- Numbered 005 rather than 004 as the plan sketched it: 004_invoice_sequence.sql is
-- already applied, and the runner records migrations by filename — editing or
-- reusing a taken number would be silently skipped on any database that has run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ngl_ro') THEN
    CREATE ROLE ngl_ro LOGIN PASSWORD 'ngl_ro';
  END IF;
END $$;

ALTER ROLE ngl_ro SET default_transaction_read_only = on;
ALTER ROLE ngl_ro SET statement_timeout = '2s';

REVOKE ALL ON SCHEMA public FROM ngl_ro;
GRANT USAGE ON SCHEMA public TO ngl_ro;
GRANT SELECT ON v_events, v_deliveries, v_orders, v_dead_letters TO ngl_ro;
