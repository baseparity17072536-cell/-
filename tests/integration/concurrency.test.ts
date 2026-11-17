import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { assignRoom, changeBookingStatus, createBooking, getBooking } from "@/server/booking";
import { DomainError } from "@/server/errors";
import { admin, closePools, fahtalay, guest, staff, stay, useAppPool, useDateBase } from "../setup/helpers";

let ctx: Awaited<ReturnType<typeof fahtalay>>;
beforeAll(async () => {
  useAppPool();
  useDateBase(20);
  ctx = await fahtalay();
});
afterAll(closePools);

const room = (roomTypeId: string) => ({ roomTypeId, adults: 2, children: 0, extraBeds: 0 });

async function ledgerMatchesBookings(roomTypeId: string) {
  // every night: held + sold <= total, and counters equal the bookings that actually hold rooms
  const { rows } = await admin().query(
    `SELECT i.stay_date, i.total, i.held, i.sold,
       (SELECT count(*) FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
        WHERE br.room_type_id = i.room_type_id AND b.check_in <= i.stay_date AND i.stay_date < b.check_out
          AND b.status IN ('pending_payment','payment_review'))::int AS expect_held,
       (SELECT count(*) FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
        WHERE br.room_type_id = i.room_type_id AND b.check_in <= i.stay_date AND i.stay_date < b.check_out
          AND b.status IN ('confirmed','checked_in','checked_out'))::int AS expect_sold
     FROM inventory_nights i WHERE i.room_type_id = $1`,
    [roomTypeId],
  );
  for (const r of rows) {
    expect(r.held + r.sold).toBeLessThanOrEqual(r.total);
    expect(r.held).toBeGreaterThanOrEqual(0);
    expect(r.sold).toBeGreaterThanOrEqual(0);
    expect({ date: r.stay_date, held: r.held, sold: r.sold }).toEqual({ date: r.stay_date, held: r.expect_held, sold: r.expect_sold });
  }
}

describe("double booking prevention", () => {
  it("50 guests racing for 3 Family Suites: exactly 3 bookings succeed", async () => {
    const s = stay(3);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        createBooking(ctx.tenantId, {
          propertyId: ctx.propertyId, ...s, rooms: [room(ctx.types["family-suite"])],
          guest: { ...guest, phone: `08100000${String(i).padStart(2, "0")}` }, source: "web",
        }, { type: "guest" }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(47);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(DomainError);
      expect((f.reason as DomainError).code).toBe("SOLD_OUT");
    }
    await ledgerMatchesBookings(ctx.types["family-suite"]);
  });

  it("overlapping date ranges racing never oversell any single night", async () => {
    const base = stay(10).checkIn;
    const jobs = Array.from({ length: 40 }, (_, i) => {
      const start = addDays(base, i % 6);
      return createBooking(ctx.tenantId, {
        propertyId: ctx.propertyId, checkIn: start, checkOut: addDays(start, 1 + (i % 4)),
        rooms: [room(ctx.types["villa-garden-view"])], guest, source: "web",
      }, { type: "guest" });
    });
    const results = await Promise.allSettled(jobs);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(results.some((r) => r.status === "rejected")).toBe(true);
    await ledgerMatchesBookings(ctx.types["villa-garden-view"]);
  });

  it("concurrent confirm of expired bookings cannot exceed capacity either", async () => {
    const s = stay(2);
    const owner = await staff(ctx.tenantId, "owner");
    // fill the 3 suites with holds, expire them, then rebook 3 fresh holds
    const first = await Promise.all([0, 1, 2].map(() => createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [room(ctx.types["family-suite"])], guest, source: "web" }, { type: "guest" })));
    await admin().query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE code = ANY($1)", [first.map((b) => b.code)]);
    await Promise.all([0, 1, 2].map(() => createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [room(ctx.types["family-suite"])], guest, source: "web" }, { type: "guest" })));
    const confirm = await Promise.allSettled(first.map((b) => changeBookingStatus(ctx.tenantId, b.code, "confirmed", owner)));
    expect(confirm.every((r) => r.status === "rejected")).toBe(true);
    await ledgerMatchesBookings(ctx.types["family-suite"]);
  });

  it("the same physical room can never be assigned to overlapping stays", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const s = stay(3);
    const a = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [room(ctx.types["deluxe-sea-view"])], guest, source: "phone", confirmNow: true }, owner);
    const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, checkIn: addDays(s.checkIn, 1), checkOut: addDays(s.checkOut, 1), rooms: [room(ctx.types["deluxe-sea-view"])], guest, source: "phone", confirmNow: true }, owner);
    const roomId = (await admin().query("SELECT id FROM rooms WHERE room_type_id = $1 ORDER BY room_number LIMIT 1", [ctx.types["deluxe-sea-view"]])).rows[0].id;
    const brA = (await getBooking(ctx.tenantId, a.code))!.rooms[0].id;
    const brB = (await getBooking(ctx.tenantId, b.code))!.rooms[0].id;
    const both = await Promise.allSettled([assignRoom(ctx.tenantId, brA, roomId, owner), assignRoom(ctx.tenantId, brB, roomId, owner)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const err = both.find((r): r is PromiseRejectedResult => r.status === "rejected")!.reason as DomainError;
    expect(err.code).toBe("ROOM_TAKEN");
  });

  it("idempotency key: double-submitting the booking form creates one booking", async () => {
    const s = stay(1);
    const key = `idem-${Date.now()}`;
    const input = { propertyId: ctx.propertyId, ...s, rooms: [room(ctx.types["deluxe-sea-view"])], guest, source: "web" as const, idempotencyKey: key };
    const [x, y, z] = await Promise.all([1, 2, 3].map(() => createBooking(ctx.tenantId, input, { type: "guest" })));
    expect(new Set([x.code, y.code, z.code]).size).toBe(1);
    const n = (await admin().query("SELECT count(*)::int AS n FROM bookings WHERE idempotency_key = $1", [key])).rows[0].n;
    expect(n).toBe(1);
  });
});
