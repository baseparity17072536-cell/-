-- =============================================================================
-- 0006: Content in other languages (guest website: Thai + English + Chinese, more later)
-- translations = { "<lang>": { "<field>": "<text>" | ["<text>", ...] } }
--   room_types: name, description, bed_info, view_type, amenities (array)
--   rate_plans: name, description
--   properties: name, address
-- Thai stays in the existing columns. Missing text falls back to English, then Thai.
-- The old *_en columns are copied into translations.en and kept in sync by the app.
-- =============================================================================
ALTER TABLE properties ADD COLUMN translations jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(translations) = 'object');
ALTER TABLE room_types ADD COLUMN translations jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(translations) = 'object');
ALTER TABLE rate_plans ADD COLUMN translations jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(translations) = 'object');

UPDATE properties SET translations = jsonb_build_object('en', jsonb_strip_nulls(jsonb_build_object('name', name_en)))
  WHERE name_en IS NOT NULL;
UPDATE room_types SET translations = jsonb_build_object('en',
    jsonb_strip_nulls(jsonb_build_object('name', name_en, 'description', description_en)))
  WHERE name_en IS NOT NULL OR description_en IS NOT NULL;
UPDATE rate_plans SET translations = jsonb_build_object('en', jsonb_strip_nulls(jsonb_build_object('name', name_en)))
  WHERE name_en IS NOT NULL;
