import { hash } from "@node-rs/argon2";
import pg from "pg";
import { inject } from "vitest";
import { addDays, todayInBangkok } from "@/lib/dates";
import { setPool } from "@/server/db";
import type { Actor } from "@/server/audit";
import type { Role } from "@/server/rbac";

let appPool: pg.Pool | undefined;
let adminPool: pg.Pool | undefined;

/** The app runs as the least-privileged role (RLS enforced), exactly like production. */
export function useAppPool() {
  appPool ??= new pg.Pool({ connectionString: inject("appUrl"), max: 60 });
  setPool(appPool);
  return appPool;
}

export function admin() {
  adminPool ??= new pg.Pool({ connectionString: inject("adminUrl"), max: 5 });
  return adminPool;
}

export async function closePools() {
  await appPool?.end();
  await adminPool?.end();
  appPool = adminPool = undefined;
}

export async function fahtalay() {
  const t = (await admin().query("SELECT id FROM tenants WHERE slug = 'fahtalay'")).rows[0];
  const p = (await admin().query("SELECT id FROM properties WHERE tenant_id = $1", [t.id])).rows[0];
  const types = (await admin().query("SELECT id, slug FROM room_types WHERE tenant_id = $1 ORDER BY sort_order", [t.id])).rows as { id: string; slug: string }[];
  return { tenantId: t.id as string, propertyId: p.id as string, types: Object.fromEntries(types.map((x) => [x.slug, x.id])) as Record<string, string> };
}

let seq = 0;
/** Create a staff user with a role in a tenant; returns an Actor for service calls. */
export async function staff(tenantId: string, role: Role): Promise<Actor & { type: "staff" }> {
  const email = `${role}-${Date.now()}-${seq++}@test.local`;
  const u = (await admin().query("INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id", [
    email, `${role} user`, await hash("Password-123", { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
  ])).rows[0];
  await admin().query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)", [tenantId, u.id, role]);
  return { type: "staff", userId: u.id, role, name: `${role} user` };
}

/** A future stay window unique per call so tests never collide on dates. Each test file picks its own base. */
let offset = 30;
export function useDateBase(daysFromToday: number) {
  offset = daysFromToday;
}
export function stay(nights = 2) {
  const checkIn = addDays(todayInBangkok(), offset);
  offset += nights + 1;
  return { checkIn, checkOut: addDays(checkIn, nights) };
}

export async function ownerSession(tenantId: string) {
  const r = (await admin().query(
    `SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.tenant_id = $1 AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`, [tenantId])).rows[0];
  return { userId: r.id as string, tenantId, role: "owner" as const, name: r.name as string, email: r.email as string, isPlatformAdmin: false };
}

export const guest ={ name: "ทดสอบ ระบบ", phone: "0812345678", email: null, note: null };
