import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getSession, SESSION_COOKIE, staffActor, type StaffSession } from "./auth";
import { decide, type Permission } from "./rbac";
import { resolveTenantByHost, type Tenant } from "./tenancy";

/** Tenant of the current request, from the Host header only (never from client-controlled input). */
export const getTenant = cache(async (): Promise<Tenant> => {
  // tenant data is per-request (host-based) and the DB driver reads the clock:
  // mark the render as request-time before touching either (Cache Components)
  await connection();
  const h = await headers();
  const t = await resolveTenantByHost(h.get("x-forwarded-host") && process.env.TRUST_PROXY_HOST === "1" ? h.get("x-forwarded-host") : h.get("host"));
  if (!t) throw new Error("ไม่พบโรงแรมสำหรับโดเมนนี้ (tenant_domains)");
  if (t.status !== "active") throw new Error("บัญชีโรงแรมนี้ถูกระงับการใช้งาน");
  if (!t.propertyId) throw new Error("โรงแรมนี้ยังไม่มีข้อมูลที่พัก");
  return t;
});

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function baseUrl() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${h.get("host")}`;
}

export const getStaff = cache(async (): Promise<StaffSession | null> => {
  const t = await getTenant();
  return getSession(t.id, (await cookies()).get(SESSION_COOKIE)?.value);
});

/**
 * For admin pages and actions: redirects to login when there is no valid session.
 * `access` is "allow" | "approval" | "deny" for the given permission (UI hint only —
 * every service re-checks permissions itself).
 */
export async function requireStaff(permission?: Permission) {
  const tenant = await getTenant();
  const session = await getStaff();
  if (!session) redirect("/admin/login");
  // owners must finish two-factor setup before using anything else (pages and actions alike)
  if (session.mfaRequired) redirect("/admin/mfa-setup");
  const access = permission ? decide(session.role, permission) : ("allow" as const);
  return { tenant, propertyId: tenant.propertyId!, session, actor: staffActor(session, await clientIp()), access };
}
