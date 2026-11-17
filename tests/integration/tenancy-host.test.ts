import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { clearTenantCache, resolveTenantByHost } from "@/server/tenancy";
import { admin, closePools, useAppPool } from "../setup/helpers";

const saved = process.env.DEFAULT_TENANT_SLUG;

beforeAll(async () => {
  useAppPool();
  await admin().query(
    `INSERT INTO tenant_domains (host, tenant_id) SELECT 'known-host.test', id FROM tenants WHERE slug = 'fahtalay'
     ON CONFLICT (host) DO NOTHING`,
  );
});
afterEach(() => {
  if (saved === undefined) delete process.env.DEFAULT_TENANT_SLUG;
  else process.env.DEFAULT_TENANT_SLUG = saved;
  clearTenantCache();
});
afterAll(async () => {
  await admin().query("DELETE FROM tenant_domains WHERE host = 'known-host.test'");
  await closePools();
});

describe("resolveTenantByHost", () => {
  it("resolves a registered host (case, port and trailing dot ignored)", async () => {
    delete process.env.DEFAULT_TENANT_SLUG;
    const t = await resolveTenantByHost("Known-Host.test.:3000");
    expect(t?.slug).toBe("fahtalay");
    expect(t?.propertyId).toBeTruthy();
  });

  it("returns null for an unknown host when DEFAULT_TENANT_SLUG is unset", async () => {
    delete process.env.DEFAULT_TENANT_SLUG;
    expect(await resolveTenantByHost("abc123-sommao.vercel.app")).toBeNull();
  });

  it("falls back to DEFAULT_TENANT_SLUG for an unknown host", async () => {
    process.env.DEFAULT_TENANT_SLUG = " FahTalay ";
    const t = await resolveTenantByHost("abc123-sommao.vercel.app");
    expect(t?.slug).toBe("fahtalay");
    expect(t?.propertyId).toBeTruthy();
  });

  it("returns null when DEFAULT_TENANT_SLUG names no tenant", async () => {
    process.env.DEFAULT_TENANT_SLUG = "no-such-hotel";
    expect(await resolveTenantByHost("abc123-sommao.vercel.app")).toBeNull();
  });

  it("a registered host wins over the fallback", async () => {
    await admin().query(
      "INSERT INTO tenants (slug, name) VALUES ('fallback-other', 'Other') ON CONFLICT (slug) DO NOTHING",
    );
    process.env.DEFAULT_TENANT_SLUG = "fallback-other";
    expect((await resolveTenantByHost("known-host.test"))?.slug).toBe("fahtalay");
  });
});
