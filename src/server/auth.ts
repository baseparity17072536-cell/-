import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { audit, enqueue, type Actor } from "./audit";
import { many, one, withTenant, type Tx } from "./db";
import { DomainError, pgCode } from "./errors";
import { ForbiddenError, ROLES, can, type Role } from "./rbac";

export const SESSION_COOKIE = "ft_session";
export const SESSION_HOURS = 12;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 60;
const MFA_CHALLENGE_MINUTES = 5;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

// argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1)
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
export const hashPassword = (pw: string) => hash(pw, ARGON);

export function checkPasswordStrength(pw: string) {
  if (pw.length < 10) return "รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร";
  if (pw.length > 200) return "รหัสผ่านยาวเกินไป";
  if (!/[a-zA-Zก-๙]/.test(pw) || !/\d/.test(pw)) return "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข";
  return null;
}

/** Fixed-window limiter stored in PostgreSQL so it works across server instances. */
export async function rateLimit(tx: Tx, key: string, limit: number, windowSeconds: number) {
  const row = await one<{ count: number }>(
    tx,
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE rate_limits.reset_at END
     RETURNING count`,
    [key, windowSeconds],
  );
  return row!.count <= limit;
}

export function checkRateLimit(tenantId: string, key: string, limit: number, windowSeconds: number) {
  return withTenant(tenantId, (tx) => rateLimit(tx, key, limit, windowSeconds));
}

export function clearRateLimit(tenantId: string, key: string) {
  return withTenant(tenantId, (tx) => tx.query("DELETE FROM rate_limits WHERE key = $1", [key]));
}

// --------------------------------------------------------------------- login --
export type StaffSession = {
  userId: string; tenantId: string; role: Role; name: string; email: string; isPlatformAdmin: boolean;
  /** user has two-factor sign-in turned on */
  mfaEnabled: boolean;
  /** owner without MFA: the session may only be used to set it up */
  mfaRequired: boolean;
};

/** "mfa": password accepted, the second factor is still needed (see mfa.ts verifyMfaLogin). */
export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: "mfa"; challenge: string; expiresAt: Date }
  | { ok: false; error: string };

/** Create a session row; the raw token goes only to the cookie. */
export async function createSession(tx: Tx, tenantId: string, userId: string, meta: { ip: string; userAgent: string }, mfaOk: boolean) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await tx.query(
    "INSERT INTO user_sessions (id, user_id, tenant_id, expires_at, ip, user_agent, mfa_ok) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [sha256(token), userId, tenantId, expiresAt, meta.ip, meta.userAgent.slice(0, 300), mfaOk],
  );
  await tx.query("DELETE FROM user_sessions WHERE user_id = $1 AND expires_at < now()", [userId]);
  return { token, expiresAt };
}

export const tokenHash = (token: string) => sha256(token);

const GENERIC_LOGIN_ERROR = "อีเมลหรือรหัสผ่านไม่ถูกต้อง";

export async function login(tenantId: string, email: string, password: string, meta: { ip: string; userAgent: string }): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  // hash outside the transaction so a slow verify does not hold a DB connection open longer than needed
  const user = await withTenant(tenantId, async (tx) => {
    if (!(await rateLimit(tx, `login:ip:${meta.ip}`, 20, 15 * 60))) return "limited" as const;
    if (!(await rateLimit(tx, `login:email:${normalized}`, 10, 15 * 60))) return "limited" as const;
    return one<{ id: string; password_hash: string; is_active: boolean; locked_until: Date | null; role: Role | null; m_active: boolean | null; mfa: boolean }>(
      tx,
      `SELECT u.id, u.password_hash, u.is_active, u.locked_until, m.role, m.is_active AS m_active, u.totp_enabled_at IS NOT NULL AS mfa
       FROM users u LEFT JOIN memberships m ON m.user_id = u.id AND m.tenant_id = $2
       WHERE u.email = $1`,
      [normalized, tenantId],
    );
  });
  if (user === "limited") return { ok: false, error: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" };
  if (!user) {
    await hashPassword(password); // equalize timing for unknown emails
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
  if (user.locked_until && user.locked_until > new Date())
    return { ok: false, error: "บัญชีถูกล็อกชั่วคราวเนื่องจากใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีหรือรีเซ็ตรหัสผ่าน" };

  const valid = await verify(user.password_hash, password).catch(() => false);
  return withTenant(tenantId, async (tx): Promise<LoginResult> => {
    if (!valid) {
      await tx.query(
        `UPDATE users SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1`,
        [user.id, LOCK_AFTER, LOCK_MINUTES],
      );
      return { ok: false, error: GENERIC_LOGIN_ERROR };
    }
    if (!user.is_active || !user.role || !user.m_active) return { ok: false, error: "บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานหลังบ้านของที่พักนี้" };

    if (user.mfa) {
      // failed_logins is reset only after the second factor succeeds
      const challenge = newToken();
      const expiresAt = new Date(Date.now() + MFA_CHALLENGE_MINUTES * 60_000);
      await tx.query("DELETE FROM mfa_challenges WHERE user_id = $1 AND (expires_at < now() OR tenant_id = $2)", [user.id, tenantId]);
      await tx.query("INSERT INTO mfa_challenges (id, user_id, tenant_id, expires_at, ip) VALUES ($1,$2,$3,$4,$5)", [sha256(challenge), user.id, tenantId, expiresAt, meta.ip]);
      return { ok: "mfa", challenge, expiresAt };
    }
    await tx.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [user.id]);
    const { token, expiresAt } = await createSession(tx, tenantId, user.id, meta, false);
    await audit(tx, tenantId, { type: "staff", userId: user.id, role: user.role, name: "", ip: meta.ip }, "auth.login", "user", user.id);
    return { ok: true, token, expiresAt };
  });
}

/** Validate a session cookie for the tenant of the current host. */
export async function getSession(tenantId: string, token: string | undefined): Promise<StaffSession | null> {
  if (!token || token.length > 100) return null;
  return withTenant(tenantId, async (tx) => {
    const s = await one<{ user_id: string; role: Role; name: string; email: string; is_platform_admin: boolean; mfa: boolean }>(
      tx,
      `SELECT s.user_id, m.role, u.name, u.email, u.is_platform_admin, u.totp_enabled_at IS NOT NULL AS mfa
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id AND u.is_active
       JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id AND m.is_active
       WHERE s.id = $1 AND s.tenant_id = $2 AND s.expires_at > now() AND s.created_at >= u.password_changed_at
         AND (u.totp_enabled_at IS NULL OR s.mfa_ok)`,
      [sha256(token), tenantId],
    );
    return s
      ? {
          userId: s.user_id, tenantId, role: s.role, name: s.name, email: s.email, isPlatformAdmin: s.is_platform_admin,
          mfaEnabled: s.mfa, mfaRequired: mfaRequiredFor(s.role) && !s.mfa,
        }
      : null;
  });
}

export async function logout(tenantId: string, token: string | undefined) {
  if (!token) return;
  await withTenant(tenantId, (tx) => tx.query("DELETE FROM user_sessions WHERE id = $1 AND tenant_id = $2", [sha256(token), tenantId]));
}

// ------------------------------------------------------------ password reset --
async function issueResetToken(tx: Tx, userId: string) {
  const token = newToken();
  await tx.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
  await tx.query(
    "INSERT INTO password_reset_tokens (id, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
    [sha256(token), userId, RESET_MINUTES],
  );
  return token;
}

/** Always succeeds from the caller's perspective (no account enumeration). Email is sent via the outbox. */
export async function requestPasswordReset(tenantId: string, email: string, baseUrl: string, ip: string) {
  await withTenant(tenantId, async (tx) => {
    if (!(await rateLimit(tx, `reset:ip:${ip}`, 5, 60 * 60))) return;
    const u = await one<{ id: string; email: string; name: string }>(
      tx,
      `SELECT u.id, u.email, u.name FROM users u JOIN memberships m ON m.user_id = u.id AND m.tenant_id = $2 AND m.is_active
       WHERE u.email = $1 AND u.is_active`,
      [email.trim().toLowerCase(), tenantId],
    );
    if (!u) return;
    const token = await issueResetToken(tx, u.id);
    await enqueue(tx, tenantId, "email", "staff.password_reset", u.email, { name: u.name, url: `${baseUrl}/admin/reset-password?token=${token}` });
  });
}

export async function resetPassword(tenantId: string, token: string, newPassword: string) {
  const weak = checkPasswordStrength(newPassword);
  if (weak) throw new DomainError("VALIDATION", weak);
  const hashed = await hashPassword(newPassword);
  await withTenant(tenantId, async (tx) => {
    const row = await one<{ user_id: string }>(
      tx,
      `UPDATE password_reset_tokens SET used_at = now()
       WHERE id = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token)],
    );
    if (!row) throw new DomainError("VALIDATION", "ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่");
    await tx.query(
      "UPDATE users SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1",
      [row.user_id, hashed],
    );
    await tx.query("DELETE FROM user_sessions WHERE user_id = $1", [row.user_id]);
    await audit(tx, tenantId, { type: "system" }, "auth.password_reset", "user", row.user_id);
  });
}

export async function changePassword(tenantId: string, session: StaffSession, current: string, next: string) {
  const weak = checkPasswordStrength(next);
  if (weak) throw new DomainError("VALIDATION", weak);
  const u = await withTenant(tenantId, (tx) => one<{ password_hash: string }>(tx, "SELECT password_hash FROM users WHERE id = $1", [session.userId]));
  if (!u || !(await verify(u.password_hash, current).catch(() => false))) throw new DomainError("VALIDATION", "รหัสผ่านปัจจุบันไม่ถูกต้อง");
  const hashed = await hashPassword(next);
  await withTenant(tenantId, async (tx) => {
    await tx.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [session.userId, hashed]);
    await tx.query("DELETE FROM user_sessions WHERE user_id = $1", [session.userId]);
    await audit(tx, tenantId, staffActor(session), "auth.password_change", "user", session.userId);
  });
}

// -------------------------------------------------------------- staff admin --
/**
 * Roles that must use two-factor sign-in, from MFA_REQUIRED_ROLES (comma-separated, e.g. "owner").
 * Unset = nobody is forced (MFA stays available to turn on in "บัญชีของฉัน").
 * Off by default since 2026-11-18 at the owner's request while testing; set "owner" before go-live.
 */
export const mfaRequiredFor = (role: Role) =>
  (process.env.MFA_REQUIRED_ROLES ?? "").split(",").map((r) => r.trim()).includes(role);

export function staffActor(s: StaffSession, ip?: string): Actor {
  return { type: "staff", userId: s.userId, role: s.role, name: s.name, ip };
}

export async function listStaff(tenantId: string, actor: StaffSession) {
  if (!can(actor.role, "users.view")) throw new ForbiddenError();
  return withTenant(tenantId, (tx) =>
    many<{ id: string; name: string; email: string; role: Role; is_active: boolean; last_login_at: Date | null; locked_until: Date | null; mfa_enabled: boolean }>(
      tx,
      `SELECT u.id, u.name, u.email, m.role, (m.is_active AND u.is_active) AS is_active, u.last_login_at, u.locked_until,
              u.totp_enabled_at IS NOT NULL AS mfa_enabled
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY m.role, u.name`,
      [tenantId],
    ),
  );
}

/**
 * Add a staff member. Returns a one-time link the owner gives to the new user to set their password
 * (works even before email delivery is configured).
 */
export async function inviteStaff(tenantId: string, actor: StaffSession, input: { email: string; name: string; role: Role }, baseUrl: string) {
  if (!can(actor.role, "users.manage")) throw new ForbiddenError();
  if (!ROLES.includes(input.role)) throw new DomainError("VALIDATION", "บทบาทไม่ถูกต้อง");
  const email = input.email.trim().toLowerCase();
  const unusable = await hashPassword(newToken());
  return withTenant(tenantId, async (tx) => {
    let user = await one<{ id: string }>(tx, "SELECT id FROM users WHERE email = $1", [email]);
    if (!user) user = await one<{ id: string }>(tx, "INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id", [email, input.name.trim(), unusable]);
    try {
      await tx.query("SAVEPOINT m");
      await tx.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)", [tenantId, user!.id, input.role]);
      await tx.query("RELEASE SAVEPOINT m");
    } catch (e) {
      await tx.query("ROLLBACK TO SAVEPOINT m");
      if (pgCode(e) === "23505") throw new DomainError("VALIDATION", "อีเมลนี้เป็นพนักงานของที่พักนี้อยู่แล้ว");
      throw e;
    }
    const token = await issueResetToken(tx, user!.id);
    const url = `${baseUrl}/admin/reset-password?token=${token}`;
    await enqueue(tx, tenantId, "email", "staff.invite", email, { name: input.name, url });
    await audit(tx, tenantId, staffActor(actor), "staff.invite", "user", user!.id, { email, role: input.role });
    return { userId: user!.id, setupUrl: url };
  });
}

export async function updateStaff(tenantId: string, actor: StaffSession, userId: string, change: { role?: Role; active?: boolean }) {
  if (!can(actor.role, "users.manage")) throw new ForbiddenError();
  if (userId === actor.userId) throw new DomainError("VALIDATION", "ไม่สามารถเปลี่ยนบทบาทหรือปิดบัญชีของตนเองได้");
  return withTenant(tenantId, async (tx) => {
    const m = await one<{ role: Role; is_active: boolean }>(tx, "SELECT role, is_active FROM memberships WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE", [tenantId, userId]);
    if (!m) throw new DomainError("NOT_FOUND", "ไม่พบพนักงาน");
    const role = change.role ?? m.role;
    const active = change.active ?? m.is_active;
    await tx.query("UPDATE memberships SET role = $3, is_active = $4 WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId, role, active]);
    const owners = await one<{ n: number }>(tx, "SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND role = 'owner' AND is_active", [tenantId]);
    if (owners!.n < 1) throw new DomainError("VALIDATION", "ต้องมีเจ้าของ (ผู้อนุมัติ) ที่ใช้งานได้อย่างน้อย 1 คน");
    if (!active || role !== m.role) await tx.query("DELETE FROM user_sessions WHERE user_id = $1 AND tenant_id = $2", [userId, tenantId]);
    await audit(tx, tenantId, staffActor(actor), "staff.update", "user", userId, { role, active });
  });
}

export async function createResetLinkFor(tenantId: string, actor: StaffSession, userId: string, baseUrl: string) {
  if (!can(actor.role, "users.manage")) throw new ForbiddenError();
  return withTenant(tenantId, async (tx) => {
    const m = await one(tx, "SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId]);
    if (!m) throw new DomainError("NOT_FOUND", "ไม่พบพนักงาน");
    const token = await issueResetToken(tx, userId);
    await audit(tx, tenantId, staffActor(actor), "staff.reset_link", "user", userId);
    return `${baseUrl}/admin/reset-password?token=${token}`;
  });
}

export async function listAudit(tenantId: string, actor: StaffSession, limit = 200) {
  if (!can(actor.role, "audit.view")) throw new ForbiddenError();
  return withTenant(tenantId, (tx) =>
    many<{ id: number; action: string; entity: string; entity_id: string | null; data: Record<string, unknown> | null; created_at: Date; user_name: string | null; ip: string | null }>(
      tx,
      `SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.created_at, a.ip, u.name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT $1`,
      [limit],
    ),
  );
}
