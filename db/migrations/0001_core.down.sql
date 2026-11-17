-- Rollback of 0001_core. Destroys all application data: only for development / failed deploys.
DROP TABLE IF EXISTS
  audit_logs, outbox_messages, change_requests, booking_events, room_assignments, booking_nights,
  booking_rooms, bookings, guests, inventory_nights, daily_rates, rate_plans, rooms,
  room_type_images, room_types, properties, rate_limits, password_reset_tokens,
  user_sessions, memberships, users, tenant_domains, tenants
CASCADE;
DROP FUNCTION IF EXISTS touch_updated_at();
DROP FUNCTION IF EXISTS app_tenant_id();
