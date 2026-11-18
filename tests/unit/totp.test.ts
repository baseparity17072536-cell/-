import { describe, expect, it } from "vitest";
import {
  base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCodes, generateSecret, hashRecoveryCode, hotp,
  looksLikeRecoveryCode, otpauthUri, totpAt, verifyTotp,
} from "@/server/totp";

process.env.APP_SECRET ??= "unit-test-secret-0123456789-abcdefghij";

// RFC 4226 Appendix D / RFC 6238 Appendix B use the ASCII secret "12345678901234567890"
const RFC_KEY = Buffer.from("12345678901234567890");
const RFC_B32 = base32Encode(RFC_KEY);

describe("TOTP (RFC 4226 / RFC 6238 test vectors)", () => {
  it("HOTP values for counters 0–9", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expect(expected.map((_, i) => hotp(RFC_KEY, i))).toEqual(expected);
  });

  it("TOTP values at the RFC 6238 times (last 6 of the 8-digit values)", () => {
    const cases: [number, string][] = [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"]];
    for (const [t, code] of cases) expect(totpAt(RFC_B32, t * 1000)).toBe(code);
  });

  it("base32 round-trips and matches the RFC 4648 alphabet", () => {
    expect(RFC_B32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_B32).equals(RFC_KEY)).toBe(true);
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
  });

  it("accepts ±1 step for clock drift, rejects further and rejects replays", () => {
    const t = 1_700_000_000_000;
    const step = Math.floor(t / 30_000);
    const code = totpAt(RFC_B32, t);
    expect(verifyTotp(RFC_B32, code, null, t)).toBe(step);
    expect(verifyTotp(RFC_B32, code, null, t + 30_000)).toBe(step); // phone 30 s behind
    expect(verifyTotp(RFC_B32, code, null, t - 30_000)).toBe(step); // phone 30 s ahead
    expect(verifyTotp(RFC_B32, code, null, t + 90_000)).toBeNull();
    expect(verifyTotp(RFC_B32, code, step, t)).toBeNull(); // already used
    expect(verifyTotp(RFC_B32, code, step - 1, t)).toBe(step);
    for (const bad of ["", "12345", "1234567", "abcdef", " 12345"]) expect(verifyTotp(RFC_B32, bad, null, t)).toBeNull();
  });

  it("builds an otpauth URI that authenticator apps understand", () => {
    const u = new URL(otpauthUri("FahTalay", "owner@hotel.test", RFC_B32));
    expect(u.protocol).toBe("otpauth:");
    expect(u.host).toBe("totp");
    expect(decodeURIComponent(u.pathname)).toBe("/FahTalay:owner@hotel.test");
    expect(Object.fromEntries(u.searchParams)).toEqual({ secret: RFC_B32, issuer: "FahTalay", algorithm: "SHA1", digits: "6", period: "30" });
  });
});

describe("secret encryption at rest", () => {
  it("round-trips, uses a fresh IV each time and never contains the plaintext", () => {
    const a = encryptSecret(RFC_B32);
    const b = encryptSecret(RFC_B32);
    expect(a).not.toBe(b);
    expect(a).not.toContain(RFC_B32);
    expect(decryptSecret(a)).toBe(RFC_B32);
  });

  it("returns null when tampered or when APP_SECRET changed", () => {
    const enc = encryptSecret(RFC_B32);
    const parts = enc.split(".");
    const flipped = parts[3][0] === "A" ? "B" : "A";
    expect(decryptSecret([...parts.slice(0, 3), flipped + parts[3].slice(1)].join("."))).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    const saved = process.env.APP_SECRET;
    process.env.APP_SECRET = "a-completely-different-secret-0123456789";
    try {
      expect(decryptSecret(enc)).toBeNull();
    } finally {
      process.env.APP_SECRET = saved;
    }
  });
});

describe("recovery codes", () => {
  it("10 unique codes in XXXX-XXXX form without look-alike characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("hash ignores case, spaces and dashes; app codes are not mistaken for recovery codes", () => {
    expect(hashRecoveryCode("k7qx m2pa")).toBe(hashRecoveryCode("K7QX-M2PA"));
    expect(looksLikeRecoveryCode("K7QX-M2PA")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("12345678")).toBe(false);
  });
});
