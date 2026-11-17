import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createBooking, getBooking, listBookings } from "@/server/booking";
import { withTenant } from "@/server/db";
import { listRoomTypes } from "@/server/catalog";
import { admin, closePools, fahtalay, guest, stay, useAppPool, useDateBase } from "../setup/helpers";

let a: Awaited<ReturnType<typeof fahtalay>>;
let b: { tenantId: string; propertyId: string; roomTypeId: string };
let codeA: string;
let codeB: string;

beforeAll(async () => {
  useAppPool();
  useDateBase(220);
  a = await fahtalay();
  // second resort created through the admin connection (as platform provisioning would)
  const db = admin();
  const t = (await db.query("INSERT INTO tenants (slug, name) VALUES ('second-resort', 'Second') RETURNING id")).rows[0].id;
  const p = (await db.query("INSERT INTO properties (tenant_id, slug, name_th) VALUES ($1, 'main', 'Second') RETURNING id", [t])).rows[0].id;
  await db.query("INSERT INTO rate_plans (tenant_id, property_id, code, name_th, is_default) VALUES ($1,$2,'ROOM_ONLY','Room',true)", [t, p]);
  const rt = (await db.query(
    `INSERT INTO room_types (tenant_id, property_id, slug, code, name_th, base_adults, max_adults, max_occupancy, base_price_satang)
     VALUES ($1,$2,'standard','STD','Standard',2,2,2,100000) RETURNING id`, [t, p])).rows[0].id;
  await db.query("INSERT INTO rooms (tenant_id, room_type_id, room_number) VALUES ($1,$2,'1')", [t, rt]);
  b = { tenantId: t, propertyId: p, roomTypeId: rt };

  const s = stay(1);
  codeA = (await createBooking(a.tenantId, { propertyId: a.propertyId, ...s, rooms: [{ roomTypeId: a.types["deluxe-sea-view"], adults: 2, children: 0, extraBeds: 0 }], guest, source: "web" }, { type: "guest" })).code;
  codeB = (await createBooking(b.tenantId, { propertyId: b.propertyId, ...s, rooms: [{ roomTypeId: b.roomTypeId, adults: 2, children: 0, extraBeds: 0 }], guest: { ...guest, name: "ลูกค้ารีสอร์ทสอง" }, source: "web" }, { type: "guest" })).code;
});
afterAll(closePools);

describe("tenant isolation", () => {
  it("app role without tenant context sees no tenant rows at all (fail closed)", async () => {
    const c = new pg.Client({ connectionString: inject("appUrl") });
    await c.connect();
    try {
      for (const table of ["bookings", "guests", "room_types", "rooms", "properties", "inventory_nights", "audit_logs"]) {
        const n = (await c.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
        expect({ table, n }).toEqual({ table, n: 0 });
      }
    } finally {
      await c.end();
    }
  });

  it("app role cannot bypass RLS or read the migrations table", async () => {
    const c = new pg.Client({ connectionString: inject("appUrl") });
    await c.connect();
    try {
      const r = (await c.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
      expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
      await expect(c.query("SELECT * FROM schema_migrations")).rejects.toThrow(/permission denied/);
      await expect(c.query("DELETE FROM audit_logs")).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  it("each tenant only sees its own bookings, guests and catalog", async () => {
    expect(await getBooking(a.tenantId, codeB)).toBeNull();
    expect(await getBooking(b.tenantId, codeA)).toBeNull();
    expect((await listBookings(b.tenantId, { status: "all" })).map((x) => x.code)).toEqual([codeB]);
    expect((await listRoomTypes(b.tenantId, b.propertyId)).map((x) => x.slug)).toEqual(["standard"]);
    expect(await listRoomTypes(a.tenantId, b.propertyId)).toEqual([]);
  });

  it("cannot book another tenant's room type even when its id is known", async () => {
    await expect(
      createBooking(a.tenantId, { propertyId: a.propertyId, ...stay(1), rooms: [{ roomTypeId: b.roomTypeId, adults: 1, children: 0, extraBeds: 0 }], guest, source: "web" }, { type: "guest" }),
    ).rejects.toThrow(/ไม่พบประเภทห้องพัก/);
    await expect(
      createBooking(a.tenantId, { propertyId: b.propertyId, ...stay(1), rooms: [{ roomTypeId: b.roomTypeId, adults: 1, children: 0, extraBeds: 0 }], guest, source: "web" }, { type: "guest" }),
    ).rejects.toThrow(/ไม่พบที่พัก/);
  });

  it("writes tagged with another tenant id are rejected by the database", async () => {
    await expect(
      withTenant(a.tenantId, (tx) => tx.query("INSERT INTO guests (tenant_id, full_name, phone) VALUES ($1, 'x', '0800000000')", [b.tenantId])),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withTenant(a.tenantId, (tx) => tx.query("UPDATE bookings SET internal_note = 'hacked' WHERE code = $1 RETURNING id", [codeB])),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it("composite foreign keys block cross-tenant references even for the owner role", async () => {
    await expect(
      admin().query("INSERT INTO rooms (tenant_id, room_type_id, room_number) VALUES ($1, $2, 'X1')", [a.tenantId, b.roomTypeId]),
    ).rejects.toThrow(/foreign key/);
  });
});
