import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { getSession, inviteStaff, login, logout, resetPassword, updateStaff } from "@/server/auth";
import { admin, closePools, fahtalay, ownerSession, useAppPool } from "../setup/helpers";

let ctx: Awaited<ReturnType<typeof fahtalay>>;
const meta = { ip: "10.0.0.1", userAgent: "vitest" };
beforeAll(async () => {
  useAppPool();
  ctx = await fahtalay();
});
afterAll(closePools);

describe("staff authentication", () => {
  it("owner logs in, gets a session, logs out", async () => {
    const r = await login(ctx.tenantId, "OWNER@fahtalay.test", inject("ownerPassword"), meta);
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    const s = await getSession(ctx.tenantId, r.token);
    expect(s).toMatchObject({ role: "owner", email: "owner@fahtalay.test" });
    // raw token is never stored
    const stored = (await admin().query("SELECT count(*)::int AS n FROM user_sessions WHERE id = $1", [r.token])).rows[0].n;
    expect(stored).toBe(0);
    await logout(ctx.tenantId, r.token);
    expect(await getSession(ctx.tenantId, r.token)).toBeNull();
  });

  it("a session is only valid for the tenant it was issued for", async () => {
    const r = await login(ctx.tenantId, "owner@fahtalay.test", inject("ownerPassword"), { ...meta, ip: "10.0.0.2" });
    if (r.ok !== true) throw new Error(r.ok === false ? r.error : "unexpected mfa step");
    const other = (await admin().query("SELECT id FROM tenants WHERE slug <> 'fahtalay' LIMIT 1")).rows[0];
    if (other) expect(await getSession(other.id, r.token)).toBeNull();
  });

  it("same generic error for wrong password and unknown email; locks after 5 failures", async () => {
    const invite = await inviteStaff(ctx.tenantId, await ownerSession(ctx.tenantId), { email: "lock@test.local", name: "Lock", role: "front_desk" }, "http://x");
    await resetPassword(ctx.tenantId, new URL(invite.setupUrl).searchParams.get("token")!, "Correct-pass-1");
    const unknown = await login(ctx.tenantId, "nobody@test.local", "whatever-123", { ...meta, ip: "10.0.0.3" });
    const wrong = await login(ctx.tenantId, "lock@test.local", "wrong-pass-1", { ...meta, ip: "10.0.0.3" });
    expect(unknown).toEqual(wrong);
    for (let i = 0; i < 4; i++) await login(ctx.tenantId, "lock@test.local", "wrong-pass-1", { ...meta, ip: "10.0.0.3" });
    const locked = await login(ctx.tenantId, "lock@test.local", "Correct-pass-1", { ...meta, ip: "10.0.0.3" });
    expect(locked).toMatchObject({ ok: false, error: expect.stringMatching(/ล็อก/) });
  });

  it("password reset token works once and invalidates old sessions; deactivated staff lose access", async () => {
    const owner = await ownerSession(ctx.tenantId);
    const inv = await inviteStaff(ctx.tenantId, owner,{ email: "reset@test.local", name: "Reset", role: "admin" }, "http://x");
    const token = new URL(inv.setupUrl).searchParams.get("token")!;
    await expect(resetPassword(ctx.tenantId, token, "short")).rejects.toThrow(/อย่างน้อย 10/);
    await resetPassword(ctx.tenantId, token, "Brand-new-pass-1");
    await expect(resetPassword(ctx.tenantId, token, "Another-pass-2")).rejects.toThrow(/หมดอายุ/);
    const r = await login(ctx.tenantId, "reset@test.local", "Brand-new-pass-1", { ...meta, ip: "10.0.0.4" });
    if (r.ok !== true) throw new Error(r.ok === false ? r.error : "unexpected mfa step");
    await updateStaff(ctx.tenantId, owner, inv.userId, { active: false });
    expect(await getSession(ctx.tenantId, r.token)).toBeNull();
    expect((await login(ctx.tenantId, "reset@test.local", "Brand-new-pass-1", { ...meta, ip: "10.0.0.4" })).ok).toBe(false);
  });

  it("owners cannot demote themselves and the last active owner cannot be removed", async () => {
    const owner = await ownerSession(ctx.tenantId);
    await expect(updateStaff(ctx.tenantId, owner, owner.userId, { role: "admin" })).rejects.toThrow(/ของตนเอง/);
    // a second owner tries to demote the first while they are the only two -> allowed; then the last one is protected
    const inv = await inviteStaff(ctx.tenantId, owner, { email: "owner2@test.local", name: "Owner 2", role: "owner" }, "http://x");
    const others = (await admin().query(
      "SELECT user_id FROM memberships WHERE tenant_id = $1 AND role = 'owner' AND is_active AND user_id <> $2", [ctx.tenantId, inv.userId])).rows;
    const owner2 = { ...owner, userId: inv.userId };
    for (const o of others) await updateStaff(ctx.tenantId, owner2, o.user_id, { role: "admin" });
    await expect(updateStaff(ctx.tenantId, owner, inv.userId, { role: "admin" })).rejects.toThrow(/อย่างน้อย 1 คน/);
    for (const o of others) await updateStaff(ctx.tenantId, owner2, o.user_id, { role: "owner" });
  });
});
