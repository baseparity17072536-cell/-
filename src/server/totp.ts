import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238) on top of HOTP (RFC 4226): HMAC-SHA1, 30-second steps, 6 digits —
// the defaults every authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) uses.
export const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // accept one step either side for clock drift

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret (RFC 4226 recommendation), base32 for authenticator apps. */
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

export function hotp(key: Buffer, counter: number, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

export function totpAt(secretB32: string, ms: number) {
  return hotp(base32Decode(secretB32), stepAt(ms));
}

/**
 * Returns the matched step, or null. A step at or before `lastStep` is rejected so a code
 * that was already used (or an older one) cannot be replayed.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, ms = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretB32);
  const now = stepAt(ms);
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    if (lastStep !== null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(code))) return s;
  }
  return null;
}

export function otpauthUri(issuer: string, account: string, secretB32: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q}`;
}

// ------------------------------------------------------- secret at rest --
// AES-256-GCM with a key derived from APP_SECRET. Rotating APP_SECRET makes stored
// secrets unreadable: users then sign in with a recovery code and enroll again.
function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SECRET is missing or shorter than 32 characters (see docs/ENVIRONMENT_SETUP.md)");
  return Buffer.from(hkdfSync("sha256", secret, "fahtalay", "totp-secret-v1", 32));
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct].map((x) => (typeof x === "string" ? x : x.toString("base64url"))).join(".");
}

/** null when the value cannot be decrypted (tampered, or APP_SECRET changed). */
export function decryptSecret(stored: string): string | null {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ------------------------------------------------------- recovery codes --
const RC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const RECOVERY_COUNT = 10;

/** 10 codes like "K7QX-M2PA" (8 chars × 5 bits = 40 bits each). */
export function generateRecoveryCodes(n = RECOVERY_COUNT) {
  return Array.from({ length: n }, () => {
    const s = Array.from(randomBytes(8), (b) => RC[b % RC.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const normalizeRecoveryCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashRecoveryCode = (c: string) => createHash("sha256").update(normalizeRecoveryCode(c)).digest("hex");
export const looksLikeRecoveryCode = (c: string) => /^[A-Z0-9]{8}$/.test(normalizeRecoveryCode(c)) && !/^\d{8}$/.test(normalizeRecoveryCode(c));
