// Seed the FahTalay tenant from the prototype data (src/lib/rooms.ts) and import data/bookings.json.
// Idempotent: does nothing if the tenant already exists. Runs with the admin connection.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import pg from "pg";
import { RESORT, ROOM_TYPES } from "./seed-data/fahtalay";
import { seedCode, translationsSql } from "./seed-data/fahtalay-translations";

const ROOT = path.resolve(import.meta.dirname, "..");

type LegacyBooking = {
  code: string; roomTypeId: string; roomName: string; checkIn: string; checkOut: string; nights: number; rooms: number;
  guests: number; pricePerNight: number; total: number;
  guest: { name: string; phone: string; email: string; note: string };
  status: "pending" | "confirmed" | "cancelled"; cancelledBy?: "guest" | "admin"; createdAt: string; updatedAt: string;
};

export async function runSeed(adminUrl: string, opts: { ownerEmail?: string; ownerPassword?: string; hosts?: string[]; importLegacy?: boolean } = {}) {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    const exists = await c.query("SELECT id FROM tenants WHERE slug = 'fahtalay'");
    if (exists.rowCount) {
      console.log("tenant 'fahtalay' already exists — seed skipped");
      return { tenantId: exists.rows[0].id as string, created: false };
    }
    await c.query("BEGIN");
    const tenantId: string = (await c.query("INSERT INTO tenants (slug, name) VALUES ('fahtalay', $1) RETURNING id", [RESORT.name])).rows[0].id;
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    for (const [i, host] of (opts.hosts ?? ["localhost", "127.0.0.1"]).entries())
      await c.query("INSERT INTO tenant_domains (host, tenant_id, is_primary) VALUES ($1, $2, $3)", [host, tenantId, i === 0]);

    const propertyId: string = (
      await c.query(
        `INSERT INTO properties (tenant_id, slug, name_th, name_en, phone, address, facebook_url, check_in_time, check_out_time,
           hold_minutes, max_nights, damage_deposit_satang)
         VALUES ($1,'main',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tenantId, RESORT.name, RESORT.nameEn, RESORT.phone, RESORT.address, RESORT.facebook, RESORT.checkInTime,
         RESORT.checkOutTime, RESORT.holdHours * 60, RESORT.maxNights, RESORT.deposit * 100],
      )
    ).rows[0].id;

    const planId: string = (
      await c.query(
        `INSERT INTO rate_plans (tenant_id, property_id, code, name_th, name_en, description_th, is_default)
         VALUES ($1, $2, 'ROOM_ONLY', 'ราคาห้องพัก', 'Room only', 'ราคาห้องพักไม่รวมอาหาร', true) RETURNING id`,
        [tenantId, propertyId],
      )
    ).rows[0].id;

    const typeIds = new Map<string, string>();
    let roomNo = 101;
    for (const [i, t] of ROOM_TYPES.entries()) {
      const id: string = (
        await c.query(
          `INSERT INTO room_types (tenant_id, property_id, slug, code, name_th, name_en, description_th, bed_info, base_adults,
             max_adults, max_children, max_occupancy, max_extra_beds, base_price_satang, amenities, sort_order)
           VALUES ($1,$2,$3,$12,$4,$4,$5,$6,$7,$7,$8,$7,0,$9,$10,$11) RETURNING id`,
          [tenantId, propertyId, t.id, t.name, t.description, t.beds, t.capacity, Math.max(1, Math.floor(t.capacity / 2)), t.price * 100, t.amenities, i,
           seedCode(t.id)],
        )
      ).rows[0].id;
      typeIds.set(t.id, id);
      await c.query("INSERT INTO room_type_images (tenant_id, room_type_id, url, alt) VALUES ($1,$2,$3,$4)", [tenantId, id, t.image, t.name]);
      for (let n = 0; n < t.inventory; n++)
        await c.query("INSERT INTO rooms (tenant_id, room_type_id, room_number) VALUES ($1,$2,$3)", [tenantId, id, String(roomNo++)]);
      roomNo = Math.ceil(roomNo / 100) * 100 + 1;
    }

    // English / Chinese content for the guest website
    await c.query(translationsSql());

    const ownerEmail = (opts.ownerEmail ?? process.env.SEED_OWNER_EMAIL ?? "owner@fahtalay.local").toLowerCase();
    const ownerPassword = opts.ownerPassword ?? `Ft-${randomBytes(9).toString("base64url")}1`;
    const ownerId: string = (
      await c.query("INSERT INTO users (email, name, password_hash) VALUES ($1, 'เจ้าของรีสอร์ท', $2) RETURNING id", [
        ownerEmail, await hash(ownerPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      ])
    ).rows[0].id;
    await c.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, ownerId]);

    let imported = 0;
    const legacyFile = path.join(ROOT, "data", "bookings.json");
    if (opts.importLegacy !== false && existsSync(legacyFile)) {
      const legacy = JSON.parse(await readFile(legacyFile, "utf8")) as LegacyBooking[];
      for (const b of legacy) {
        const typeId = typeIds.get(b.roomTypeId);
        if (!typeId) continue;
        const holdEnd = new Date(Date.parse(b.createdAt) + RESORT.holdHours * 3_600_000);
        const status = b.status === "pending" ? (holdEnd < new Date() ? "expired" : "pending_payment") : b.status;
        const guestId: string = (
          await c.query("INSERT INTO guests (tenant_id, full_name, phone, email, note) VALUES ($1,$2,$3,$4,$5) RETURNING id", [
            tenantId, b.guest.name, b.guest.phone.replace(/\D/g, ""), b.guest.email || null, b.guest.note || null,
          ])
        ).rows[0].id;
        const bookingId: string = (
          await c.query(
            `INSERT INTO bookings (tenant_id, property_id, code, guest_id, status, source, check_in, check_out, adults,
               subtotal_satang, total_satang, special_request, hold_expires_at, cancelled_by, created_at)
             VALUES ($1,$2,$3,$4,$5,'web',$6,$7,$8,$9,$9,$10,$11,$12,$13) RETURNING id`,
            [tenantId, propertyId, b.code, guestId, status, b.checkIn, b.checkOut, b.guests, b.total * 100, b.guest.note || null,
             holdEnd, b.cancelledBy === "admin" ? "staff" : (b.cancelledBy ?? null), b.createdAt],
          )
        ).rows[0].id;
        for (let r = 0; r < b.rooms; r++) {
          const brId: string = (
            await c.query(
              `INSERT INTO booking_rooms (tenant_id, booking_id, room_type_id, rate_plan_id, room_type_name, rate_plan_name, adults, amount_satang)
               VALUES ($1,$2,$3,$4,$5,'ราคาห้องพัก',$6,$7) RETURNING id`,
              [tenantId, bookingId, typeId, planId, b.roomName, Math.max(1, Math.ceil(b.guests / b.rooms)), b.pricePerNight * b.nights * 100],
            )
          ).rows[0].id;
          await c.query(
            `INSERT INTO booking_nights (tenant_id, booking_room_id, stay_date, room_satang)
             SELECT $1, $2, d::date, $5 FROM generate_series($3::date, $4::date - 1, interval '1 day') d`,
            [tenantId, brId, b.checkIn, b.checkOut, b.pricePerNight * 100],
          );
        }
        const bucket = status === "pending_payment" ? "held" : status === "confirmed" ? "sold" : null;
        if (bucket) {
          await c.query(
            `INSERT INTO inventory_nights (tenant_id, room_type_id, stay_date, total)
             SELECT $1, $2, d::date, (SELECT count(*) FROM rooms WHERE room_type_id = $2 AND status = 'active')
             FROM generate_series($3::date, $4::date - 1, interval '1 day') d ON CONFLICT DO NOTHING`,
            [tenantId, typeId, b.checkIn, b.checkOut],
          );
          await c.query(
            `UPDATE inventory_nights SET ${bucket} = ${bucket} + $5 WHERE room_type_id = $2 AND tenant_id = $1 AND stay_date >= $3 AND stay_date < $4`,
            [tenantId, typeId, b.checkIn, b.checkOut, b.rooms],
          );
        }
        await c.query(
          `INSERT INTO booking_events (tenant_id, booking_id, action, to_status, actor_type, data) VALUES ($1,$2,'imported',$3,'system',$4)`,
          [tenantId, bookingId, status, JSON.stringify({ from: "data/bookings.json", legacyStatus: b.status })],
        );
        imported++;
      }
    }
    await c.query("COMMIT");
    console.log(`seeded tenant fahtalay (${ROOM_TYPES.length} room types, ${[...ROOM_TYPES].reduce((s, t) => s + t.inventory, 0)} rooms, ${imported} imported bookings)`);
    if (!opts.ownerPassword) {
      console.log("\n  Owner login (shown once — change it after first login):");
      console.log(`    email:    ${ownerEmail}`);
      console.log(`    password: ${ownerPassword}\n`);
    }
    return { tenantId, created: true, propertyId };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}
