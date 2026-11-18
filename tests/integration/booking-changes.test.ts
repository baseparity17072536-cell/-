import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayInBangkok } from "@/lib/dates";
import type { Actor } from "@/server/audit";
import { assignRoom, changeBookingStatus, createBooking, getBooking } from "@/server/booking";
import { changeRoomType, changeStayDates, updateBookingDetails } from "@/server/booking-changes";
import { admin, closePools, fahtalay, guest, staff, stay, useAppPool, useDateBase } from "../setup/helpers";

// Phase 3: changing an existing booking (dates, room type, guest details), no-show and room moves.

let ctx: Awaited<ReturnType<typeof fahtalay>>;
let fd: Actor & { type: "staff" };
let deluxe: string;
let other: string; // a second room type that also fits 2 adults
let smallest: { id: string; rooms: number }; // type with the fewest rooms (easy to sell out)

beforeAll(async () => {
  useAppPool();
  useDateBase(300);
  ctx = await fahtalay();
  fd = await staff(ctx.tenantId, "front_desk");
  deluxe = ctx.types["deluxe-sea-view"];
  const types = (await admin().query(
    `SELECT t.id, t.max_adults, (SELECT count(*)::int FROM rooms r WHERE r.room_type_id = t.id AND r.status = 'active') AS rooms
     FROM room_types t WHERE t.tenant_id = $1 AND t.is_active ORDER BY rooms, t.sort_order`, [ctx.tenantId])).rows;
  other = types.find((t) => t.id !== deluxe && t.max_adults >= 2).id;
  smallest = { id: types[0].id, rooms: types[0].rooms };
});
afterAll(closePools);

const room = (roomTypeId = deluxe, adults = 2) => ({ roomTypeId, adults, children: 0, extraBeds: 0 });
const book = (checkIn: string, checkOut: string, roomTypeId = deluxe, n = 1) =>
  createBooking(ctx.tenantId, { propertyId: ctx.propertyId, checkIn, checkOut, rooms: Array.from({ length: n }, () => room(roomTypeId, 1)), guest, source: "phone", confirmNow: true }, fd);
const inv = async (typeId: string, date: string) =>
  (await admin().query("SELECT held, sold FROM inventory_nights WHERE room_type_id = $1 AND stay_date = $2", [typeId, date])).rows[0] ?? { held: 0, sold: 0 };
const nights = async (code: string) =>
  (await admin().query(
    `SELECT bn.stay_date::text AS d, bn.room_satang AS p FROM booking_nights bn JOIN booking_rooms br ON br.id = bn.booking_room_id
     JOIN bookings b ON b.id = br.booking_id WHERE b.code = $1 ORDER BY 1`, [code])).rows as { d: string; p: number }[];
const assignment = async (code: string) =>
  (await admin().query(
    `SELECT ra.room_id, lower(ra.stay)::text AS lo, upper(ra.stay)::text AS hi FROM room_assignments ra
     JOIN booking_rooms br ON br.id = ra.booking_room_id JOIN bookings b ON b.id = br.booking_id WHERE b.code = $1 AND ra.active`, [code])).rows[0];
async function freeRoom(typeId: string, checkIn: string, checkOut: string, exclude: string[] = []) {
  return (await admin().query(
    `SELECT r.id, r.room_number FROM rooms r WHERE r.room_type_id = $1 AND r.status = 'active' AND NOT (r.id = ANY($4::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id = r.id AND ra.active AND ra.stay && daterange($2::date, $3::date))
     ORDER BY r.room_number LIMIT 1`, [typeId, checkIn, checkOut, exclude])).rows[0] as { id: string; room_number: string };
}
async function bookAndAssign(checkIn: string, checkOut: string, roomId?: string) {
  const b = await book(checkIn, checkOut);
  const d = (await getBooking(ctx.tenantId, b.code))!;
  const r = roomId ?? (await freeRoom(deluxe, checkIn, checkOut)).id;
  await assignRoom(ctx.tenantId, d.rooms[0].id, r, fd);
  return { code: b.code, roomId: r, bookingRoomId: d.rooms[0].id };
}

describe("change stay dates", () => {
  it("extending keeps the agreed price of booked nights, prices the new night today and moves inventory", async () => {
    const s = stay(4);
    const out = addDays(s.checkIn, 2);
    const b = await book(s.checkIn, out);
    // the price agreed at booking time differs from today's rate; the new night has a special daily price
    await admin().query("UPDATE booking_nights SET room_satang = 99900 WHERE stay_date = $1 AND booking_room_id IN (SELECT br.id FROM booking_rooms br JOIN bookings x ON x.id = br.booking_id WHERE x.code = $2)", [s.checkIn, b.code]);
    await admin().query("INSERT INTO daily_rates (tenant_id, room_type_id, stay_date, price_satang) VALUES ($1, $2, $3, 123400)", [ctx.tenantId, deluxe, out]);
    const before = await inv(deluxe, out);
    const v = (await getBooking(ctx.tenantId, b.code))!.version;

    const r = await changeStayDates(ctx.tenantId, b.code, { checkIn: s.checkIn, checkOut: addDays(out, 1) }, fd, { expectedVersion: v });
    const n = await nights(b.code);
    expect(n.map((x) => x.d)).toEqual([s.checkIn, addDays(s.checkIn, 1), out]);
    expect(n[0].p).toBe(99900);
    expect(n[2].p).toBe(123400);
    const after = (await getBooking(ctx.tenantId, b.code))!;
    expect(after.subtotal_satang).toBe(n.reduce((a, x) => a + x.p, 0));
    expect(r.totalAfter).toBe(after.total_satang);
    expect(after.version).toBe(v + 1);
    expect(after.events.at(-1)!.action).toBe("dates_changed");
    expect((await inv(deluxe, out)).sold).toBe(before.sold + 1);
    // a second edit with the old version is rejected
    await expect(changeStayDates(ctx.tenantId, b.code, { checkIn: s.checkIn, checkOut: out }, fd, { expectedVersion: v })).rejects.toThrow(/ถูกแก้ไขโดยผู้อื่น/);
  });

  it("shortening releases nights and the assigned room follows; a taken room is unassigned", async () => {
    const s = stay(4);
    const a = await bookAndAssign(s.checkIn, addDays(s.checkIn, 2));
    const night2 = addDays(s.checkIn, 1);
    const sold = (await inv(deluxe, night2)).sold;
    await changeStayDates(ctx.tenantId, a.code, { checkIn: s.checkIn, checkOut: night2 }, fd);
    expect((await inv(deluxe, night2)).sold).toBe(sold - 1);
    expect(await assignment(a.code)).toMatchObject({ room_id: a.roomId, lo: s.checkIn, hi: night2 });

    // someone else gets the same room on day 3; moving A onto day 3 must drop A's room, not fail
    const day3 = addDays(s.checkIn, 3);
    await bookAndAssign(day3, addDays(day3, 1), a.roomId);
    const r = await changeStayDates(ctx.tenantId, a.code, { checkIn: addDays(s.checkIn, 2), checkOut: addDays(day3, 1) }, fd);
    expect(r.unassigned).toHaveLength(1);
    expect(await assignment(a.code)).toBeUndefined();
  });

  it("extending into a sold-out night is rejected and nothing changes", async () => {
    const s = stay(4);
    const full = addDays(s.checkIn, 2);
    const a = await book(s.checkIn, full, smallest.id);
    await book(full, addDays(full, 1), smallest.id, smallest.rooms); // every room of the type on that night
    await expect(changeStayDates(ctx.tenantId, a.code, { checkIn: s.checkIn, checkOut: addDays(full, 1) }, fd)).rejects.toThrow(/เต็ม/);
    const after = (await getBooking(ctx.tenantId, a.code))!;
    expect([after.check_in, after.check_out]).toEqual([s.checkIn, full]);
    expect((await inv(smallest.id, s.checkIn)).sold).toBeGreaterThan(0);
  });

  it("a checked-in guest can only move the check-out date, and not onto a room booked by the next guest", async () => {
    const s = stay(4);
    const out = addDays(s.checkIn, 2);
    const a = await bookAndAssign(s.checkIn, out);
    await changeBookingStatus(ctx.tenantId, a.code, "checked_in", fd);
    await expect(changeStayDates(ctx.tenantId, a.code, { checkIn: addDays(s.checkIn, 1), checkOut: out }, fd)).rejects.toThrow(/เฉพาะวันเช็คเอาท์/);
    await bookAndAssign(out, addDays(out, 1), a.roomId);
    const sold = (await inv(deluxe, out)).sold;
    await expect(changeStayDates(ctx.tenantId, a.code, { checkIn: s.checkIn, checkOut: addDays(out, 1) }, fd)).rejects.toThrow(/ย้ายห้องก่อน/);
    expect((await inv(deluxe, out)).sold).toBe(sold); // rolled back

    // check-out marks the room for cleaning
    await changeBookingStatus(ctx.tenantId, a.code, "checked_out", fd);
    expect((await admin().query("SELECT housekeeping_status FROM rooms WHERE id = $1", [a.roomId])).rows[0].housekeeping_status).toBe("dirty");
  });

  it("accountants cannot change bookings", async () => {
    const acc = await staff(ctx.tenantId, "accountant");
    const s = stay(1);
    const b = await book(s.checkIn, s.checkOut);
    await expect(changeStayDates(ctx.tenantId, b.code, { checkIn: s.checkIn, checkOut: addDays(s.checkOut, 1) }, acc)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await expect(updateBookingDetails(ctx.tenantId, b.code, { name: "x y", phone: "0811111111", email: null, specialRequest: null, internalNote: null }, acc)).rejects.toThrow(/ไม่มีสิทธิ์/);
  });
});

describe("change room type", () => {
  it("upgrade at the same price, then re-price; inventory moves between types and the room number is cleared", async () => {
    const s = stay(2);
    const a = await bookAndAssign(s.checkIn, s.checkOut);
    const before = (await getBooking(ctx.tenantId, a.code))!;
    const inv0 = { deluxe: (await inv(deluxe, s.checkIn)).sold, other: (await inv(other, s.checkIn)).sold };

    const up = await changeRoomType(ctx.tenantId, a.bookingRoomId, other, fd, { keepPrice: true });
    expect(up.totalAfter).toBe(before.total_satang);
    expect((await inv(deluxe, s.checkIn)).sold).toBe(inv0.deluxe - 1);
    expect((await inv(other, s.checkIn)).sold).toBe(inv0.other + 1);
    expect(await assignment(a.code)).toBeUndefined();
    const mid = (await getBooking(ctx.tenantId, a.code))!;
    expect(mid.rooms[0].room_type_id).toBe(other);
    expect(mid.rooms[0].amount_satang).toBe(before.rooms[0].amount_satang);

    await changeRoomType(ctx.tenantId, a.bookingRoomId, deluxe, fd, { keepPrice: false });
    const after = (await getBooking(ctx.tenantId, a.code))!;
    expect(after.rooms[0].amount_satang).toBe((await nights(a.code)).reduce((x, n) => x + n.p, 0));
    expect(after.events.filter((e) => e.action === "room_type_changed")).toHaveLength(2);
    await expect(changeRoomType(ctx.tenantId, a.bookingRoomId, deluxe, fd, { keepPrice: false })).rejects.toThrow(/ประเภทห้องเดิม/);
  });

  it("is not allowed after check-in (move to another room number instead)", async () => {
    const s = stay(1);
    const a = await bookAndAssign(s.checkIn, s.checkOut);
    await changeBookingStatus(ctx.tenantId, a.code, "checked_in", fd);
    await expect(changeRoomType(ctx.tenantId, a.bookingRoomId, other, fd, { keepPrice: true })).rejects.toThrow(/เช็คอินแล้ว/);
  });
});

describe("guest details", () => {
  it("updates guest and notes, normalises the phone and records what changed", async () => {
    const s = stay(1);
    const b = await book(s.checkIn, s.checkOut);
    const r = await updateBookingDetails(ctx.tenantId, b.code,
      { name: "สมชาย ใจดี", phone: "089-111-2222", email: "guest@example.com", specialRequest: null, internalNote: "ลูกค้าประจำ" }, fd);
    expect(r.changed).toEqual(expect.arrayContaining(["name", "phone", "email", "internal_note"]));
    const d = (await getBooking(ctx.tenantId, b.code))!;
    expect([d.guest_name, d.guest_phone, d.guest_email, d.internal_note]).toEqual(["สมชาย ใจดี", "0891112222", "guest@example.com", "ลูกค้าประจำ"]);
    const again = await updateBookingDetails(ctx.tenantId, b.code,
      { name: "สมชาย ใจดี", phone: "0891112222", email: "guest@example.com", specialRequest: null, internalNote: "ลูกค้าประจำ" }, fd);
    expect(again.changed).toEqual([]);
    await expect(updateBookingDetails(ctx.tenantId, b.code, { name: "สมชาย", phone: "12", email: null, specialRequest: null, internalNote: null }, fd)).rejects.toThrow(/เบอร์โทร/);
  });
});

describe("front desk on the day", () => {
  it("no-show can only be recorded from the arrival day", async () => {
    const s = stay(1);
    const future = await book(s.checkIn, s.checkOut);
    await expect(changeBookingStatus(ctx.tenantId, future.code, "no_show", fd)).rejects.toThrow(/ตั้งแต่วันเช็คอิน/);

    const today = todayInBangkok();
    const b = await book(today, addDays(today, 1));
    const sold = (await inv(deluxe, today)).sold;
    await changeBookingStatus(ctx.tenantId, b.code, "no_show", fd);
    expect((await inv(deluxe, today)).sold).toBe(sold - 1);
  });

  it("moving an in-house guest starts the new room today and sends the old room to cleaning", async () => {
    const today = todayInBangkok();
    const yesterday = addDays(today, -1);
    const out = addDays(today, 1);
    const a = await bookAndAssign(today, out);
    await changeBookingStatus(ctx.tenantId, a.code, "checked_in", fd);
    // pretend the guest arrived yesterday (bookings cannot be created in the past)
    await admin().query("UPDATE bookings SET check_in = $2 WHERE code = $1", [a.code, yesterday]);
    await admin().query("UPDATE room_assignments SET stay = daterange($2::date, $3::date) WHERE booking_room_id = $1 AND active", [a.bookingRoomId, yesterday, out]);
    await admin().query("UPDATE rooms SET housekeeping_status = 'clean' WHERE id = $1", [a.roomId]);

    const next = await freeRoom(deluxe, today, out, [a.roomId]);
    await assignRoom(ctx.tenantId, a.bookingRoomId, next.id, fd);
    expect(await assignment(a.code)).toMatchObject({ room_id: next.id, lo: today, hi: out });
    expect((await admin().query("SELECT housekeeping_status FROM rooms WHERE id = $1", [a.roomId])).rows[0].housekeeping_status).toBe("dirty");
    // saving the same room again changes nothing
    await assignRoom(ctx.tenantId, a.bookingRoomId, next.id, fd);
    expect(await assignment(a.code)).toMatchObject({ room_id: next.id, lo: today });
  });
});
