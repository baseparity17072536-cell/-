-- =============================================================================
-- 0001_core: Multi-tenant foundation, auth, catalog, pricing, inventory, booking
-- Money: satang (integer). Stay dates: date (property local). Instants: timestamptz.
-- Tenant isolation: every tenant table has tenant_id + RLS policy on app.tenant_id
-- and composite FKs (tenant_id, x_id) so rows can never point across tenants.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- helper: current tenant from transaction-local setting (NULL when unset -> fail closed)
CREATE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ----------------------------------------------------------------- platform --
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_domains (
  host        text PRIMARY KEY CHECK (host = lower(host)),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false
);
CREATE INDEX tenant_domains_tenant_idx ON tenant_domains (tenant_id);

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  name              text NOT NULL,
  password_hash     text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  failed_logins     int NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- owner = ผู้อนุมัติ (สิทธิ์ทั้งหมด), admin = แก้ไขบางส่วน (เรื่องสำคัญต้องขออนุมัติ)
  role       text NOT NULL CHECK (role IN ('owner','admin','front_desk','accountant')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE user_sessions (
  id          text PRIMARY KEY,                       -- sha256(token) hex; raw token only in cookie
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expiry_idx ON user_sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id          text PRIMARY KEY,                       -- sha256(token) hex
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);

-- DB-backed fixed-window rate limiting (works across instances)
CREATE TABLE rate_limits (
  key        text PRIMARY KEY,
  count      int NOT NULL,
  reset_at   timestamptz NOT NULL
);

-- ------------------------------------------------------------ tenant config --
CREATE TABLE properties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name_th         text NOT NULL,
  name_en         text,
  phone           text,
  email           citext,
  address         text,
  facebook_url    text,
  line_url        text,
  timezone        text NOT NULL DEFAULT 'Asia/Bangkok',
  check_in_time   time NOT NULL DEFAULT '14:00',
  check_out_time  time NOT NULL DEFAULT '12:00',
  hold_minutes    int  NOT NULL DEFAULT 1440 CHECK (hold_minutes BETWEEN 15 AND 10080),
  max_nights      int  NOT NULL DEFAULT 30 CHECK (max_nights BETWEEN 1 AND 365),
  booking_window_days int NOT NULL DEFAULT 365 CHECK (booking_window_days BETWEEN 1 AND 730),
  damage_deposit_satang int NOT NULL DEFAULT 0 CHECK (damage_deposit_satang >= 0),
  child_max_age   int  NOT NULL DEFAULT 11 CHECK (child_max_age BETWEEN 0 AND 17),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug)
);

-- ------------------------------------------------------------------ catalog --
CREATE TABLE room_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  property_id          uuid NOT NULL,
  slug                 text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  name_th              text NOT NULL,
  name_en              text,
  description_th       text NOT NULL DEFAULT '',
  description_en       text,
  bed_info             text NOT NULL DEFAULT '',
  size_sqm             int CHECK (size_sqm > 0),
  base_adults          int NOT NULL CHECK (base_adults > 0),          -- included in room price
  max_adults           int NOT NULL CHECK (max_adults >= base_adults),
  max_children         int NOT NULL DEFAULT 0 CHECK (max_children >= 0),
  max_occupancy        int NOT NULL CHECK (max_occupancy >= base_adults),
  max_extra_beds       int NOT NULL DEFAULT 0 CHECK (max_extra_beds >= 0),
  base_price_satang    int NOT NULL CHECK (base_price_satang >= 0),   -- per room per night
  extra_adult_satang   int NOT NULL DEFAULT 0 CHECK (extra_adult_satang >= 0),
  child_satang         int NOT NULL DEFAULT 0 CHECK (child_satang >= 0),
  extra_bed_satang     int NOT NULL DEFAULT 0 CHECK (extra_bed_satang >= 0),
  amenities            text[] NOT NULL DEFAULT '{}',
  sort_order           int NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, property_id, slug),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);

CREATE TABLE room_type_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  room_type_id  uuid NOT NULL,
  url           text NOT NULL,
  alt           text NOT NULL DEFAULT '',
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, room_type_id) REFERENCES room_types (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX room_type_images_type_idx ON room_type_images (tenant_id, room_type_id, sort_order);

CREATE TABLE rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  room_type_id  uuid NOT NULL,
  room_number   text NOT NULL,
  floor         text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, room_type_id, room_number),
  FOREIGN KEY (tenant_id, room_type_id) REFERENCES room_types (tenant_id, id)
);

-- Rate plans: price derived from room-type daily price (e.g. Room Only, Breakfast package)
CREATE TABLE rate_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  property_id      uuid NOT NULL,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name_th          text NOT NULL,
  name_en          text,
  description_th   text NOT NULL DEFAULT '',
  meal_plan        text NOT NULL DEFAULT 'room_only' CHECK (meal_plan IN ('room_only','breakfast','half_board','full_board')),
  adjust_type      text NOT NULL DEFAULT 'none' CHECK (adjust_type IN ('none','percent','fixed')),
  adjust_value     int  NOT NULL DEFAULT 0,      -- percent (-100..1000) or satang per room-night
  min_nights       int  NOT NULL DEFAULT 1 CHECK (min_nights >= 1),
  is_refundable    boolean NOT NULL DEFAULT true,
  is_default       boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, property_id, code),
  CHECK (adjust_type <> 'percent' OR adjust_value BETWEEN -100 AND 1000),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id)
);
CREATE UNIQUE INDEX rate_plans_one_default ON rate_plans (tenant_id, property_id) WHERE is_default;

-- Daily overrides per room type: price, stop-sell, min stay
CREATE TABLE daily_rates (
  tenant_id      uuid NOT NULL,
  room_type_id   uuid NOT NULL,
  stay_date      date NOT NULL,
  price_satang   int CHECK (price_satang >= 0),   -- NULL = base price
  is_closed      boolean NOT NULL DEFAULT false,
  min_nights     int CHECK (min_nights >= 1),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, room_type_id, stay_date),
  FOREIGN KEY (tenant_id, room_type_id) REFERENCES room_types (tenant_id, id) ON DELETE CASCADE
);

-- Inventory ledger: one row per room type per night. held+sold can never exceed total.
CREATE TABLE inventory_nights (
  tenant_id     uuid NOT NULL,
  room_type_id  uuid NOT NULL,
  stay_date     date NOT NULL,
  total         int NOT NULL CHECK (total >= 0),
  held          int NOT NULL DEFAULT 0 CHECK (held >= 0),
  sold          int NOT NULL DEFAULT 0 CHECK (sold >= 0),
  PRIMARY KEY (tenant_id, room_type_id, stay_date),
  FOREIGN KEY (tenant_id, room_type_id) REFERENCES room_types (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT inventory_no_overbooking CHECK (held + sold <= total)
);

-- ------------------------------------------------------------------ booking --
CREATE TABLE guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  phone       text NOT NULL,                   -- digits only, e.g. 0914646363
  email       citext,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX guests_phone_idx ON guests (tenant_id, phone);

CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  property_id       uuid NOT NULL,
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9]{6,16}$'),
  guest_id          uuid NOT NULL,
  status            text NOT NULL CHECK (status IN ('pending_payment','payment_review','confirmed',
                      'checked_in','checked_out','cancelled','expired','no_show')),
  source            text NOT NULL DEFAULT 'web' CHECK (source IN ('web','phone','walk_in','facebook','line','ota','api')),
  check_in          date NOT NULL,
  check_out         date NOT NULL,
  adults            int NOT NULL CHECK (adults > 0),
  children          int NOT NULL DEFAULT 0 CHECK (children >= 0),
  subtotal_satang   int NOT NULL CHECK (subtotal_satang >= 0),
  discount_satang   int NOT NULL DEFAULT 0 CHECK (discount_satang >= 0),
  total_satang      int NOT NULL CHECK (total_satang >= 0),
  special_request   text,
  internal_note     text,
  hold_expires_at   timestamptz,
  idempotency_key   text,
  cancelled_by      text CHECK (cancelled_by IN ('guest','staff','system')),
  cancel_reason     text,
  created_by        uuid REFERENCES users(id),
  version           int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (check_out > check_in),
  CHECK (total_satang = subtotal_satang - discount_satang),
  CHECK (status <> 'pending_payment' OR hold_expires_at IS NOT NULL),
  FOREIGN KEY (tenant_id, property_id) REFERENCES properties (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id)    REFERENCES guests (tenant_id, id)
);
CREATE INDEX bookings_dates_idx ON bookings (tenant_id, property_id, check_in, check_out);
CREATE INDEX bookings_status_idx ON bookings (tenant_id, status, created_at DESC);
CREATE INDEX bookings_guest_idx ON bookings (tenant_id, guest_id);
CREATE INDEX bookings_hold_idx ON bookings (hold_expires_at) WHERE status = 'pending_payment';

CREATE TABLE booking_rooms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  booking_id        uuid NOT NULL,
  room_type_id      uuid NOT NULL,
  rate_plan_id      uuid NOT NULL,
  room_type_name    text NOT NULL,           -- snapshots
  rate_plan_name    text NOT NULL,
  adults            int NOT NULL CHECK (adults > 0),
  children          int NOT NULL DEFAULT 0 CHECK (children >= 0),
  extra_beds        int NOT NULL DEFAULT 0 CHECK (extra_beds >= 0),
  amount_satang     int NOT NULL CHECK (amount_satang >= 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id)   REFERENCES bookings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, room_type_id) REFERENCES room_types (tenant_id, id),
  FOREIGN KEY (tenant_id, rate_plan_id) REFERENCES rate_plans (tenant_id, id)
);
CREATE INDEX booking_rooms_booking_idx ON booking_rooms (tenant_id, booking_id);
CREATE INDEX booking_rooms_type_idx ON booking_rooms (tenant_id, room_type_id);

CREATE TABLE booking_nights (
  tenant_id         uuid NOT NULL,
  booking_room_id   uuid NOT NULL,
  stay_date         date NOT NULL,
  room_satang       int NOT NULL CHECK (room_satang >= 0),
  extras_satang     int NOT NULL DEFAULT 0 CHECK (extras_satang >= 0),   -- extra adult/child/bed
  PRIMARY KEY (booking_room_id, stay_date),
  FOREIGN KEY (tenant_id, booking_room_id) REFERENCES booking_rooms (tenant_id, id) ON DELETE CASCADE
);

-- Physical room assignment: the same room can never be assigned to overlapping stays
CREATE TABLE room_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  booking_room_id  uuid NOT NULL,
  room_id          uuid NOT NULL,
  stay             daterange NOT NULL CHECK (NOT isempty(stay)),
  active           boolean NOT NULL DEFAULT true,
  assigned_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, booking_room_id) REFERENCES booking_rooms (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, room_id)         REFERENCES rooms (tenant_id, id),
  CONSTRAINT room_no_overlap EXCLUDE USING gist
    (tenant_id WITH =, room_id WITH =, stay WITH &&) WHERE (active)
);
CREATE UNIQUE INDEX room_assignments_one_active ON room_assignments (booking_room_id) WHERE active;

CREATE TABLE booking_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  booking_id    uuid NOT NULL,
  action        text NOT NULL,
  from_status   text,
  to_status     text,
  actor_type    text NOT NULL CHECK (actor_type IN ('guest','staff','system','api')),
  actor_id      uuid,
  data          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX booking_events_booking_idx ON booking_events (tenant_id, booking_id, created_at);

-- Maker-checker: sensitive changes by non-owners wait here until an owner approves.
-- payload holds the exact validated input that will be applied on approval.
CREATE TABLE change_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind           text NOT NULL,                 -- 'room_type.update', 'daily_rates.set', 'booking.cancel', ...
  entity_id      text,
  summary        text NOT NULL,                 -- human readable, shown to approver
  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn','failed')),
  requested_by   uuid NOT NULL REFERENCES users(id),
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  review_note    text,
  apply_error    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)
);
CREATE INDEX change_requests_pending_idx ON change_requests (tenant_id, created_at DESC) WHERE status = 'pending';

-- ----------------------------------------------------- notification / audit --
CREATE TABLE outbox_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('email','line')),
  template      text NOT NULL,
  recipient     text,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  attempts      int  NOT NULL DEFAULT 0,
  next_try_at   timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_messages (next_try_at) WHERE status = 'queued';

CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  data        jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC);

-- ------------------------------------------------------------ updated_at --
CREATE TRIGGER tenants_touch BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER properties_touch BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER room_types_touch BEFORE UPDATE ON room_types FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER rooms_touch BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER rate_plans_touch BEFORE UPDATE ON rate_plans FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER daily_rates_touch BEFORE UPDATE ON daily_rates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER guests_touch BEFORE UPDATE ON guests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER bookings_touch BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ------------------------------------------------------- row level security --
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties','room_types','room_type_images','rooms','rate_plans',
    'daily_rates','inventory_nights','guests','bookings','booking_rooms','booking_nights',
    'room_assignments','booking_events','change_requests','outbox_messages','audit_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------ runtime role --
-- The web app connects as a LOGIN role that is a member of app_runtime:
-- not superuser, not table owner, no BYPASSRLS -> RLS always applies.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
REVOKE ALL ON schema_migrations FROM app_runtime;
-- history is append-only for the application
REVOKE UPDATE, DELETE ON audit_logs, booking_events FROM app_runtime;

-- memberships / sessions are tenant-scoped too, but must be readable during login
-- before a tenant context exists; they are only accessed through server/auth code
-- which always filters by tenant_id explicitly.
