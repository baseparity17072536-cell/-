import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayInBangkok } from "@/lib/dates";
import type { Actor } from "@/server/audit";
import { assignRoom, changeBookingStatus, createBooking, getBooking, searchAvailability } from "@/server/booking";
import { setHousekeepingStatus } from "@/server/catalog";
import { cleaningPriority, createTicket, getHousekeepingBoard, listTickets, updateTicketStatus } from "@/server/operations";
import { admin, closePools, fahtalay, guest, staff, stay, useAppPool, useDateBase } from "../setup/helpers";

// Phase 3: housekeeping board and maintenance tickets (taking a room out of sale and back).

let ctx: Awaited<ReturnType<typeof fahtalay>>;
let owner: Actor & { type: "staff" };
let adminUser: Actor & { type: "staff" };
let fd: Actor & { type: "staff" };
let acc: Actor & { type: "staff" };
let typeId: string; // the room type with the most rooms

beforeAll(async () => {
  useAppPool();
  useDateBase(500);
  ctx = await fahtalay();
  [owner, adminUser, fd, acc] = await Promise.all([
    staff(ctx.tenantId, "owner"), staff(ctx.tenantId, "admin"), staff(ctx.tenantId, "front_desk"), staff(ctx.tenantId, "accountant"),
  ]);
  typeId = (await admin().query(
    `SELECT t.id FROM room_types t WHERE t.tenant_id = $1 AND t.is_active AND t.max_adults >= 1
     ORDER BY (SELECT count(*) FROM rooms r WHERE r.room_type_id = t.id AND r.status = 'active') DESC LIMIT 1`, [ctx.tenantId])).rows[0].id;
});
afterAll(closePools);

/** A room of the type with nothing assigned from today on. */
async function idleRoom(exclude: string[] = []) {
  return (await admin().query(
    `SELECT r.id, r.room_number FROM rooms r WHERE r.room_type_id = $1 AND r.status = 'active' AND NOT (r.id = ANY($3::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM room_assignments ra WHERE ra.room_id = r.id AND ra.active AND upper(ra.stay) > $2::date)
     ORDER BY r.room_number LIMIT 1`, [typeId, todayInBangkok(), exclude])).rows[0] as { id: string; room_number: string };
}
const roomRow = async (id: string) => (await admin().query("SELECT status, housekeeping_status FROM rooms WHERE id = $1", [id])).rows[0];
const available = async (checkIn: string, checkOut: string) =>
  (await searchAvailability(ctx.tenantId, { propertyId: ctx.propertyId, checkIn, checkOut, adults: 1, children: 0, rooms: 1 }, fd))
    .find((r) => r.roomTypeId === typeId)!.available;
async function bookToday(roomId: string, nights = 1) {
  const today = todayInBangkok();
  const b = await createBooking(ctx.tenantId, {
    propertyId: ctx.propertyId, checkIn: today, checkOut: addDays(today, nights),
    rooms: [{ roomTypeId: typeId, adults: 1, children: 0, extraBeds: 0 }], guest, source: "walk_in", confirmNow: true,
  }, fd);
  const d = (await getBooking(ctx.tenantId, b.code))!;
  await assignRoom(ctx.tenantId, d.rooms[0].id, roomId, fd);
  return b.code;
}

describe("housekeeping board", () => {
  it("shows who is in each room, today's arrivals, and puts dirty rooms with an arrival first", async () => {
    const r1 = await idleRoom();
    const inHouse = await bookToday(r1.id);
    await changeBookingStatus(ctx.tenantId, inHouse, "checked_in", fd);
    const r2 = await idleRoom([r1.id]);
    const arriving = await bookToday(r2.id);
    await setHousekeepingStatus(ctx.tenantId, r2.id, "dirty", fd);

    const { rooms } = await getHousekeepingBoard(ctx.tenantId, ctx.propertyId);
    const a = rooms.find((r) => r.id === r1.id)!;
    const b = rooms.find((r) => r.id === r2.id)!;
    expect(a.stay_code).toBe(inHouse);
    expect(b.arrival_code).toBe(arriving);
    expect(b.stay_code).toBeNull();
    expect(cleaningPriority(b)).toBe(3);

    // checking the guest out sends the room to cleaning; marking it clean is front desk work, not accounting
    await changeBookingStatus(ctx.tenantId, inHouse, "checked_out", fd);
    expect((await roomRow(r1.id)).housekeeping_status).toBe("dirty");
    await expect(setHousekeepingStatus(ctx.tenantId, r1.id, "clean", acc)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await setHousekeepingStatus(ctx.tenantId, r1.id, "clean", fd);
    expect((await roomRow(r1.id)).housekeeping_status).toBe("clean");
  });
});

describe("maintenance tickets", () => {
  it("a blocking ticket takes the room out of sale until an admin closes it; the room then needs cleaning", async () => {
    const s = stay(2);
    const room = await idleRoom();
    // a booking on these nights creates the inventory rows, whose totals must follow the room's status
    await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [{ roomTypeId: typeId, adults: 1, children: 0, extraBeds: 0 }],
      guest, source: "phone", confirmNow: true }, fd);
    const before = await available(s.checkIn, s.checkOut);

    const t = await createTicket(ctx.tenantId, ctx.propertyId,
      { roomId: room.id, location: null, title: "แอร์น้ำหยด", detail: null, priority: "urgent", blockRoom: true }, adminUser);
    expect(t.roomBlocked).toBe(true);
    expect((await roomRow(room.id)).status).toBe("maintenance");
    expect(await available(s.checkIn, s.checkOut)).toBe(before - 1);
    expect((await listTickets(ctx.tenantId, ctx.propertyId)).find((x) => x.id === t.id)).toMatchObject({ priority: "urgent", status: "open", room_blocked: true });

    // front desk can work on it but cannot put the room back on sale
    await updateTicketStatus(ctx.tenantId, t.id, "in_progress", fd);
    await expect(updateTicketStatus(ctx.tenantId, t.id, "done", fd, { resolution: "เปลี่ยนท่อ" })).rejects.toThrow(/เจ้าของหรือแอดมิน/);

    const r = await updateTicketStatus(ctx.tenantId, t.id, "done", adminUser, { resolution: "เปลี่ยนท่อน้ำทิ้ง" });
    expect(r.reopened).toBe(room.room_number);
    expect(await roomRow(room.id)).toMatchObject({ status: "active", housekeeping_status: "dirty" });
    expect(await available(s.checkIn, s.checkOut)).toBe(before);
    const closed = (await listTickets(ctx.tenantId, ctx.propertyId, "closed")).find((x) => x.id === t.id)!;
    expect(closed).toMatchObject({ status: "done", resolution: "เปลี่ยนท่อน้ำทิ้ง" });
    await expect(updateTicketStatus(ctx.tenantId, t.id, "in_progress", owner)).rejects.toThrow(/เปลี่ยนเป็นสถานะดังกล่าวไม่ได้/);
  });

  it("cannot block a room that has a guest assigned; nothing is saved", async () => {
    const room = await idleRoom();
    await bookToday(room.id, 2);
    const n = (await admin().query("SELECT count(*)::int AS n FROM maintenance_tickets")).rows[0].n;
    await expect(createTicket(ctx.tenantId, ctx.propertyId,
      { roomId: room.id, location: null, title: "ฝักบัวเสีย", detail: null, priority: "normal", blockRoom: true }, owner)).rejects.toThrow(/ย้ายห้อง/);
    expect((await admin().query("SELECT count(*)::int AS n FROM maintenance_tickets")).rows[0].n).toBe(n);
    expect((await roomRow(room.id)).status).toBe("active");
    // the same report without closing the room is fine
    const t = await createTicket(ctx.tenantId, ctx.propertyId,
      { roomId: room.id, location: null, title: "ฝักบัวเสีย", detail: "น้ำไหลอ่อน", priority: "normal", blockRoom: false }, fd);
    expect(t.roomBlocked).toBe(false);
  });

  it("who can do what: everyone reports, accounting cannot manage, only owner/admin close rooms", async () => {
    const room = await idleRoom();
    await expect(createTicket(ctx.tenantId, ctx.propertyId,
      { roomId: room.id, location: null, title: "ไฟดับ", detail: null, priority: "normal", blockRoom: true }, fd)).rejects.toThrow(/เจ้าของหรือแอดมิน/);
    const t = await createTicket(ctx.tenantId, ctx.propertyId,
      { roomId: null, location: "สระว่ายน้ำ", title: "ปั๊มน้ำดัง", detail: null, priority: "low", blockRoom: false }, acc);
    await expect(updateTicketStatus(ctx.tenantId, t.id, "done", acc)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await updateTicketStatus(ctx.tenantId, t.id, "cancelled", fd, { resolution: "ซ้ำกับงานเดิม" });
    await expect(createTicket(ctx.tenantId, ctx.propertyId,
      { roomId: null, location: null, title: "ไม่รู้ที่", detail: null, priority: "low", blockRoom: false }, fd)).rejects.toThrow(/เลือกห้อง/);
  });

  it("a room already closed by hand stays closed when a ticket on it is closed", async () => {
    const room = await idleRoom();
    await admin().query("UPDATE rooms SET status = 'maintenance' WHERE id = $1", [room.id]);
    try {
      const t = await createTicket(ctx.tenantId, ctx.propertyId,
        { roomId: room.id, location: null, title: "ทาสีใหม่", detail: null, priority: "low", blockRoom: true }, owner);
      expect(t.roomBlocked).toBe(false);
      const r = await updateTicketStatus(ctx.tenantId, t.id, "done", owner, { resolution: "ทาสีแล้ว" });
      expect(r.reopened).toBeNull();
      expect((await roomRow(room.id)).status).toBe("maintenance");
    } finally {
      await admin().query("UPDATE rooms SET status = 'active' WHERE id = $1", [room.id]);
    }
  });
});
