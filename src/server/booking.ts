import "server-only";
import { randomInt } from "node:crypto";
import { addDays, isIsoDate, nightsBetween, todayIn } from "@/lib/dates";
import { audit, enqueue, type Actor } from "./audit";
import { canTransition, inventoryDelta, STATUS_LABEL, type BookingStatus } from "./booking-status";
import { many, one, withTenant, type Tx } from "./db";
import { DomainError, pgCode, pgConstraint } from "./errors";
import { applyInventoryDelta, availabilityByNight } from "./inventory";
import {
  computeTax, priceRoom, PricingError, resolveNightPrice, sumNights,
  type DailyRate, type PriceRule, type RatePlanPricing, type RoomTypePricing, type TaxConfig,
} from "./pricing";
import { decide, ForbiddenError, type Permission } from "./rbac";

// ---------------------------------------------------------------- types --
export type BookingSource = "web" | "phone" | "walk_in" | "facebook" | "line";

export type BookingRoomInput = {
  roomTypeId: string;
  ratePlanId?: string;
  adults: number;
  children: number;
  extraBeds: number;
};

export type CreateBookingInput = {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  rooms: BookingRoomInput[];
  guest: { name: string; phone: string; email?: string | null; note?: string | null };
  source: BookingSource;
  /** staff only: create directly as confirmed (payment taken at the counter / by phone) */
  confirmNow?: boolean;
  internalNote?: string | null;
  idempotencyKey?: string | null;
};

type PropertyRow = {
  id: string;
  name_th: string;
  timezone: string;
  hold_minutes: number;
  max_nights: number;
  booking_window_days: number;
  prices_include_tax: boolean;
  vat_bp: number;
  service_charge_bp: number;
};

export const taxOf = (p: PropertyRow): TaxConfig => ({ inclusive: p.prices_include_tax, vatBp: p.vat_bp, serviceChargeBp: p.service_charge_bp });

export type RoomTypeRow = RoomTypePricing & { id: string; name_th: string; property_id: string; is_active: boolean };
export type RatePlanRow = RatePlanPricing & { id: string; name_th: string; property_id: string; is_default: boolean; is_active: boolean };

export type BookingRow = {
  id: string;
  code: string;
  property_id: string;
  status: BookingStatus;
  check_in: string;
  check_out: string;
  version: number;
  total_satang: number;
  guest_id: string;
};

// --------------------------------------------------------------- helpers --
export function requireStaff(actor: Actor, permission: Permission) {
  if (actor.type !== "staff") throw new ForbiddenError();
  const d = decide(actor.role, permission);
  if (d === "deny") throw new ForbiddenError();
  return d;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  let c = "FT";
  for (let i = 0; i < 8; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return c;
}

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function validateStay(p: PropertyRow, checkIn: string, checkOut: string, actor: Actor) {
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) throw new DomainError("VALIDATION", "กรุณาเลือกวันเช็คอินและวันเช็คเอาท์");
  const today = todayIn(p.timezone);
  if (checkIn < today) throw new DomainError("VALIDATION", "วันเช็คอินต้องไม่เป็นวันที่ผ่านมาแล้ว");
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new DomainError("VALIDATION", "วันเช็คเอาท์ต้องอยู่หลังวันเช็คอิน");
  if (nights > p.max_nights) throw new DomainError("VALIDATION", `จองได้สูงสุด ${p.max_nights} คืนต่อการจอง`);
  if (actor.type !== "staff" && checkIn > addDays(today, p.booking_window_days))
    throw new DomainError("VALIDATION", `รับจองล่วงหน้าได้ไม่เกิน ${p.booking_window_days} วัน`);
  return nights;
}

export async function loadProperty(tx: Tx, propertyId: string) {
  const p = await one<PropertyRow>(
    tx,
    `SELECT id, name_th, timezone, hold_minutes, max_nights, booking_window_days, prices_include_tax, vat_bp, service_charge_bp
     FROM properties WHERE id = $1 AND is_active`,
    [propertyId],
  );
  if (!p) throw new DomainError("NOT_FOUND", "ไม่พบที่พัก");
  return p;
}

export const ROOM_TYPE_COLS = `id, property_id, name_th, is_active, base_adults, max_adults, max_children, max_occupancy,
  max_extra_beds, base_price_satang, extra_adult_satang, child_satang, extra_bed_satang`;
export const RATE_PLAN_COLS = `id, property_id, name_th, is_default, is_active, adjust_type, adjust_value, min_nights`;

export async function loadDailyRates(tx: Tx, roomTypeIds: string[], checkIn: string, checkOut: string) {
  const rows = await many<DailyRate & { room_type_id: string }>(
    tx,
    `SELECT room_type_id, stay_date, price_satang, is_closed, min_nights FROM daily_rates
     WHERE room_type_id = ANY($1::uuid[]) AND stay_date >= $2 AND stay_date < $3`,
    [roomTypeIds, checkIn, checkOut],
  );
  const map = new Map<string, DailyRate[]>();
  for (const r of rows) map.set(r.room_type_id, [...(map.get(r.room_type_id) ?? []), r]);
  return map;
}

export async function loadPriceRules(tx: Tx, roomTypeIds: string[], checkIn: string, checkOut: string) {
  const rows = await many<PriceRule & { room_type_id: string }>(
    tx,
    `SELECT id, room_type_id, name, date_from::text, date_to::text, weekdays::int[] AS weekdays, price_satang, priority, created_at
     FROM price_rules
     WHERE room_type_id = ANY($1::uuid[]) AND is_active
       AND (date_from IS NULL OR date_from < $3) AND (date_to IS NULL OR date_to >= $2)`,
    [roomTypeIds, checkIn, checkOut],
  );
  const map = new Map<string, PriceRule[]>();
  for (const r of rows) map.set(r.room_type_id, [...(map.get(r.room_type_id) ?? []), r]);
  return map;
}

function toDomain(e: unknown): never {
  if (e instanceof PricingError) throw new DomainError(e.code, e.message);
  throw e;
}

// ------------------------------------------------------------ transitions --
async function changeInventory(tx: Tx, tenantId: string, b: BookingRow, from: BookingStatus | null, to: BookingStatus) {
  const types = await many<{ room_type_id: string; n: number }>(
    tx,
    `SELECT room_type_id, count(*)::int AS n FROM booking_rooms WHERE booking_id = $1 GROUP BY room_type_id ORDER BY room_type_id`,
    [b.id],
  );
  for (const t of types) {
    await applyInventoryDelta(tx, tenantId, t.room_type_id, b.check_in, b.check_out, inventoryDelta(from, to, t.n));
  }
}

async function applyTransition(
  tx: Tx,
  tenantId: string,
  b: BookingRow,
  to: BookingStatus,
  actor: Actor,
  opts: { reason?: string | null } = {},
) {
  const from = b.status;
  if (!canTransition(from, to, actor.type === "staff" ? "staff" : actor.type))
    throw new DomainError("INVALID_TRANSITION", `ไม่สามารถเปลี่ยนสถานะจาก “${STATUS_LABEL[from]}” เป็น “${STATUS_LABEL[to]}” ได้`);

  if (to === "checked_in") {
    const unassigned = await one<{ n: number }>(
      tx,
      `SELECT count(*)::int AS n FROM booking_rooms br
       WHERE br.booking_id = $1 AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.booking_room_id = br.id AND ra.active)`,
      [b.id],
    );
    if (unassigned!.n > 0) throw new DomainError("VALIDATION", "กรุณาจัดเลขห้องให้ครบทุกห้องก่อนเช็คอิน");
  }

  if (to === "no_show") {
    const tz = (await one<{ timezone: string }>(tx, "SELECT timezone FROM properties WHERE id = $1", [b.property_id]))!.timezone;
    if (b.check_in > todayIn(tz)) throw new DomainError("VALIDATION", "บันทึกว่าไม่มาเข้าพักได้ตั้งแต่วันเช็คอินเป็นต้นไป");
  }

  await changeInventory(tx, tenantId, b, from, to);

  if (to === "checked_out") {
    // the guest has left: their rooms need cleaning before the next arrival
    await tx.query(
      `UPDATE rooms SET housekeeping_status = 'dirty' WHERE id IN (
         SELECT ra.room_id FROM room_assignments ra JOIN booking_rooms br ON br.id = ra.booking_room_id
         WHERE br.booking_id = $1 AND ra.active)`,
      [b.id],
    );
  }

  if (to === "cancelled" || to === "expired" || to === "no_show") {
    await tx.query(
      `UPDATE room_assignments SET active = false
       WHERE active AND booking_room_id IN (SELECT id FROM booking_rooms WHERE booking_id = $1)`,
      [b.id],
    );
  }

  const holdMinutes =
    to === "pending_payment"
      ? (await one<{ hold_minutes: number }>(tx, "SELECT hold_minutes FROM properties WHERE id = $1", [b.property_id]))!.hold_minutes
      : null;

  await tx.query(
    `UPDATE bookings SET status = $2, version = version + 1,
       hold_expires_at = CASE WHEN $2 = 'pending_payment' THEN now() + make_interval(mins => $3::int) ELSE hold_expires_at END,
       cancelled_by = CASE WHEN $2 = 'cancelled' THEN $4 ELSE cancelled_by END,
       cancel_reason = CASE WHEN $2 = 'cancelled' THEN $5 ELSE cancel_reason END
     WHERE id = $1`,
    [b.id, to, holdMinutes ?? 0, actor.type, opts.reason ?? null],
  );
  await tx.query(
    `INSERT INTO booking_events (tenant_id, booking_id, action, from_status, to_status, actor_type, actor_id, data)
     VALUES ($1, $2, 'status_changed', $3, $4, $5, $6, $7)`,
    [tenantId, b.id, from, to, actor.type, actor.type === "staff" ? actor.userId : null, opts.reason ? JSON.stringify({ reason: opts.reason }) : null],
  );
  if (actor.type === "staff") await audit(tx, tenantId, actor, `booking.${to}`, "booking", b.code, { from, to, reason: opts.reason });
  await enqueue(tx, tenantId, "line", "staff.booking_status", null, { code: b.code, from, to });
  b.status = to;
  b.version += 1;
}

/** Release holds whose payment window has passed (called by cron and before every reservation). */
export async function expireStaleHolds(tx: Tx, tenantId: string, limit = 200) {
  const stale = await many<BookingRow>(
    tx,
    `SELECT id, code, property_id, status, check_in, check_out, version, total_satang, guest_id FROM bookings
     WHERE status = 'pending_payment' AND hold_expires_at < now()
     ORDER BY hold_expires_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  for (const b of stale) await applyTransition(tx, tenantId, b, "expired", { type: "system" });
  return stale.length;
}

// ------------------------------------------------------------- availability --
export type AvailabilityResult = {
  roomTypeId: string;
  name: string;
  available: number;
  closed: boolean;
  plans: {
    ratePlanId: string;
    name: string;
    /** amount the guest pays (tax added when the property prices exclude tax) */
    total: number;
    tax: { net: number; serviceCharge: number; vat: number; inclusive: boolean };
    nightly: { date: string; amount: number; source: string }[];
    error?: string;
  }[];
  error?: string;
};

export async function searchAvailability(
  tenantId: string,
  q: { propertyId: string; checkIn: string; checkOut: string; adults: number; children: number; rooms: number },
  actor: Actor = { type: "guest" },
): Promise<AvailabilityResult[]> {
  return withTenant(tenantId, async (tx) => {
    const p = await loadProperty(tx, q.propertyId);
    validateStay(p, q.checkIn, q.checkOut, actor);
    await expireStaleHolds(tx, tenantId);

    const types = await many<RoomTypeRow>(
      tx,
      `SELECT ${ROOM_TYPE_COLS} FROM room_types WHERE property_id = $1 AND is_active ORDER BY sort_order, name_th`,
      [p.id],
    );
    const plans = await many<RatePlanRow>(
      tx,
      `SELECT ${RATE_PLAN_COLS} FROM rate_plans WHERE property_id = $1 AND is_active ORDER BY is_default DESC, sort_order`,
      [p.id],
    );
    const ids = types.map((t) => t.id);
    const free = await availabilityByNight(tx, tenantId, ids, q.checkIn, q.checkOut);
    const daily = await loadDailyRates(tx, ids, q.checkIn, q.checkOut);
    const rules = await loadPriceRules(tx, ids, q.checkIn, q.checkOut);
    const party = splitPartySafe(q.rooms, q.adults, q.children);
    const tax = taxOf(p);

    return types.map((t) => {
      const d = daily.get(t.id) ?? [];
      const closed = d.some((x) => x.is_closed);
      const result: AvailabilityResult = { roomTypeId: t.id, name: t.name_th, available: free.get(t.id) ?? 0, closed, plans: [] };
      if (!party) result.error = "ต้องมีผู้ใหญ่อย่างน้อย 1 ท่านต่อห้อง";
      for (const plan of plans) {
        try {
          if (!party) throw new PricingError("OCCUPANCY", result.error!);
          const perRoom = party.map((o) => priceRoom(t, plan, d, q.checkIn, q.checkOut, o, rules.get(t.id) ?? []));
          const nightly = perRoom[0].map((n, i) => ({ date: n.date, amount: perRoom.reduce((s, r) => s + r[i].room + r[i].extras, 0), source: n.sourceLabel }));
          const b = computeTax(perRoom.reduce((s, r) => s + sumNights(r), 0), tax);
          result.plans.push({
            ratePlanId: plan.id, name: plan.name_th, total: b.total,
            tax: { net: b.net, serviceCharge: b.serviceCharge, vat: b.vat, inclusive: tax.inclusive }, nightly,
          });
        } catch (e) {
          if (!(e instanceof PricingError)) throw e;
          result.plans.push({
            ratePlanId: plan.id, name: plan.name_th, total: 0, tax: { net: 0, serviceCharge: 0, vat: 0, inclusive: tax.inclusive }, nightly: [], error: e.message,
          });
        }
      }
      return result;
    });
  });
}

function splitPartySafe(rooms: number, adults: number, children: number) {
  if (rooms < 1 || adults < rooms) return null;
  return Array.from({ length: rooms }, (_, i) => ({
    adults: Math.floor(adults / rooms) + (i < adults % rooms ? 1 : 0),
    children: Math.floor(children / rooms) + (i < children % rooms ? 1 : 0),
    extraBeds: 0,
  }));
}

// ----------------------------------------------------------------- create --
export async function createBooking(tenantId: string, input: CreateBookingInput, actor: Actor) {
  if (actor.type === "staff") {
    requireStaff(actor, "booking.create");
    if (input.confirmNow) requireStaff(actor, "booking.status");
  } else if (input.confirmNow || input.source !== "web" || input.internalNote) {
    throw new ForbiddenError();
  }
  if (input.rooms.length < 1 || input.rooms.length > 10) throw new DomainError("VALIDATION", "จองได้ 1–10 ห้องต่อการจอง");
  const name = input.guest.name.trim();
  const phone = normalizePhone(input.guest.phone);
  if (name.length < 2) throw new DomainError("VALIDATION", "กรุณากรอกชื่อ-นามสกุล");
  if (phone.length < 9 || phone.length > 15) throw new DomainError("VALIDATION", "เบอร์โทรศัพท์ไม่ถูกต้อง");

  try {
    return await withTenant(tenantId, async (tx) => {
      if (input.idempotencyKey) {
        const prev = await one<{ code: string; status: BookingStatus; total_satang: number }>(
          tx,
          "SELECT code, status, total_satang FROM bookings WHERE idempotency_key = $1",
          [input.idempotencyKey],
        );
        if (prev) return { code: prev.code, status: prev.status, total: prev.total_satang, duplicate: true };
      }

      const p = await loadProperty(tx, input.propertyId);
      validateStay(p, input.checkIn, input.checkOut, actor);
      await expireStaleHolds(tx, tenantId);

      const typeIds = [...new Set(input.rooms.map((r) => r.roomTypeId))];
      const types = new Map(
        (
          await many<RoomTypeRow>(tx, `SELECT ${ROOM_TYPE_COLS} FROM room_types WHERE id = ANY($1::uuid[])`, [typeIds])
        ).map((t) => [t.id, t]),
      );
      const plans = await many<RatePlanRow>(tx, `SELECT ${RATE_PLAN_COLS} FROM rate_plans WHERE property_id = $1 AND is_active`, [p.id]);
      const defaultPlan = plans.find((x) => x.is_default) ?? plans[0];
      const daily = await loadDailyRates(tx, typeIds, input.checkIn, input.checkOut);
      const rules = await loadPriceRules(tx, typeIds, input.checkIn, input.checkOut);

      const priced = input.rooms.map((r) => {
        const t = types.get(r.roomTypeId);
        if (!t || !t.is_active || t.property_id !== p.id) throw new DomainError("NOT_FOUND", "ไม่พบประเภทห้องพักที่เลือก");
        const plan = r.ratePlanId ? plans.find((x) => x.id === r.ratePlanId) : defaultPlan;
        if (!plan) throw new DomainError("NOT_FOUND", "ไม่พบแพ็กเกจราคาที่เลือก");
        try {
          const nights = priceRoom(t, plan, daily.get(t.id) ?? [], input.checkIn, input.checkOut, r, rules.get(t.id) ?? []);
          return { input: r, type: t, plan, nights, amount: sumNights(nights) };
        } catch (e) {
          toDomain(e);
        }
      });
      const subtotal = priced.reduce((s, x) => s + x.amount, 0);
      const tax = computeTax(subtotal, taxOf(p));
      const status: BookingStatus = input.confirmNow ? "confirmed" : "pending_payment";

      const guest = await one<{ id: string }>(
        tx,
        `INSERT INTO guests (tenant_id, full_name, phone, email, note) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, name, phone, input.guest.email?.trim() || null, input.guest.note?.trim() || null],
      );

      let booking: BookingRow | undefined;
      for (let attempt = 0; !booking; attempt++) {
        await tx.query("SAVEPOINT code");
        try {
          booking = await one<BookingRow>(
            tx,
            `INSERT INTO bookings (tenant_id, property_id, code, guest_id, status, source, check_in, check_out,
               adults, children, subtotal_satang, discount_satang, total_satang, special_request, internal_note,
               hold_expires_at, idempotency_key, created_by, tax_inclusive, service_charge_satang, vat_satang)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$17,$12,$13,
               CASE WHEN $5 = 'pending_payment' THEN now() + make_interval(mins => $14::int) END, $15, $16, $18, $19, $20)
             RETURNING id, code, property_id, status, check_in, check_out, version, total_satang, guest_id`,
            [
              tenantId, p.id, newCode(), guest!.id, status, input.source, input.checkIn, input.checkOut,
              input.rooms.reduce((s, r) => s + r.adults, 0), input.rooms.reduce((s, r) => s + r.children, 0),
              subtotal, input.guest.note?.trim() || null, input.internalNote?.trim() || null, p.hold_minutes,
              input.idempotencyKey ?? null, actor.type === "staff" ? actor.userId : null,
              tax.total, p.prices_include_tax, tax.serviceCharge, tax.vat,
            ],
          );
          await tx.query("RELEASE SAVEPOINT code");
        } catch (e) {
          await tx.query("ROLLBACK TO SAVEPOINT code");
          if (pgCode(e) === "23505" && pgConstraint(e) === "bookings_tenant_id_code_key" && attempt < 5) continue;
          throw e;
        }
      }
      const b = booking!;

      for (const x of priced) {
        const br = await one<{ id: string }>(
          tx,
          `INSERT INTO booking_rooms (tenant_id, booking_id, room_type_id, rate_plan_id, room_type_name, rate_plan_name,
             adults, children, extra_beds, amount_satang)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [tenantId, b.id, x.type.id, x.plan.id, x.type.name_th, x.plan.name_th, x.input.adults, x.input.children, x.input.extraBeds, x.amount],
        );
        await tx.query(
          `INSERT INTO booking_nights (tenant_id, booking_room_id, stay_date, room_satang, extras_satang, price_source)
           SELECT $1, $2, d, r, e, s FROM unnest($3::date[], $4::int[], $5::int[], $6::text[]) AS t(d, r, e, s)`,
          [tenantId, br!.id, x.nights.map((n) => n.date), x.nights.map((n) => n.room), x.nights.map((n) => n.extras), x.nights.map((n) => n.source)],
        );
      }

      // the critical step: reserve inventory (fails with SOLD_OUT, rolling back everything above)
      await changeInventory(tx, tenantId, b, null, status);

      await tx.query(
        `INSERT INTO booking_events (tenant_id, booking_id, action, to_status, actor_type, actor_id, data)
         VALUES ($1, $2, 'created', $3, $4, $5, $6)`,
        [tenantId, b.id, status, actor.type, actor.type === "staff" ? actor.userId : null, JSON.stringify({ source: input.source })],
      );
      if (actor.type === "staff") await audit(tx, tenantId, actor, "booking.create", "booking", b.code, { source: input.source, status });
      await enqueue(tx, tenantId, "line", "staff.booking_created", null, {
        code: b.code, guest: name, checkIn: input.checkIn, checkOut: input.checkOut, total: tax.total, source: input.source,
      });
      if (input.guest.email) await enqueue(tx, tenantId, "email", "guest.booking_received", input.guest.email, { code: b.code });

      return { code: b.code, status, total: tax.total, duplicate: false };
    });
  } catch (e) {
    // a concurrent request with the same idempotency key won the race: return its booking
    if (pgCode(e) === "23505" && pgConstraint(e) === "bookings_tenant_id_idempotency_key_key" && input.idempotencyKey) {
      const prev = await withTenant(tenantId, (tx) =>
        one<{ code: string; status: BookingStatus; total_satang: number }>(
          tx,
          "SELECT code, status, total_satang FROM bookings WHERE idempotency_key = $1",
          [input.idempotencyKey],
        ),
      );
      if (prev) return { code: prev.code, status: prev.status, total: prev.total_satang, duplicate: true };
    }
    throw e;
  }
}

// ------------------------------------------------------------- status API --
export type TransitionResult = { status: BookingStatus; pendingApproval?: boolean; requestId?: string };

export async function changeBookingStatus(
  tenantId: string,
  code: string,
  to: BookingStatus,
  actor: Actor,
  opts: { reason?: string | null; expectedVersion?: number; guestPhone?: string } = {},
): Promise<TransitionResult> {
  return withTenant(tenantId, async (tx) => {
    const b = await one<BookingRow & { phone: string }>(
      tx,
      `SELECT b.id, b.code, b.property_id, b.status, b.check_in, b.check_out, b.version, b.total_satang, b.guest_id, g.phone
       FROM bookings b JOIN guests g ON g.id = b.guest_id WHERE b.code = $1 FOR UPDATE OF b`,
      [code.trim().toUpperCase()],
    );
    if (!b) throw new DomainError("NOT_FOUND", "ไม่พบการจองนี้");
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== b.version)
      throw new DomainError("CONFLICT", "ข้อมูลการจองถูกแก้ไขโดยผู้อื่น กรุณาโหลดหน้าใหม่");

    if (actor.type === "guest") {
      if (!opts.guestPhone || normalizePhone(opts.guestPhone) !== b.phone)
        throw new DomainError("FORBIDDEN", "เบอร์โทรศัพท์ไม่ตรงกับข้อมูลการจอง");
      if (to === "cancelled" && b.status !== "pending_payment")
        throw new DomainError("INVALID_TRANSITION", "การจองนี้ไม่สามารถยกเลิกออนไลน์ได้ กรุณาติดต่อรีสอร์ท");
    }

    if (actor.type === "staff") {
      const needsHighPermission = to === "cancelled" && (b.status === "confirmed" || b.status === "checked_in");
      const decision = requireStaff(actor, needsHighPermission ? "booking.cancel_confirmed" : "booking.status");
      if (decision === "approval") {
        if (!canTransition(b.status, to, "staff"))
          throw new DomainError("INVALID_TRANSITION", `ไม่สามารถเปลี่ยนสถานะจาก “${STATUS_LABEL[b.status]}” เป็น “${STATUS_LABEL[to]}” ได้`);
        const { createChangeRequest } = await import("./approvals");
        const requestId = await createChangeRequest(tx, tenantId, actor, {
          kind: "booking.status",
          entityId: b.code,
          summary: `ยกเลิกการจอง ${b.code} (สถานะ ${STATUS_LABEL[b.status]})${opts.reason ? ` เหตุผล: ${opts.reason}` : ""}`,
          payload: { code: b.code, to, reason: opts.reason ?? null, expectedVersion: b.version },
        });
        return { status: b.status, pendingApproval: true, requestId };
      }
    }

    await applyTransition(tx, tenantId, b, to, actor, { reason: opts.reason });
    return { status: to };
  });
}

/** Used by the approvals module after an owner approves a queued change. */
export async function applyApprovedStatusChange(
  tx: Tx,
  tenantId: string,
  payload: { code: string; to: BookingStatus; reason: string | null; expectedVersion: number },
  approver: Actor,
) {
  const b = await one<BookingRow>(
    tx,
    `SELECT id, code, property_id, status, check_in, check_out, version, total_satang, guest_id FROM bookings WHERE code = $1 FOR UPDATE`,
    [payload.code],
  );
  if (!b) throw new DomainError("NOT_FOUND", "ไม่พบการจองนี้");
  if (b.version !== payload.expectedVersion)
    throw new DomainError("CONFLICT", "การจองถูกเปลี่ยนแปลงหลังจากส่งคำขอ กรุณาตรวจสอบและส่งคำขอใหม่");
  await applyTransition(tx, tenantId, b, payload.to, approver, { reason: payload.reason });
}

// ---------------------------------------------------------- room assignment --
export async function assignRoom(tenantId: string, bookingRoomId: string, roomId: string | null, actor: Actor) {
  requireStaff(actor, "booking.assign_room");
  return withTenant(tenantId, async (tx) => {
    const br = await one<{ id: string; room_type_id: string; status: BookingStatus; check_in: string; check_out: string; code: string; timezone: string }>(
      tx,
      `SELECT br.id, br.room_type_id, b.status, b.check_in, b.check_out, b.code, p.timezone
       FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id JOIN properties p ON p.id = b.property_id
       WHERE br.id = $1 FOR UPDATE OF b`,
      [bookingRoomId],
    );
    if (!br) throw new DomainError("NOT_FOUND", "ไม่พบรายการห้องในการจอง");
    if (!["pending_payment", "payment_review", "confirmed", "checked_in"].includes(br.status))
      throw new DomainError("VALIDATION", "จัดห้องได้เฉพาะการจองที่ยังใช้งานอยู่");

    // A guest already in house moves from today: the nights already slept stay with the old room.
    const inHouse = br.status === "checked_in";
    const today = todayIn(br.timezone);
    const from = inHouse && today > br.check_in ? today : br.check_in;
    if (inHouse && from >= br.check_out)
      throw new DomainError("VALIDATION", "เลยวันเช็คเอาท์แล้ว กรุณาเช็คเอาท์หรือขยายวันพักก่อนย้ายห้อง");

    const current = await one<{ room_id: string }>(tx, "SELECT room_id FROM room_assignments WHERE booking_room_id = $1 AND active", [bookingRoomId]);
    if ((current?.room_id ?? null) === roomId) return; // nothing changed

    const prev = await one<{ room_id: string }>(
      tx, "UPDATE room_assignments SET active = false WHERE booking_room_id = $1 AND active RETURNING room_id", [bookingRoomId]);
    if (inHouse && prev && prev.room_id !== roomId)
      await tx.query("UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = $1", [prev.room_id]);
    if (roomId) {
      // Lock the physical room first: concurrent assignments of the same room queue here, so the
      // exclusion constraint reports a clean conflict instead of PostgreSQL resolving a deadlock.
      const room = await one<{ room_type_id: string; status: string; room_number: string }>(
        tx,
        "SELECT room_type_id, status, room_number FROM rooms WHERE id = $1 FOR UPDATE",
        [roomId],
      );
      if (!room) throw new DomainError("NOT_FOUND", "ไม่พบห้องนี้");
      if (room.room_type_id !== br.room_type_id) throw new DomainError("VALIDATION", "ห้องที่เลือกไม่ตรงกับประเภทห้องที่จอง");
      if (room.status !== "active") throw new DomainError("VALIDATION", `ห้อง ${room.room_number} ปิดใช้งานหรืออยู่ระหว่างซ่อม`);
      try {
        await tx.query("SAVEPOINT assign");
        await tx.query(
          `INSERT INTO room_assignments (tenant_id, booking_room_id, room_id, stay, assigned_by)
           VALUES ($1, $2, $3, daterange($4::date, $5::date, '[)'), $6)`,
          [tenantId, bookingRoomId, roomId, from, br.check_out, actor.type === "staff" ? actor.userId : null],
        );
        await tx.query("RELEASE SAVEPOINT assign");
      } catch (e) {
        await tx.query("ROLLBACK TO SAVEPOINT assign");
        if (pgCode(e) === "23P01") throw new DomainError("ROOM_TAKEN", `ห้อง ${room.room_number} มีผู้เข้าพักในช่วงวันที่ทับซ้อนกันแล้ว`);
        throw e;
      }
      await audit(tx, tenantId, actor, "booking.assign_room", "booking", br.code, { room: room.room_number, from, moved: inHouse && !!prev });
    } else {
      await audit(tx, tenantId, actor, "booking.unassign_room", "booking", br.code);
    }
  });
}

/** Physical rooms of the booked type, with whether each is free for the stay (for the assign dropdown). */
export async function assignableRooms(tenantId: string, bookingRoomId: string) {
  return withTenant(tenantId, (tx) =>
    many<{ id: string; room_number: string; housekeeping_status: string; free: boolean }>(
      tx,
      `SELECT r.id, r.room_number, r.housekeeping_status,
              NOT EXISTS (
                SELECT 1 FROM room_assignments ra
                WHERE ra.room_id = r.id AND ra.active AND ra.booking_room_id <> br.id
                  AND ra.stay && daterange(
                    CASE WHEN b.status = 'checked_in'
                      THEN LEAST(GREATEST(b.check_in, (now() AT TIME ZONE p.timezone)::date), b.check_out)
                      ELSE b.check_in END,
                    b.check_out, '[)')
              ) AS free
       FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id JOIN properties p ON p.id = b.property_id
       JOIN rooms r ON r.room_type_id = br.room_type_id AND r.status = 'active'
       WHERE br.id = $1 ORDER BY r.room_number`,
      [bookingRoomId],
    ),
  );
}

// ------------------------------------------------------------------ queries --
export type BookingDetail = Awaited<ReturnType<typeof getBooking>>;

export async function getBooking(tenantId: string, code: string) {
  return withTenant(tenantId, async (tx) => {
    const b = await one<{
      id: string; code: string; status: BookingStatus; source: string; check_in: string; check_out: string;
      adults: number; children: number; subtotal_satang: number; discount_satang: number; total_satang: number;
      special_request: string | null; internal_note: string | null; hold_expires_at: Date | null; cancelled_by: string | null;
      cancel_reason: string | null; version: number; created_at: Date; property_id: string;
      guest_name: string; guest_phone: string; guest_email: string | null;
      tax_inclusive: boolean; service_charge_satang: number; vat_satang: number; timezone: string;
    }>(
      tx,
      `SELECT b.id, b.code, b.status, b.source, b.check_in, b.check_out, b.adults, b.children, b.subtotal_satang,
              b.tax_inclusive, b.service_charge_satang, b.vat_satang,
              b.discount_satang, b.total_satang, b.special_request, b.internal_note, b.hold_expires_at, b.cancelled_by,
              b.cancel_reason, b.version, b.created_at, b.property_id,
              g.full_name AS guest_name, g.phone AS guest_phone, g.email AS guest_email, p.timezone
       FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN properties p ON p.id = b.property_id WHERE b.code = $1`,
      [code.trim().toUpperCase()],
    );
    if (!b) return null;
    const rooms = await many<{
      id: string; room_type_id: string; room_type_name: string; rate_plan_name: string; adults: number; children: number;
      extra_beds: number; amount_satang: number; room_id: string | null; room_number: string | null;
    }>(
      tx,
      `SELECT br.id, br.room_type_id, br.room_type_name, br.rate_plan_name, br.adults, br.children, br.extra_beds, br.amount_satang,
              ra.room_id, r.room_number
       FROM booking_rooms br
       LEFT JOIN room_assignments ra ON ra.booking_room_id = br.id AND ra.active
       LEFT JOIN rooms r ON r.id = ra.room_id
       WHERE br.booking_id = $1 ORDER BY br.room_type_name, br.id`,
      [b.id],
    );
    const events = await many<{ action: string; from_status: string | null; to_status: string | null; actor_type: string; actor_name: string | null; data: Record<string, unknown> | null; created_at: Date }>(
      tx,
      `SELECT e.action, e.from_status, e.to_status, e.actor_type, u.name AS actor_name, e.data, e.created_at
       FROM booking_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.booking_id = $1 ORDER BY e.created_at`,
      [b.id],
    );
    return { ...b, nights: nightsBetween(b.check_in, b.check_out), today: todayIn(b.timezone), rooms, events };
  });
}

export async function listBookings(
  tenantId: string,
  f: { status?: BookingStatus | "active" | "all"; q?: string; arrivalFrom?: string; arrivalTo?: string; limit?: number; offset?: number },
) {
  return withTenant(tenantId, async (tx) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.status === "active") where.push(`b.status IN ('pending_payment','payment_review','confirmed','checked_in')`);
    else if (f.status && f.status !== "all") where.push(`b.status = ${p(f.status)}`);
    if (f.q) {
      const q = f.q.trim();
      where.push(`(b.code ILIKE ${p(`%${q}%`)} OR g.full_name ILIKE ${p(`%${q}%`)} OR g.phone LIKE ${p(`%${q.replace(/\D/g, "") || q}%`)})`);
    }
    if (f.arrivalFrom) where.push(`b.check_in >= ${p(f.arrivalFrom)}`);
    if (f.arrivalTo) where.push(`b.check_in <= ${p(f.arrivalTo)}`);
    const sql = `SELECT b.code, b.status, b.source, b.check_in, b.check_out, b.adults, b.children, b.total_satang,
                        b.hold_expires_at, b.created_at, g.full_name AS guest_name, g.phone AS guest_phone,
                        (SELECT string_agg(DISTINCT br.room_type_name, ', ') FROM booking_rooms br WHERE br.booking_id = b.id) AS room_types,
                        (SELECT count(*)::int FROM booking_rooms br WHERE br.booking_id = b.id) AS room_count
                 FROM bookings b JOIN guests g ON g.id = b.guest_id
                 ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY b.created_at DESC LIMIT ${p(Math.min(f.limit ?? 50, 200))} OFFSET ${p(f.offset ?? 0)}`;
    return many<{
      code: string; status: BookingStatus; source: string; check_in: string; check_out: string; adults: number; children: number;
      total_satang: number; hold_expires_at: Date | null; created_at: Date; guest_name: string; guest_phone: string;
      room_types: string; room_count: number;
    }>(tx, sql, params);
  });
}

/** Calendar grid: per room type per day -> sellable / held / sold / closed / price. */
export async function getCalendar(tenantId: string, propertyId: string, from: string, days: number) {
  const to = addDays(from, days);
  return withTenant(tenantId, async (tx) => {
    await expireStaleHolds(tx, tenantId);
    const types = await many<{ id: string; name_th: string; code: string; base_price_satang: number; active_rooms: number; out_of_order: number }>(
      tx,
      `SELECT t.id, t.name_th, t.code, t.base_price_satang,
              (SELECT count(*)::int FROM rooms r WHERE r.room_type_id = t.id AND r.status = 'active') AS active_rooms,
              (SELECT count(*)::int FROM rooms r WHERE r.room_type_id = t.id AND r.status = 'maintenance') AS out_of_order
       FROM room_types t WHERE t.property_id = $1 AND t.is_active ORDER BY t.sort_order, t.name_th`,
      [propertyId],
    );
    const rules = await loadPriceRules(tx, types.map((t) => t.id), from, to);
    const cells = await many<{ room_type_id: string; stay_date: string; total: number | null; held: number | null; sold: number | null; price_satang: number | null; is_closed: boolean | null; min_nights: number | null }>(
      tx,
      `SELECT t.id AS room_type_id, d::date::text AS stay_date, i.total, i.held, i.sold, dr.price_satang, dr.is_closed, dr.min_nights
       FROM room_types t
       CROSS JOIN generate_series($2::date, $3::date - 1, interval '1 day') AS d
       LEFT JOIN inventory_nights i ON i.room_type_id = t.id AND i.stay_date = d::date
       LEFT JOIN daily_rates dr ON dr.room_type_id = t.id AND dr.stay_date = d::date
       WHERE t.property_id = $1 AND t.is_active`,
      [propertyId, from, to],
    );
    return types.map((t) => ({
      ...t,
      days: cells
        .filter((c) => c.room_type_id === t.id)
        .sort((a, b) => a.stay_date.localeCompare(b.stay_date))
        .map((c) => {
          // `total` = sellable rooms (active units). Out-of-order units are already excluded from it,
          // so they are reported separately and never subtracted twice (Addendum Part 3).
          const total = c.total ?? t.active_rooms;
          const held = c.held ?? 0;
          const sold = c.sold ?? 0;
          const resolved = resolveNightPrice(t.base_price_satang, c.stay_date,
            c.price_satang !== null ? { stay_date: c.stay_date, price_satang: c.price_satang, is_closed: false, min_nights: null } : undefined,
            rules.get(t.id) ?? []);
          return {
            date: c.stay_date,
            physical: total + t.out_of_order,
            outOfOrder: t.out_of_order,
            total,
            held,
            sold,
            free: Math.max(0, total - held - sold),
            closed: !!c.is_closed,
            price: resolved.price,
            priceSource: resolved.label,
            priceOverridden: c.price_satang !== null,
            minNights: c.min_nights,
          };
        }),
    }));
  });
}
