import "server-only";
import { verify } from "@node-rs/argon2";
import { audit, enqueue } from "./audit";
import { checkRateLimit, createSession, mfaRequiredFor, rateLimit, staffActor, tokenHash, type StaffSession } from "./auth";
import { one, withTenant, type Tx } from "./db";
import { DomainError } from "./errors";
import { can, ForbiddenError, type Role } from "./rbac";
import {
  decryptSecret, encryptSecret, generateRecoveryCodes, generateSecret, hashRecoveryCode, looksLikeRecoveryCode,
  otpauthUri, RECOVERY_COUNT, verifyTotp,
} from "./totp";

// Two-factor sign-in (TOTP). Design: docs/ARCHITECTURE_DECISIONS.md ADR-0011.

const ISSUER = "FahTalay";
const MAX_ATTEMPTS = 5;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

type Meta = { ip: string; userAgent: string };

async function storeRecoveryCodes(tx: Tx, userId: string) {
  const codes = generateRecoveryCodes();
  await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [userId]);
  for (const c of codes) await tx.query("INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)", [userId, hashRecoveryCode(c)]);
  return codes;
}

/** Check a 6-digit app code (with replay protection) or a one-time recovery code. Does not throw. */
async function checkSecondFactor(tx: Tx, userId: string, input: string): Promise<"totp" | "recovery" | null> {
  const code = input.replace(/\s/g, "");
  if (/^\d{6}$/.test(code)) {
    const u = await one<{ totp_secret: string | null; totp_last_step: string | null }>(
      tx, "SELECT totp_secret, totp_last_step FROM users WHERE id = $1 FOR UPDATE", [userId],
    );
    const secret = u?.totp_secret ? decryptSecret(u.totp_secret) : null;
    if (!secret) return null;
    const step = verifyTotp(secret, code, u!.totp_last_step === null ? null : Number(u!.totp_last_step));
    if (step === null) return null;
    await tx.query("UPDATE users SET totp_last_step = $2 WHERE id = $1", [userId, step]);
    return "totp";
  }
  if (looksLikeRecoveryCode(code)) {
    const used = await one(
      tx, "UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id",
      [userId, hashRecoveryCode(code)],
    );
    return used ? "recovery" : null;
  }
  return null;
}

// ------------------------------------------------------------------ sign-in --
export type MfaLoginResult =
  | { ok: true; token: string; expiresAt: Date; usedRecovery: boolean; recoveryLeft: number }
  | { ok: false; error: string; restart?: boolean };

/** Second step of sign-in: the challenge token comes from login() via an httpOnly cookie. */
export async function verifyMfaLogin(tenantId: string, challengeToken: string | undefined, code: string, meta: Meta): Promise<MfaLoginResult> {
  const expired = { ok: false as const, error: "หมดเวลายืนยันตัวตน กรุณาเข้าสู่ระบบใหม่", restart: true };
  if (!challengeToken || challengeToken.length > 100) return expired;
  return withTenant(tenantId, async (tx): Promise<MfaLoginResult> => {
    const c = await one<{ id: string; user_id: string; attempts: number }>(
      tx, "SELECT id, user_id, attempts FROM mfa_challenges WHERE id = $1 AND tenant_id = $2 AND expires_at > now() FOR UPDATE",
      [tokenHash(challengeToken), tenantId],
    );
    if (!c) return expired;
    const u = await one<{ role: Role | null; ok: boolean; locked_until: Date | null; email: string }>(
      tx,
      `SELECT m.role, (u.is_active AND m.is_active AND u.totp_enabled_at IS NOT NULL) AS ok, u.locked_until, u.email
       FROM users u LEFT JOIN memberships m ON m.user_id = u.id AND m.tenant_id = $2 WHERE u.id = $1`,
      [c.user_id, tenantId],
    );
    if (!u?.ok || !u.role) {
      await tx.query("DELETE FROM mfa_challenges WHERE id = $1", [c.id]);
      return expired;
    }
    if (u.locked_until && u.locked_until > new Date())
      return { ok: false, error: "บัญชีถูกล็อกชั่วคราวเนื่องจากยืนยันผิดหลายครั้ง กรุณารอ 15 นาที", restart: true };
    if (!(await rateLimit(tx, `mfa:user:${c.user_id}`, 10, 15 * 60)))
      return { ok: false, error: "ลองยืนยันบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่", restart: true };

    const factor = await checkSecondFactor(tx, c.user_id, code);
    if (!factor) {
      // count toward the same lockout as wrong passwords
      await tx.query(
        `UPDATE users SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1`,
        [c.user_id, LOCK_AFTER, LOCK_MINUTES],
      );
      if (c.attempts + 1 >= MAX_ATTEMPTS) {
        await tx.query("DELETE FROM mfa_challenges WHERE id = $1", [c.id]);
        return { ok: false, error: "รหัสไม่ถูกต้องหลายครั้ง กรุณาเข้าสู่ระบบใหม่", restart: true };
      }
      await tx.query("UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1", [c.id]);
      return { ok: false, error: "รหัสยืนยันไม่ถูกต้อง หรือถูกใช้ไปแล้ว" };
    }

    await tx.query("DELETE FROM mfa_challenges WHERE id = $1", [c.id]);
    await tx.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [c.user_id]);
    const { token, expiresAt } = await createSession(tx, tenantId, c.user_id, meta, true);
    const actor = { type: "staff" as const, userId: c.user_id, role: u.role, name: "", ip: meta.ip };
    await audit(tx, tenantId, actor, "auth.login", "user", c.user_id, { mfa: factor });
    const left = (await one<{ n: number }>(tx, "SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", [c.user_id]))!.n;
    if (factor === "recovery") {
      await audit(tx, tenantId, actor, "auth.mfa_recovery_used", "user", c.user_id, { remaining: left });
      await enqueue(tx, tenantId, "email", "staff.mfa_recovery_used", u.email, { remaining: left, ip: meta.ip });
    }
    return { ok: true, token, expiresAt, usedRecovery: factor === "recovery", recoveryLeft: left };
  });
}

// --------------------------------------------------------------- enrollment --
// own transaction: a failed attempt throws, which would roll back an in-transaction counter
async function setupLimit(tenantId: string, session: StaffSession) {
  if (!(await checkRateLimit(tenantId, `mfa-setup:user:${session.userId}`, 10, 15 * 60)))
    throw new DomainError("RATE_LIMITED", "ลองบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่");
}

export type MfaStatus = { enabled: boolean; recoveryLeft: number; setup: { secret: string; uri: string } | null };

/**
 * For the setup page. When not enrolled, makes sure a pending secret exists (idempotent: the
 * same secret is shown until it is confirmed, so reloading the page does not invalidate a scan).
 */
export async function getMfaStatus(tenantId: string, session: StaffSession): Promise<MfaStatus> {
  return withTenant(tenantId, async (tx) => {
    const u = await one<{ totp_secret: string | null; enabled: boolean }>(
      tx, "SELECT totp_secret, totp_enabled_at IS NOT NULL AS enabled FROM users WHERE id = $1 FOR UPDATE", [session.userId],
    );
    const left = (await one<{ n: number }>(tx, "SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL", [session.userId]))!.n;
    if (u!.enabled) return { enabled: true, recoveryLeft: left, setup: null };
    let secret = u!.totp_secret ? decryptSecret(u!.totp_secret) : null;
    if (!secret) {
      secret = generateSecret();
      await tx.query("UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1", [session.userId, encryptSecret(secret)]);
    }
    return { enabled: false, recoveryLeft: 0, setup: { secret, uri: otpauthUri(ISSUER, session.email, secret) } };
  });
}

/** Confirm enrollment with a code from the app. Returns recovery codes (shown once). */
export async function confirmMfaSetup(tenantId: string, session: StaffSession, code: string, currentSessionToken: string | undefined) {
  await setupLimit(tenantId, session);
  return withTenant(tenantId, async (tx) => {
    const u = await one<{ enabled: boolean; has_secret: boolean }>(
      tx, "SELECT totp_enabled_at IS NOT NULL AS enabled, totp_secret IS NOT NULL AS has_secret FROM users WHERE id = $1", [session.userId],
    );
    if (u!.enabled) throw new DomainError("VALIDATION", "เปิดการยืนยันตัวตน 2 ขั้นตอนไว้แล้ว");
    if (!u!.has_secret) throw new DomainError("VALIDATION", "กรุณาเปิดหน้าตั้งค่าใหม่อีกครั้ง");
    if (!/^\d{6}$/.test(code.replace(/\s/g, "")) || (await checkSecondFactor(tx, session.userId, code)) !== "totp")
      throw new DomainError("VALIDATION", "รหัสไม่ถูกต้อง ตรวจว่าเวลาในโทรศัพท์ตั้งเป็นอัตโนมัติ แล้วลองรหัสล่าสุด");
    await tx.query("UPDATE users SET totp_enabled_at = now() WHERE id = $1", [session.userId]);
    const codes = await storeRecoveryCodes(tx, session.userId);
    // this browser just proved the second factor; every other session of the user is signed out
    await tx.query("DELETE FROM user_sessions WHERE user_id = $1 AND id <> $2", [session.userId, currentSessionToken ? tokenHash(currentSessionToken) : ""]);
    if (currentSessionToken) await tx.query("UPDATE user_sessions SET mfa_ok = true WHERE id = $1", [tokenHash(currentSessionToken)]);
    await audit(tx, tenantId, staffActor(session), "auth.mfa_enabled", "user", session.userId);
    return codes;
  });
}

/** New set of recovery codes; requires a current app code. */
export async function regenerateRecoveryCodes(tenantId: string, session: StaffSession, code: string) {
  await setupLimit(tenantId, session);
  return withTenant(tenantId, async (tx) => {
    if (!session.mfaEnabled) throw new DomainError("VALIDATION", "ยังไม่ได้เปิดการยืนยันตัวตน 2 ขั้นตอน");
    if ((await checkSecondFactor(tx, session.userId, code)) !== "totp") throw new DomainError("VALIDATION", "รหัสจากแอปไม่ถูกต้อง");
    const codes = await storeRecoveryCodes(tx, session.userId);
    await audit(tx, tenantId, staffActor(session), "auth.mfa_recovery_regenerated", "user", session.userId);
    return codes;
  });
}

/**
 * Turn MFA off for yourself (re-checks the password). For roles where MFA is required this is
 * "move to a new phone": requireStaff() sends them straight back to setup, so it cannot be skipped.
 * Returns true when setup must be done again.
 */
export async function disableMfa(tenantId: string, session: StaffSession, password: string) {
  if (!session.mfaEnabled) throw new DomainError("VALIDATION", "ยังไม่ได้เปิดการยืนยันตัวตน 2 ขั้นตอน");
  const u = await withTenant(tenantId, (tx) => one<{ password_hash: string }>(tx, "SELECT password_hash FROM users WHERE id = $1", [session.userId]));
  if (!u || !(await verify(u.password_hash, password).catch(() => false))) throw new DomainError("VALIDATION", "รหัสผ่านไม่ถูกต้อง");
  await withTenant(tenantId, async (tx) => {
    await clearMfa(tx, session.userId);
    await audit(tx, tenantId, staffActor(session), "auth.mfa_disabled", "user", session.userId);
  });
  return mfaRequiredFor(session.role);
}

async function clearMfa(tx: Tx, userId: string) {
  await tx.query("UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1", [userId]);
  await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [userId]);
  await tx.query("DELETE FROM mfa_challenges WHERE user_id = $1", [userId]);
}

/**
 * Owner resets another staff member's MFA (lost phone). They are signed out and must set it up
 * again (owners are forced to at next sign-in). An owner cannot reset their own: use a recovery code.
 */
export async function resetMfaFor(tenantId: string, actor: StaffSession, userId: string) {
  if (!can(actor.role, "users.manage")) throw new ForbiddenError();
  if (userId === actor.userId) throw new DomainError("VALIDATION", "รีเซ็ตของตนเองไม่ได้ ใช้รหัสกู้คืนเพื่อเข้าสู่ระบบแล้วตั้งค่าใหม่");
  await withTenant(tenantId, async (tx) => {
    const m = await one(tx, "SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId]);
    if (!m) throw new DomainError("NOT_FOUND", "ไม่พบพนักงาน");
    await clearMfa(tx, userId);
    await tx.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
    await audit(tx, tenantId, staffActor(actor), "staff.mfa_reset", "user", userId);
  });
}

export { RECOVERY_COUNT };
