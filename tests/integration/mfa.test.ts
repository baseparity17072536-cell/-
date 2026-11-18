import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSession, inviteStaff, login, resetPassword, type StaffSession } from "@/server/auth";
import { confirmMfaSetup, disableMfa, getMfaStatus, regenerateRecoveryCodes, resetMfaFor, verifyMfaLogin } from "@/server/mfa";
import type { Role } from "@/server/rbac";
import { totpAt } from "@/server/totp";
import { admin, closePools, fahtalay, ownerSession, useAppPool } from "../setup/helpers";

process.env.APP_SECRET ??= "integration-test-secret-0123456789-abcdef";
// these tests cover the enforced mode (production setting before go-live)
process.env.MFA_REQUIRED_ROLES = "owner";

let ctx: Awaited<ReturnType<typeof fahtalay>>;
let seq = 0;
const PW = "Mfa-test-pass-1";
const meta = (n: number) => ({ ip: `10.9.${n >> 8}.${n & 255}`, userAgent: "vitest" });

beforeAll(async () => {
  useAppPool();
  ctx = await fahtalay();
});
afterAll(closePools);

async function newUser(role: Role) {
  const email = `mfa-${role}-${Date.now()}-${seq++}@test.local`;
  const inv = await inviteStaff(ctx.tenantId, await ownerSession(ctx.tenantId), { email, name: `MFA ${role}`, role }, "http://x");
  await resetPassword(ctx.tenantId, new URL(inv.setupUrl).searchParams.get("token")!, PW);
  return { email, userId: inv.userId };
}

// a distinct address per sign-in so the per-IP login limiter (20 / 15 min) does not interfere
let ipSeq = 10;
async function passwordLogin(email: string, ip = ipSeq++) {
  return login(ctx.tenantId, email, PW, meta(ip));
}

async function sessionOf(email: string) {
  const r = await passwordLogin(email);
  if (r.ok !== true) throw new Error("expected a session");
  return { token: r.token, session: (await getSession(ctx.tenantId, r.token))! };
}

/** Enrolls the user; returns secret, recovery codes and the (now MFA-verified) session. */
async function enroll(email: string) {
  const { token, session } = await sessionOf(email);
  const secret = (await getMfaStatus(ctx.tenantId, session)).setup!.secret;
  const codes = await confirmMfaSetup(ctx.tenantId, session, totpAt(secret, Date.now()), token);
  return { secret, codes, token, session: (await getSession(ctx.tenantId, token))! };
}

const later = (secret: string, steps: number) => totpAt(secret, Date.now() + steps * 30_000);

describe("MFA enrollment", () => {
  it("an owner without MFA gets a setup-only session; staff roles do not", async () => {
    const owner = await newUser("owner");
    expect((await sessionOf(owner.email)).session).toMatchObject({ mfaEnabled: false, mfaRequired: true });
    const desk = await newUser("front_desk");
    expect((await sessionOf(desk.email)).session).toMatchObject({ mfaEnabled: false, mfaRequired: false });
  });

  it("with MFA_REQUIRED_ROLES unset nobody is forced, and MFA can still be turned on", async () => {
    const owner = await newUser("owner");
    process.env.MFA_REQUIRED_ROLES = "";
    try {
      expect((await sessionOf(owner.email)).session).toMatchObject({ mfaEnabled: false, mfaRequired: false });
      const { session } = await enroll(owner.email);
      expect(session).toMatchObject({ mfaEnabled: true, mfaRequired: false });
      expect((await passwordLogin(owner.email)).ok).toBe("mfa"); // once on, it is always asked
    } finally {
      process.env.MFA_REQUIRED_ROLES = "owner";
    }
  });

  it("shows the same pending secret until confirmed and stores it encrypted", async () => {
    const u = await newUser("owner");
    const { session } = await sessionOf(u.email);
    const a = await getMfaStatus(ctx.tenantId, session);
    const b = await getMfaStatus(ctx.tenantId, session);
    expect(a.setup!.secret).toBe(b.setup!.secret);
    expect(a.setup!.uri).toContain(`secret=${a.setup!.secret}`);
    const stored = (await admin().query("SELECT totp_secret FROM users WHERE id = $1", [u.userId])).rows[0].totp_secret as string;
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(a.setup!.secret);
  });

  it("rejects a wrong code, then enables with a right one: 10 recovery codes, other sessions signed out", async () => {
    const u = await newUser("owner");
    const other = await sessionOf(u.email); // e.g. another browser
    const { token, session } = await sessionOf(u.email);
    const secret = (await getMfaStatus(ctx.tenantId, session)).setup!.secret;
    await expect(confirmMfaSetup(ctx.tenantId, session, "000000", token)).rejects.toThrow("รหัสไม่ถูกต้อง");
    const codes = await confirmMfaSetup(ctx.tenantId, session, totpAt(secret, Date.now()), token);
    expect(codes).toHaveLength(10);
    expect(await getSession(ctx.tenantId, token)).toMatchObject({ mfaEnabled: true, mfaRequired: false });
    expect(await getSession(ctx.tenantId, other.token)).toBeNull();
    const audit = (await admin().query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.mfa_enabled' AND entity_id = $1", [u.userId])).rows[0].n;
    expect(audit).toBe(1);
  });
});

describe("MFA sign-in", () => {
  it("a session made without the second factor is never valid once MFA is on (defense in depth)", async () => {
    const u = await newUser("admin");
    await enroll(u.email);
    // e.g. a session row created by a race or a future code path that forgets the second step
    const token = `raw-${Date.now()}`;
    const { createHash } = await import("node:crypto");
    await admin().query(
      "INSERT INTO user_sessions (id, user_id, tenant_id, expires_at, mfa_ok) VALUES ($1,$2,$3, now() + interval '1 hour', false)",
      [createHash("sha256").update(token).digest("hex"), u.userId, ctx.tenantId],
    );
    expect(await getSession(ctx.tenantId, token)).toBeNull();
  });

  it("password alone no longer creates a session; the app code completes sign-in", async () => {
    const u = await newUser("owner");
    const { secret } = await enroll(u.email);
    const before = (await admin().query("SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1", [u.userId])).rows[0].n;
    const r = await passwordLogin(u.email);
    expect(r.ok).toBe("mfa");
    if (r.ok !== "mfa") return;
    expect((await admin().query("SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1", [u.userId])).rows[0].n).toBe(before);

    expect(await verifyMfaLogin(ctx.tenantId, r.challenge, "111111", meta(1))).toMatchObject({ ok: false });
    const ok = await verifyMfaLogin(ctx.tenantId, r.challenge, later(secret, 1), meta(1));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(await getSession(ctx.tenantId, ok.token)).toMatchObject({ mfaEnabled: true });
    // the challenge is single-use
    expect(await verifyMfaLogin(ctx.tenantId, r.challenge, later(secret, 1), meta(1))).toMatchObject({ ok: false, restart: true });
  });

  it("a code cannot be replayed, even on a new sign-in", async () => {
    const u = await newUser("admin");
    const { secret } = await enroll(u.email);
    const code = later(secret, 1);
    const first = await passwordLogin(u.email);
    if (first.ok !== "mfa") throw new Error("expected mfa");
    expect((await verifyMfaLogin(ctx.tenantId, first.challenge, code, meta(1))).ok).toBe(true);
    const second = await passwordLogin(u.email);
    if (second.ok !== "mfa") throw new Error("expected mfa");
    expect(await verifyMfaLogin(ctx.tenantId, second.challenge, code, meta(1))).toMatchObject({ ok: false, error: "รหัสยืนยันไม่ถูกต้อง หรือถูกใช้ไปแล้ว" });
  });

  it("a recovery code works exactly once and is reported", async () => {
    const u = await newUser("owner");
    const { codes } = await enroll(u.email);
    const r1 = await passwordLogin(u.email);
    if (r1.ok !== "mfa") throw new Error("expected mfa");
    const ok = await verifyMfaLogin(ctx.tenantId, r1.challenge, codes[0].toLowerCase(), meta(1));
    expect(ok).toMatchObject({ ok: true, usedRecovery: true, recoveryLeft: 9 });
    const r2 = await passwordLogin(u.email);
    if (r2.ok !== "mfa") throw new Error("expected mfa");
    expect((await verifyMfaLogin(ctx.tenantId, r2.challenge, codes[0], meta(1))).ok).toBe(false);
    const n = (await admin().query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.mfa_recovery_used' AND entity_id = $1", [u.userId])).rows[0].n;
    expect(n).toBe(1);
  });

  it("5 wrong codes end the attempt and lock the account like wrong passwords", async () => {
    const u = await newUser("owner");
    const { secret } = await enroll(u.email);
    const r = await passwordLogin(u.email, 7);
    if (r.ok !== "mfa") throw new Error("expected mfa");
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await verifyMfaLogin(ctx.tenantId, r.challenge, String(100000 + i), meta(7)));
    expect(results.at(-1)).toMatchObject({ ok: false, restart: true });
    // locked: even the right password + right code fail now
    const again = await passwordLogin(u.email, 7);
    expect(again).toMatchObject({ ok: false });
    expect((await admin().query("SELECT locked_until > now() AS locked FROM users WHERE id = $1", [u.userId])).rows[0].locked).toBe(true);
    void secret;
  });

  it("rejects expired, unknown and other-hotel challenges", async () => {
    const u = await newUser("owner");
    const { secret } = await enroll(u.email);
    expect(await verifyMfaLogin(ctx.tenantId, undefined, "123456", meta(1))).toMatchObject({ ok: false, restart: true });
    expect(await verifyMfaLogin(ctx.tenantId, "not-a-real-token", "123456", meta(1))).toMatchObject({ ok: false, restart: true });

    const other = (await admin().query(
      "INSERT INTO tenants (slug, name) VALUES ('mfa-other', 'Other') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
    )).rows[0].id as string;
    const r = await passwordLogin(u.email);
    if (r.ok !== "mfa") throw new Error("expected mfa");
    expect(await verifyMfaLogin(other, r.challenge, later(secret, 1), meta(1))).toMatchObject({ ok: false, restart: true });

    await admin().query("UPDATE mfa_challenges SET expires_at = now() - interval '1 second' WHERE user_id = $1", [u.userId]);
    expect(await verifyMfaLogin(ctx.tenantId, r.challenge, later(secret, 1), meta(1))).toMatchObject({ ok: false, restart: true });
  });
});

describe("MFA management", () => {
  it("regenerating recovery codes needs an app code and invalidates the old set", async () => {
    const u = await newUser("admin");
    const { secret, codes, session } = await enroll(u.email);
    await expect(regenerateRecoveryCodes(ctx.tenantId, session, "000000")).rejects.toThrow("รหัสจากแอปไม่ถูกต้อง");
    const fresh = await regenerateRecoveryCodes(ctx.tenantId, session, later(secret, 1));
    expect(fresh).toHaveLength(10);
    const r = await passwordLogin(u.email);
    if (r.ok !== "mfa") throw new Error("expected mfa");
    expect((await verifyMfaLogin(ctx.tenantId, r.challenge, codes[1], meta(1))).ok).toBe(false);
    expect((await verifyMfaLogin(ctx.tenantId, r.challenge, fresh[1], meta(1))).ok).toBe(true);
  });

  it("staff can turn MFA off with their password; an owner is sent back to setup instead", async () => {
    const desk = await newUser("front_desk");
    const d = await enroll(desk.email);
    await expect(disableMfa(ctx.tenantId, d.session, "wrong-password-1")).rejects.toThrow("รหัสผ่านไม่ถูกต้อง");
    expect(await disableMfa(ctx.tenantId, d.session, PW)).toBe(false);
    expect(await passwordLogin(desk.email)).toMatchObject({ ok: true });

    const owner = await newUser("owner");
    const o = await enroll(owner.email);
    expect(await disableMfa(ctx.tenantId, o.session, PW)).toBe(true);
    expect(await getSession(ctx.tenantId, o.token)).toMatchObject({ mfaEnabled: false, mfaRequired: true });
  });

  it("an owner resets another member's MFA; others cannot, nobody resets their own", async () => {
    const target = await newUser("admin");
    const t = await enroll(target.email);
    const owner: StaffSession = await ownerSession(ctx.tenantId);
    await expect(resetMfaFor(ctx.tenantId, { ...t.session }, owner.userId)).rejects.toThrow("คุณไม่มีสิทธิ์");
    await expect(resetMfaFor(ctx.tenantId, owner, owner.userId)).rejects.toThrow("รีเซ็ตของตนเองไม่ได้");
    await resetMfaFor(ctx.tenantId, owner, target.userId);
    expect(await getSession(ctx.tenantId, t.token)).toBeNull(); // signed out
    expect(await passwordLogin(target.email)).toMatchObject({ ok: true }); // password-only again
    const row = (await admin().query("SELECT totp_secret, totp_enabled_at FROM users WHERE id = $1", [target.userId])).rows[0];
    expect(row).toEqual({ totp_secret: null, totp_enabled_at: null });
  });
});
