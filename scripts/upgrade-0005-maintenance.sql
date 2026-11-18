-- Production upgrade: migration 0005_maintenance (maintenance tickets)
-- Paste into Supabase → SQL Editor (project rvderruwwpssegttzktf) and click Run, BEFORE deploying the code.
-- Runs in one transaction: if it was already applied, it stops with "already exists" and changes nothing.
-- Generated from db/migrations/0005_maintenance.up.sql — edit that file, not this one.
BEGIN;

-- =============================================================================
-- 0005: Maintenance tickets (Phase 3 — housekeeping & maintenance)
-- * A ticket is for one physical room, or for a common area (location text).
-- * room_blocked = this ticket took the room out of sale (rooms.status = 'maintenance');
--   the room goes back on sale when the last blocking ticket is closed.
-- =============================================================================
CREATE TABLE maintenance_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id  uuid NOT NULL,
  room_id      uuid,
  location     text CHECK (length(location) <= 120),
  title        text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  detail       text CHECK (length(detail) <= 2000),
  priority     text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','urgent')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  room_blocked boolean NOT NULL DEFAULT false,
  reported_by  uuid REFERENCES users(id),
  resolved_by  uuid REFERENCES users(id),
  resolved_at  timestamptz,
  resolution   text CHECK (length(resolution) <= 2000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES rooms (tenant_id, id),
  CHECK (room_id IS NOT NULL OR location IS NOT NULL),
  CHECK (NOT room_blocked OR room_id IS NOT NULL),
  CHECK ((status IN ('done','cancelled')) = (resolved_at IS NOT NULL))
);
CREATE INDEX maintenance_open_idx ON maintenance_tickets (tenant_id, property_id, status) WHERE status IN ('open','in_progress');
CREATE INDEX maintenance_room_idx ON maintenance_tickets (tenant_id, room_id);
CREATE TRIGGER maintenance_tickets_touch BEFORE UPDATE ON maintenance_tickets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE maintenance_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON maintenance_tickets USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_tickets TO app_runtime;

-- Supabase Data API roles must not reach this table (same as 0003/0004)
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON maintenance_tickets FROM %I', r);
    END IF;
  END LOOP;
END $$;

INSERT INTO schema_migrations (version) VALUES ('0005_maintenance');
COMMIT;

-- Check: should list 0001…0005
SELECT version, applied_at FROM schema_migrations ORDER BY version;
