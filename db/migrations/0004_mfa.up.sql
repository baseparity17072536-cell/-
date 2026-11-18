-- =============================================================================
-- 0004: Two-factor sign-in (TOTP) — required for owners, optional for other roles.
-- * users.totp_secret      AES-256-GCM ciphertext (key derived from APP_SECRET), never plaintext
-- * users.totp_enabled_at  NULL = not enrolled (a stored secret is a pending enrollment)
-- * users.totp_last_step   last accepted 30-second step: a code can be used only once
-- * user_sessions.mfa_ok   session was created with a second factor; once a user has
--                          MFA enabled, sessions without it are no longer valid
-- =============================================================================
ALTER TABLE users
  ADD COLUMN totp_secret     text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step  bigint;

ALTER TABLE user_sessions ADD COLUMN mfa_ok boolean NOT NULL DEFAULT false;

-- One-time recovery codes (sha256 of the normalized code; codes carry 40+ bits of entropy)
CREATE TABLE mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

-- Password accepted, waiting for the second factor (short-lived, attempt-limited)
CREATE TABLE mfa_challenges (
  id         text PRIMARY KEY,                        -- sha256(token) hex; raw token only in cookie
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_challenges_user_idx ON mfa_challenges (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes, mfa_challenges TO app_runtime;

-- same defense in depth as 0003: only the app role can reach these tables
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_only ON mfa_recovery_codes TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_only ON mfa_challenges TO app_runtime USING (true) WITH CHECK (true);
