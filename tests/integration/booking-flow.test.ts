import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listChangeRequests, reviewChangeRequest } from "@/server/approvals";
import { assignRoom, changeBookingStatus, createBooking, getBooking, getCalendar, searchAvailability } from "@/server/booking";
import { bulkCreateRooms, getRoomType, listPriceRules, savePriceRule, saveRoom, saveRoomType, setDailyRates } from "@/server/catalog";
import { admin, closePools, fahtalay, guest, staff, stay, useAppPool, useDateBase } from "../setup/helpers";

let ctx: Awaited<ReturnType<typeof fahtalay>>;
beforeAll(async () => {
  useAppPool();
  useDateBase(120);
  ctx = await fahtalay();
});
afterAll(closePools);

const deluxe = () => ({ roomTypeId: ctx.types["deluxe-sea-view"], adults: 2, children: 0, extraBeds: 0 });
const free = async (checkIn: string, checkOut: string) =>
  (await searchAvailability(ctx.tenantId, { propertyId: ctx.propertyId, checkIn, checkOut, adults: 2, children: 0, rooms: 1 }))
    .find((r) => r.roomTypeId === ctx.types["deluxe-sea-view"])!.available;

describe("booking lifecycle", () => {
  it("hold → guest cancel releases the room", async () => {
    const s = stay(2);
    const before = await free(s.checkIn, s.checkOut);
    const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [deluxe()], guest, source: "web" }, { type: "guest" });
    expect(b.status).toBe("pending_payment");
    expect(await free(s.checkIn, s.checkOut)).toBe(before - 1);
    await expect(changeBookingStatus(ctx.tenantId, b.code, "cancelled", { type: "guest" }, { guestPhone: "0899999999" })).rejects.toThrow(/ไม่ตรง/);
    await changeBookingStatus(ctx.tenantId, b.code, "cancelled", { type: "guest" }, { guestPhone: "081-234-5678" });
    expect(await free(s.checkIn, s.checkOut)).toBe(before);
  });

  it("expired holds release inventory automatically", async () => {
    const s = stay(1);
    const before = await free(s.checkIn, s.checkOut);
    const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [deluxe()], guest, source: "web" }, { type: "guest" });
    await admin().query("UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE code = $1", [b.code]);
    expect(await free(s.checkIn, s.checkOut)).toBe(before);
    expect((await getBooking(ctx.tenantId, b.code))!.status).toBe("expired");
  });

  it("walk-in booking by front desk → assign room → check-in → check-out", async () => {
    const fd = await staff(ctx.tenantId, "front_desk");
    const s = stay(1);
    const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [deluxe()], guest, source: "walk_in", confirmNow: true }, fd);
    expect(b.status).toBe("confirmed");
    await expect(changeBookingStatus(ctx.tenantId, b.code, "checked_in", fd)).rejects.toThrow(/จัดเลขห้อง/);
    const detail = (await getBooking(ctx.tenantId, b.code))!;
    const rt = (await getRoomType(ctx.tenantId, ctx.types["deluxe-sea-view"]))!;
    const busy = (await admin().query(
      "SELECT room_id FROM room_assignments WHERE active AND stay && daterange($1::date, $2::date)", [s.checkIn, s.checkOut])).rows.map((r) => r.room_id);
    const roomId = rt.rooms.find((r) => r.status === "active" && !busy.includes(r.id))!.id;
    await assignRoom(ctx.tenantId, detail.rooms[0].id, roomId, fd);
    await changeBookingStatus(ctx.tenantId, b.code, "checked_in", fd);
    await changeBookingStatus(ctx.tenantId, b.code, "checked_out", fd);
    const after = (await getBooking(ctx.tenantId, b.code))!;
    expect(after.events.map((e) => e.to_status)).toEqual(["confirmed", "checked_in", "checked_out"]);
  });

  it("accountant cannot create bookings; guests cannot confirm their own booking", async () => {
    const acc = await staff(ctx.tenantId, "accountant");
    await expect(createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...stay(1), rooms: [deluxe()], guest, source: "phone" }, acc)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await expect(createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...stay(1), rooms: [deluxe()], guest, source: "web", confirmNow: true }, { type: "guest" })).rejects.toThrow(/ไม่มีสิทธิ์/);
  });

  it("stale version is rejected (two staff editing the same booking)", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...stay(1), rooms: [deluxe()], guest, source: "web" }, { type: "guest" });
    const v = (await getBooking(ctx.tenantId, b.code))!.version;
    await changeBookingStatus(ctx.tenantId, b.code, "confirmed", owner, { expectedVersion: v });
    await expect(changeBookingStatus(ctx.tenantId, b.code, "cancelled", owner, { expectedVersion: v })).rejects.toThrow(/ถูกแก้ไขโดยผู้อื่น/);
  });
});

describe("pricing rules, tax and rooms", () => {
  it("weekday rule applies to booked nights and the source is stored per night", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const villa = ctx.types["villa-garden-view"];
    await savePriceRule(ctx.tenantId, { room_type_id: villa, name: "ศุกร์-เสาร์ (test)", kind: "weekday", date_from: null, date_to: null, weekdays: [0, 1, 2, 3, 4, 5, 6], price_satang: 777700, priority: 999, is_active: true }, owner);
    const s = stay(1);
    const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [{ roomTypeId: villa, adults: 2, children: 0, extraBeds: 0 }], guest, source: "web" }, { type: "guest" });
    expect(b.total).toBe(777700);
    const night = (await admin().query(
      `SELECT bn.room_satang, bn.price_source FROM booking_nights bn JOIN booking_rooms br ON br.id = bn.booking_room_id
       JOIN bookings x ON x.id = br.booking_id WHERE x.code = $1`, [b.code])).rows[0];
    expect(night.room_satang).toBe(777700);
    expect(night.price_source).toMatch(/^rule:/);
    // clean up so other tests see base prices
    const rule = (await listPriceRules(ctx.tenantId, ctx.propertyId)).find((r) => r.name === "ศุกร์-เสาร์ (test)")!;
    await savePriceRule(ctx.tenantId, { ...rule, delete: true }, owner);
  });

  it("tax-exclusive property adds service charge and VAT once to the booking total", async () => {
    await admin().query("UPDATE properties SET prices_include_tax = false, service_charge_bp = 1000, vat_bp = 700 WHERE id = $1", [ctx.propertyId]);
    try {
      const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...stay(1), rooms: [deluxe()], guest, source: "web" }, { type: "guest" });
      const row = (await admin().query("SELECT subtotal_satang, service_charge_satang, vat_satang, total_satang FROM bookings WHERE code = $1", [b.code])).rows[0];
      expect(row.service_charge_satang).toBe(Math.round(row.subtotal_satang * 0.1));
      expect(row.total_satang).toBe(row.subtotal_satang + row.service_charge_satang + row.vat_satang);
      expect(b.total).toBe(row.total_satang);
    } finally {
      await admin().query("UPDATE properties SET prices_include_tax = true, service_charge_bp = 0, vat_bp = 700 WHERE id = $1", [ctx.propertyId]);
    }
  });

  it("bulk room creation adds sellable inventory and rejects duplicate numbers", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const s = stay(1);
    const before = await free(s.checkIn, s.checkOut);
    const nums = await bulkCreateRooms(ctx.tenantId, { room_type_id: ctx.types["deluxe-sea-view"], start: "D901", count: 3, building: "D", floor: "9", zone: null }, owner);
    expect(nums).toEqual(["D901", "D902", "D903"]);
    expect(await free(s.checkIn, s.checkOut)).toBe(before + 3);
    await expect(bulkCreateRooms(ctx.tenantId, { room_type_id: ctx.types["deluxe-sea-view"], start: "D903", count: 2, building: null, floor: null, zone: null }, owner))
      .rejects.toThrow(/D903/);
    const rooms = (await getRoomType(ctx.tenantId, ctx.types["deluxe-sea-view"]))!.rooms.filter((r) => nums.includes(r.room_number));
    for (const r of rooms) await saveRoom(ctx.tenantId, { ...r, status: "inactive" }, owner);
    expect(await free(s.checkIn, s.checkOut)).toBe(before);
  });
});

describe("owner approval (maker-checker)", () => {
  it("admin cancelling a confirmed booking waits for the owner", async () => {
    const adm = await staff(ctx.tenantId, "admin");
    const owner = await staff(ctx.tenantId, "owner");
    const b = await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...stay(1), rooms: [deluxe()], guest, source: "phone", confirmNow: true }, adm);
    const r = await changeBookingStatus(ctx.tenantId, b.code, "cancelled", adm, { reason: "ลูกค้าขอยกเลิก" });
    expect(r.pendingApproval).toBe(true);
    expect((await getBooking(ctx.tenantId, b.code))!.status).toBe("confirmed");
    await expect(reviewChangeRequest(ctx.tenantId, r.requestId!, "approve", adm)).rejects.toThrow(/เฉพาะเจ้าของ/);
    expect((await reviewChangeRequest(ctx.tenantId, r.requestId!, "approve", owner)).status).toBe("approved");
    expect((await getBooking(ctx.tenantId, b.code))!.status).toBe("cancelled");
  });

  it("admin price change is saved as a request; descriptive edits apply immediately", async () => {
    const adm = await staff(ctx.tenantId, "admin");
    const owner = await staff(ctx.tenantId, "owner");
    const rt = (await getRoomType(ctx.tenantId, ctx.types["villa-garden-view"]))!;
    const fields = Object.fromEntries(Object.entries(rt).filter(([k]) => k !== "images" && k !== "rooms")) as Omit<typeof rt, "images" | "rooms">;
    const res = await saveRoomType(ctx.tenantId, { ...fields, description_th: "แก้คำอธิบาย", base_price_satang: rt.base_price_satang + 100000 }, adm);
    expect(res.pendingApproval).toBe(true);
    const mid = (await getRoomType(ctx.tenantId, rt.id))!;
    expect(mid.description_th).toBe("แก้คำอธิบาย");
    expect(mid.base_price_satang).toBe(rt.base_price_satang);
    const pending = await listChangeRequests(ctx.tenantId);
    expect(pending.find((p) => p.id === res.requestId)!.summary).toContain("เปลี่ยนราคา");
    await reviewChangeRequest(ctx.tenantId, res.requestId!, "approve", owner);
    expect((await getRoomType(ctx.tenantId, rt.id))!.base_price_satang).toBe(rt.base_price_satang + 100000);
  });

  it("owner closes dates directly; closed nights are not bookable", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const s = stay(2);
    await setDailyRates(ctx.tenantId, { roomTypeIds: [ctx.types["deluxe-sea-view"]], from: s.checkIn, to: s.checkIn, weekdays: [], price: { mode: "keep" }, closed: "close", minNights: { mode: "keep" } }, owner);
    await expect(createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [deluxe()], guest, source: "web" }, { type: "guest" })).rejects.toThrow(/ปิดรับจอง/);
    const cal = await getCalendar(ctx.tenantId, ctx.propertyId, s.checkIn, 2);
    expect(cal.find((t) => t.id === ctx.types["deluxe-sea-view"])!.days[0].closed).toBe(true);
  });

  it("cannot take a room out of service when that would oversell booked nights", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const s = stay(1);
    // book every Family Suite for one night
    for (let i = 0; i < 3; i++)
      await createBooking(ctx.tenantId, { propertyId: ctx.propertyId, ...s, rooms: [{ roomTypeId: ctx.types["family-suite"], adults: 2, children: 0, extraBeds: 0 }], guest, source: "phone", confirmNow: true }, owner);
    const rt = (await getRoomType(ctx.tenantId, ctx.types["family-suite"]))!;
    const r = rt.rooms[0];
    await expect(saveRoom(ctx.tenantId, { ...r, status: "maintenance" }, owner)).rejects.toThrow(/ไม่สามารถลดจำนวนห้อง/);
  });
});
