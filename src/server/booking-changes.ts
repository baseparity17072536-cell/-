import "server-only";
import { addDays, formatThaiDate, isIsoDate, nightsBetween, todayIn } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { audit, enqueue, type Actor } from "./audit";
import {
  loadDailyRates, loadPriceRules, loadProperty, normalizePhone, RATE_PLAN_COLS, requireStaff, ROOM_TYPE_COLS,
  type RatePlanRow, type RoomTypeRow,
} from "./booking";
import { BUCKET, type BookingStatus } from "./booking-status";
import { many, one, withTenant, type Tx } from "./db";
import { DomainError, pgCode } from "./errors";
import { applyInventoryDelta } from "./inventory";
import {
  computeTax, priceRoom, PricingError, stayDates, validateOccupancy, type DailyRate, type NightPrice, type PriceRule,
} from "./pricing";

// Changes to an existing booking (Phase 3): stay dates, room type, guest details.
// Prices are always calculated by the system: nights already booked keep the price agreed at
// booking time, only nights that are new to the booking are priced at today's rates.

const BEFORE_ARRIVAL: BookingStatus[] = ["pending_payment", "payment_review", "confirmed"];
const LIVE: BookingStatus[] = [...BEFORE_ARRIVAL, "checked_in"];

type Locked = {
  id: string; code: string; property_id: string; status: BookingStatus; check_in: string; check_out: string;
  version: number; subtotal_satang: number; discount_satang: number; total_satang: number; tax_inclusive: boolean;
  guest_id: string; guest_email: string | null;
};

async function lockBooking(tx: Tx, where: string, param: string, expectedVersion?: number) {
  const b = await one<Locked>(
    tx,
    `SELECT b.id, b.code, b.property_id, b.status, b.check_in, b.check_out, b.version, b.subtotal_satang,
            b.discount_satang, b.total_satang, b.tax_inclusive, b.guest_id, g.email AS guest_email
     FROM bookings b JOIN guests g ON g.id = b.guest_id WHERE ${where} FOR UPDATE OF b`,
    [param],
  );
  if (!b) throw new DomainError("NOT_FOUND", "ไม่พบการจองนี้");
  if (expectedVersion !== undefined && expectedVersion !== b.version)
    throw new DomainError("CONFLICT", "ข้อมูลการจองถูกแก้ไขโดยผู้อื่น กรุณาโหลดหน้าใหม่");
  return b;
}

/** Staff changes skip the minimum-stay rule (it is a sales rule for new bookings), but never closed nights. */
function priceNight(rt: RoomTypeRow, plan: RatePlanRow, daily: DailyRate[], rules: PriceRule[], date: string,
  o: { adults: number; children: number; extraBeds: number }): NightPrice {
  try {
    const d = daily.filter((x) => x.stay_date === date).map((x) => ({ ...x, min_nights: null }));
    return priceRoom(rt, { ...plan, min_nights: 1 }, d, date, addDays(date, 1), o, rules)[0];
  } catch (e) {
    if (e instanceof PricingError) throw new DomainError(e.code, e.message);
    throw e;
  }
}

async function replaceNights(tx: Tx, tenantId: string, bookingRoomId: string, nights: NightPrice[]) {
  await tx.query("DELETE FROM booking_nights WHERE booking_room_id = $1", [bookingRoomId]);
  await tx.query(
    `INSERT INTO booking_nights (tenant_id, booking_room_id, stay_date, room_satang, extras_satang, price_source)
     SELECT $1, $2, d, r, e, s FROM unnest($3::date[], $4::int[], $5::int[], $6::text[]) AS t(d, r, e, s)`,
    [tenantId, bookingRoomId, nights.map((n) => n.date), nights.map((n) => n.room), nights.map((n) => n.extras), nights.map((n) => n.source)],
  );
  const amount = nights.reduce((s, n) => s + n.room + n.extras, 0);
  await tx.query("UPDATE booking_rooms SET amount_satang = $2 WHERE id = $1", [bookingRoomId, amount]);
}

/** Recompute subtotal/tax/total from the rooms, keeping the booking's own tax-inclusive snapshot. */
async function recalcTotals(tx: Tx, b: Locked) {
  const p = await loadProperty(tx, b.property_id);
  const subtotal = (await one<{ s: number }>(tx, "SELECT COALESCE(sum(amount_satang),0)::int AS s FROM booking_rooms WHERE booking_id = $1", [b.id]))!.s;
  const discount = Math.min(b.discount_satang, subtotal);
  const t = computeTax(subtotal - discount, { inclusive: b.tax_inclusive, vatBp: p.vat_bp, serviceChargeBp: p.service_charge_bp });
  await tx.query(
    `UPDATE bookings SET subtotal_satang = $2, discount_satang = $3, service_charge_satang = $4, vat_satang = $5, total_satang = $6
     WHERE id = $1`,
    [b.id, subtotal, discount, t.serviceCharge, t.vat, t.total],
  );
  return t.total;
}

async function logChange(tx: Tx, tenantId: string, b: Locked, actor: Actor, action: string, data: Record<string, unknown>) {
  await tx.query("UPDATE bookings SET version = version + 1, updated_at = now() WHERE id = $1", [b.id]);
  await tx.query(
    `INSERT INTO booking_events (tenant_id, booking_id, action, actor_type, actor_id, data) VALUES ($1, $2, $3, 'staff', $4, $5)`,
    [tenantId, b.id, action, actor.type === "staff" ? actor.userId : null, JSON.stringify(data)],
  );
  await audit(tx, tenantId, actor, `booking.${action}`, "booking", b.code, data);
  await enqueue(tx, tenantId, "line", "staff.booking_changed", null, { code: b.code, action, ...data });
}

/** Human readable result for the staff member, including what to collect or refund. */
export function totalChangeMessage(before: number, after: number) {
  if (after === before) return `ยอดรวมเท่าเดิม ${formatSatang(after)}`;
  return `ยอดรวมใหม่ ${formatSatang(after)} (${after > before ? "เพิ่มขึ้น" : "ลดลง"} ${formatSatang(Math.abs(after - before))})`;
}

// ------------------------------------------------------------------ dates --
export async function changeStayDates(
  tenantId: string,
  code: string,
  input: { checkIn: string; checkOut: string },
  actor: Actor,
  opts: { expectedVersion?: number } = {},
) {
  requireStaff(actor, "booking.modify");
  const { checkIn, checkOut } = input;
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) throw new DomainError("VALIDATION", "กรุณาเลือกวันเช็คอินและวันเช็คเอาท์");

  return withTenant(tenantId, async (tx) => {
    const b = await lockBooking(tx, "b.code = $1", code.trim().toUpperCase(), opts.expectedVersion);
    if (!LIVE.includes(b.status)) throw new DomainError("VALIDATION", "แก้ไขวันที่ได้เฉพาะการจองที่ยังไม่เช็คเอาท์ ยกเลิก หรือหมดอายุ");
    const p = await loadProperty(tx, b.property_id);
    const today = todayIn(p.timezone);
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1) throw new DomainError("VALIDATION", "วันเช็คเอาท์ต้องอยู่หลังวันเช็คอิน");
    if (nights > p.max_nights) throw new DomainError("VALIDATION", `จองได้สูงสุด ${p.max_nights} คืนต่อการจอง`);
    if (b.status === "checked_in") {
      if (checkIn !== b.check_in) throw new DomainError("VALIDATION", "ผู้เข้าพักเช็คอินแล้ว เปลี่ยนได้เฉพาะวันเช็คเอาท์");
      if (checkOut < today) throw new DomainError("VALIDATION", "วันเช็คเอาท์ต้องไม่ก่อนวันนี้");
    } else if (checkIn < today && checkIn !== b.check_in) {
      throw new DomainError("VALIDATION", "วันเช็คอินต้องไม่เป็นวันที่ผ่านมาแล้ว");
    }
    if (checkIn === b.check_in && checkOut === b.check_out) throw new DomainError("VALIDATION", "วันที่ยังเหมือนเดิม ไม่มีอะไรเปลี่ยน");

    const rooms = await many<{ id: string; room_type_id: string; rate_plan_id: string; adults: number; children: number; extra_beds: number }>(
      tx, "SELECT id, room_type_id, rate_plan_id, adults, children, extra_beds FROM booking_rooms WHERE booking_id = $1 ORDER BY room_type_id, id", [b.id]);

    // 1. inventory: give back the old nights, then take the new ones (the CHECK constraint rejects overbooking)
    const bucket = BUCKET[b.status]!;
    const perType = new Map<string, number>();
    for (const r of rooms) perType.set(r.room_type_id, (perType.get(r.room_type_id) ?? 0) + 1);
    for (const [typeId, n] of perType) await applyInventoryDelta(tx, tenantId, typeId, b.check_in, b.check_out, { held: 0, sold: 0, [bucket]: -n });
    for (const [typeId, n] of perType) await applyInventoryDelta(tx, tenantId, typeId, checkIn, checkOut, { held: 0, sold: 0, [bucket]: n });

    // 2. prices: keep booked nights, price only the new ones
    const typeIds = [...perType.keys()];
    const types = new Map((await many<RoomTypeRow>(tx, `SELECT ${ROOM_TYPE_COLS} FROM room_types WHERE id = ANY($1::uuid[])`, [typeIds])).map((t) => [t.id, t]));
    const planIds = [...new Set(rooms.map((r) => r.rate_plan_id))];
    const plans = new Map((await many<RatePlanRow>(tx, `SELECT ${RATE_PLAN_COLS} FROM rate_plans WHERE id = ANY($1::uuid[])`, [planIds])).map((x) => [x.id, x]));
    const daily = await loadDailyRates(tx, typeIds, checkIn, checkOut);
    const rules = await loadPriceRules(tx, typeIds, checkIn, checkOut);
    const dates = stayDates(checkIn, checkOut);
    for (const r of rooms) {
      const kept = new Map(
        (await many<{ stay_date: string; room_satang: number; extras_satang: number; price_source: string }>(
          tx, "SELECT stay_date, room_satang, extras_satang, price_source FROM booking_nights WHERE booking_room_id = $1", [r.id],
        )).map((n) => [n.stay_date, n]),
      );
      const nightsNew = dates.map((date): NightPrice => {
        const k = kept.get(date);
        if (k) return { date, room: k.room_satang, extras: k.extras_satang, source: k.price_source as NightPrice["source"], sourceLabel: "" };
        return priceNight(types.get(r.room_type_id)!, plans.get(r.rate_plan_id)!, daily.get(r.room_type_id) ?? [], rules.get(r.room_type_id) ?? [], date,
          { adults: r.adults, children: r.children, extraBeds: r.extra_beds });
      });
      await replaceNights(tx, tenantId, r.id, nightsNew);
    }

    // 3. physical rooms follow the new dates; a guest in house keeps the date they moved in
    const assigned = await many<{ id: string; room_number: string; lower: string }>(
      tx,
      `SELECT ra.id, rm.room_number, lower(ra.stay)::text AS lower FROM room_assignments ra
       JOIN booking_rooms br ON br.id = ra.booking_room_id JOIN rooms rm ON rm.id = ra.room_id
       WHERE br.booking_id = $1 AND ra.active ORDER BY rm.room_number`,
      [b.id],
    );
    const unassigned: string[] = [];
    for (const a of assigned) {
      const from = b.status === "checked_in" ? a.lower : checkIn;
      if (from >= checkOut)
        throw new DomainError("VALIDATION", `ผู้เข้าพักย้ายเข้าห้อง ${a.room_number} วันที่ ${formatThaiDate(from)} วันเช็คเอาท์ต้องหลังจากวันนั้น`);
      try {
        await tx.query("SAVEPOINT stay");
        await tx.query("UPDATE room_assignments SET stay = daterange($2::date, $3::date, '[)') WHERE id = $1", [a.id, from, checkOut]);
        await tx.query("RELEASE SAVEPOINT stay");
      } catch (e) {
        await tx.query("ROLLBACK TO SAVEPOINT stay");
        if (pgCode(e) !== "23P01") throw e;
        if (b.status === "checked_in")
          throw new DomainError("ROOM_TAKEN", `ห้อง ${a.room_number} มีผู้จองต่อในช่วงวันที่ขยาย กรุณาย้ายห้องก่อนขยายวันพัก`);
        await tx.query("UPDATE room_assignments SET active = false WHERE id = $1", [a.id]);
        unassigned.push(a.room_number);
      }
    }

    await tx.query("UPDATE bookings SET check_in = $2, check_out = $3 WHERE id = $1", [b.id, checkIn, checkOut]);
    const total = await recalcTotals(tx, b);
    await logChange(tx, tenantId, b, actor, "dates_changed", {
      from: { check_in: b.check_in, check_out: b.check_out }, to: { check_in: checkIn, check_out: checkOut },
      total_before: b.total_satang, total_after: total, unassigned,
    });
    return { totalBefore: b.total_satang, totalAfter: total, unassigned };
  });
}

// -------------------------------------------------------------- room type --
export async function changeRoomType(
  tenantId: string,
  bookingRoomId: string,
  roomTypeId: string,
  actor: Actor,
  opts: { keepPrice: boolean; expectedVersion?: number },
) {
  requireStaff(actor, "booking.modify");
  return withTenant(tenantId, async (tx) => {
    const b = await lockBooking(tx, "b.id = (SELECT booking_id FROM booking_rooms WHERE id = $1)", bookingRoomId, opts.expectedVersion);
    if (!BEFORE_ARRIVAL.includes(b.status))
      throw new DomainError("VALIDATION", b.status === "checked_in"
        ? "ผู้เข้าพักเช็คอินแล้ว ใช้การเลือกเลขห้องเพื่อย้ายห้องแทน (เปลี่ยนประเภทห้องได้ก่อนเช็คอินเท่านั้น)"
        : "เปลี่ยนประเภทห้องได้เฉพาะการจองที่ยังใช้งานอยู่");
    const br = (await one<{ id: string; room_type_id: string; room_type_name: string; rate_plan_id: string; adults: number; children: number; extra_beds: number; amount_satang: number }>(
      tx, "SELECT id, room_type_id, room_type_name, rate_plan_id, adults, children, extra_beds, amount_satang FROM booking_rooms WHERE id = $1", [bookingRoomId]))!;
    if (br.room_type_id === roomTypeId) throw new DomainError("VALIDATION", "เป็นประเภทห้องเดิมอยู่แล้ว");

    const t = await one<RoomTypeRow>(tx, `SELECT ${ROOM_TYPE_COLS} FROM room_types WHERE id = $1`, [roomTypeId]);
    if (!t || !t.is_active || t.property_id !== b.property_id) throw new DomainError("NOT_FOUND", "ไม่พบประเภทห้องที่เลือก");
    const o = { adults: br.adults, children: br.children, extraBeds: br.extra_beds };
    try {
      validateOccupancy(t, o);
    } catch (e) {
      if (e instanceof PricingError) throw new DomainError(e.code, e.message);
      throw e;
    }

    // inventory: always lock the two types in the same order so two changes cannot deadlock
    const bucket = BUCKET[b.status]!;
    const moves = [
      { typeId: br.room_type_id, n: -1 },
      { typeId: roomTypeId, n: 1 },
    ].sort((x, y) => x.typeId.localeCompare(y.typeId));
    for (const m of moves) await applyInventoryDelta(tx, tenantId, m.typeId, b.check_in, b.check_out, { held: 0, sold: 0, [bucket]: m.n });

    if (!opts.keepPrice) {
      const plan = (await one<RatePlanRow>(tx, `SELECT ${RATE_PLAN_COLS} FROM rate_plans WHERE id = $1`, [br.rate_plan_id]))!;
      const daily = (await loadDailyRates(tx, [t.id], b.check_in, b.check_out)).get(t.id) ?? [];
      const rules = (await loadPriceRules(tx, [t.id], b.check_in, b.check_out)).get(t.id) ?? [];
      await replaceNights(tx, tenantId, br.id, stayDates(b.check_in, b.check_out).map((d) => priceNight(t, plan, daily, rules, d, o)));
    }
    // the old physical room is of the wrong type now
    await tx.query("UPDATE room_assignments SET active = false WHERE booking_room_id = $1 AND active", [br.id]);
    await tx.query("UPDATE booking_rooms SET room_type_id = $2, room_type_name = $3 WHERE id = $1", [br.id, t.id, t.name_th]);
    const total = opts.keepPrice ? b.total_satang : await recalcTotals(tx, b);
    await logChange(tx, tenantId, b, actor, "room_type_changed", {
      from: br.room_type_name, to: t.name_th, keep_price: opts.keepPrice, total_before: b.total_satang, total_after: total,
    });
    return { code: b.code, totalBefore: b.total_satang, totalAfter: total };
  });
}

// ---------------------------------------------------------- guest details --
export type GuestDetailsInput = {
  name: string; phone: string; email: string | null; specialRequest: string | null; internalNote: string | null;
};

export async function updateBookingDetails(
  tenantId: string,
  code: string,
  input: GuestDetailsInput,
  actor: Actor,
  opts: { expectedVersion?: number } = {},
) {
  requireStaff(actor, "booking.modify");
  const name = input.name.trim();
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim() || null;
  if (name.length < 2) throw new DomainError("VALIDATION", "กรุณากรอกชื่อ-นามสกุล");
  if (phone.length < 9 || phone.length > 15) throw new DomainError("VALIDATION", "เบอร์โทรศัพท์ไม่ถูกต้อง");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("VALIDATION", "อีเมลไม่ถูกต้อง");

  return withTenant(tenantId, async (tx) => {
    const b = await lockBooking(tx, "b.code = $1", code.trim().toUpperCase(), opts.expectedVersion);
    const before = (await one<{ name: string; phone: string; email: string | null; special_request: string | null; internal_note: string | null }>(
      tx,
      `SELECT g.full_name AS name, g.phone, g.email::text AS email, b.special_request, b.internal_note
       FROM bookings b JOIN guests g ON g.id = b.guest_id WHERE b.id = $1`,
      [b.id],
    ))!;
    const after = { name, phone, email, special_request: input.specialRequest?.trim() || null, internal_note: input.internalNote?.trim() || null };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => (before[k] ?? null) !== after[k]);
    if (!changed.length) return { changed };

    await tx.query("UPDATE guests SET full_name = $2, phone = $3, email = $4, updated_at = now() WHERE id = $1", [b.guest_id, name, phone, email]);
    await tx.query("UPDATE bookings SET special_request = $2, internal_note = $3 WHERE id = $1", [b.id, after.special_request, after.internal_note]);
    await logChange(tx, tenantId, b, actor, "details_updated", {
      fields: changed, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
    });
    return { changed };
  });
}
