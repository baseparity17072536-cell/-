ALTER TABLE booking_nights DROP COLUMN IF EXISTS price_source;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_total_formula;
ALTER TABLE bookings DROP COLUMN IF EXISTS vat_satang, DROP COLUMN IF EXISTS service_charge_satang, DROP COLUMN IF EXISTS tax_inclusive;
-- restoring the original rule only holds when no exclusive-tax bookings exist
ALTER TABLE bookings ADD CONSTRAINT bookings_total_simple CHECK (total_satang = subtotal_satang - discount_satang);
ALTER TABLE properties DROP COLUMN IF EXISTS legal_name, DROP COLUMN IF EXISTS tax_id, DROP COLUMN IF EXISTS service_charge_bp,
  DROP COLUMN IF EXISTS vat_bp, DROP COLUMN IF EXISTS prices_include_tax;
DROP TABLE IF EXISTS price_rules;
ALTER TABLE rooms DROP COLUMN IF EXISTS housekeeping_status, DROP COLUMN IF EXISTS zone, DROP COLUMN IF EXISTS building;
ALTER TABLE room_types DROP CONSTRAINT IF EXISTS room_types_code_unique, DROP CONSTRAINT IF EXISTS room_types_code_format;
ALTER TABLE room_types DROP COLUMN IF EXISTS video_url, DROP COLUMN IF EXISTS building, DROP COLUMN IF EXISTS bed_count,
  DROP COLUMN IF EXISTS view_type, DROP COLUMN IF EXISTS code;
