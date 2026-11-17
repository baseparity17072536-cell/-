-- =============================================================================
-- 0002: Addendum Part 1–3 — richer room data, price rules with explicit priority,
--       tax & service charge, price source per night. Additive only (no data loss).
-- Price resolution order per night (ADR-0004):
--   1. daily_rates.price_satang (explicit date override)
--   2. price_rules (season / holiday / weekday) — highest priority, then newest
--   3. room_types.base_price_satang
--   then rate plan adjustment, then promotions (Phase 4), then tax/service charge.
-- =============================================================================

-- ---------------------------------------------------------------- room types --
ALTER TABLE room_types
  ADD COLUMN code       text,
  ADD COLUMN view_type  text NOT NULL DEFAULT '',
  ADD COLUMN bed_count  int  NOT NULL DEFAULT 1 CHECK (bed_count >= 0),
  ADD COLUMN building   text,
  ADD COLUMN video_url  text CHECK (video_url IS NULL OR video_url ~ '^https://');
UPDATE room_types SET code = upper(left(regexp_replace(slug, '[^a-z0-9]+', '_', 'g'), 20));
ALTER TABLE room_types
  ALTER COLUMN code SET NOT NULL,
  ADD CONSTRAINT room_types_code_format CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  ADD CONSTRAINT room_types_code_unique UNIQUE (tenant_id, property_id, code);

-- -------------------------------------------------------------------- rooms --
ALTER TABLE rooms
  ADD COLUMN building text,
  ADD COLUMN zone text,
  ADD COLUMN housekeeping_status text NOT NULL DEFAULT 'clean'
    CHECK (housekeeping_status IN ('clean','dirty','inspected','out_of_service'));

-- -------------------------------------------------------------- price rules --
CREATE TABLE price_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  room_type_id   uuid NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('weekday','season','holiday','event')),
  date_from      date,                                  -- NULL = open-ended
  date_to        date,                                  -- inclusive
  weekdays       smallint[] NOT NULL DEFAULT '{}',      -- 0=Sun..6=Sat, empty = every day
  price_satang   int NOT NULL CHECK (price_satang >= 0),
  priority       int NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1000),
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (date_to IS NULL OR date_from IS NULL OR date_to >= date_from),
  CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  FOREIGN KEY (tenant_id, room_type_id) REFERENCES room_types (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX price_rules_lookup_idx ON price_rules (tenant_id, room_type_id) WHERE is_active;
CREATE TRIGGER price_rules_touch BEFORE UPDATE ON price_rules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE price_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON price_rules USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON price_rules TO app_runtime;

-- --------------------------------------------------------- tax & service --
-- basis points: 700 = 7.00%
ALTER TABLE properties
  ADD COLUMN prices_include_tax boolean NOT NULL DEFAULT true,
  ADD COLUMN vat_bp int NOT NULL DEFAULT 700 CHECK (vat_bp BETWEEN 0 AND 3000),
  ADD COLUMN service_charge_bp int NOT NULL DEFAULT 0 CHECK (service_charge_bp BETWEEN 0 AND 3000),
  ADD COLUMN tax_id text,
  ADD COLUMN legal_name text;

ALTER TABLE bookings
  ADD COLUMN tax_inclusive boolean NOT NULL DEFAULT true,
  ADD COLUMN service_charge_satang int NOT NULL DEFAULT 0 CHECK (service_charge_satang >= 0),
  ADD COLUMN vat_satang int NOT NULL DEFAULT 0 CHECK (vat_satang >= 0);

-- replace the total check so exclusive pricing adds tax exactly once
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'bookings'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%total_satang = (subtotal_satang - discount_satang)%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE bookings DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE bookings ADD CONSTRAINT bookings_total_formula CHECK (
  total_satang = subtotal_satang - discount_satang
    + CASE WHEN tax_inclusive THEN 0 ELSE service_charge_satang + vat_satang END
);

-- ------------------------------------------------- which price was applied --
ALTER TABLE booking_nights ADD COLUMN price_source text NOT NULL DEFAULT 'base';
