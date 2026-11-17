-- =============================================================================
-- 0003: Hardening for hosted Postgres that exposes the public schema over HTTP
--       (Supabase Data API / PostgREST uses roles `anon` and `authenticated`).
-- This app never uses those roles: every table is reachable only through the
-- application role (app_runtime). Revoke everything from them, including on
-- tables created later. No-op on plain PostgreSQL where the roles do not exist.
-- =============================================================================
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Defense in depth: tables without a tenant column also get RLS, readable only by the app role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','tenant_domains','users','memberships','user_sessions',
                           'password_reset_tokens','rate_limits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY app_runtime_only ON %I TO app_runtime USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
