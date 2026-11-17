-- Removes the extra RLS layer. Revoked privileges for anon/authenticated are intentionally NOT restored.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','tenant_domains','users','memberships','user_sessions',
                           'password_reset_tokens','rate_limits'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS app_runtime_only ON %I', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
