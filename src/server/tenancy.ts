import "server-only";
import { one, withoutTenant } from "./db";

export type Tenant = { id: string; slug: string; name: string; status: "active" | "suspended"; propertyId: string | null };

const cache = new Map<string, { value: Tenant | null; at: number }>();
const TTL = 60_000;

export function normalizeHost(host: string | null | undefined) {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Resolve the tenant from the request Host header (tenant_domains). Never from client-supplied data. */
export async function resolveTenantByHost(rawHost: string | null | undefined): Promise<Tenant | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await withoutTenant(async (tx) => {
    const t = await one<{ id: string; slug: string; name: string; status: "active" | "suspended" }>(
      tx,
      `SELECT t.id, t.slug, t.name, t.status FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id WHERE d.host = $1`,
      [host],
    );
    if (!t) return null;
    // properties are RLS-protected: read the default property inside the tenant context
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
    const p = await one<{ id: string }>(tx, "SELECT id FROM properties WHERE is_active ORDER BY created_at LIMIT 1");
    return { ...t, propertyId: p?.id ?? null };
  });
  cache.set(host, { value, at: Date.now() });
  return value;
}

export function clearTenantCache() {
  cache.clear();
}
