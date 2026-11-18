import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";

// สิทธิ์ดูข้อมูลส่วนบุคคลในหน้า /booking/[code]
// ได้รับเมื่อสร้างการจอง หรือยืนยันรหัสการจอง + เบอร์โทรในหน้า lookup แล้วเท่านั้น
// ลงลายเซ็นด้วย APP_SECRET (HMAC) — ไม่ต้องเก็บใน DB และปลอมไม่ได้

const COOKIE = "ft_access";
const MAX_CODES = 10;

function secret() {
  const base = process.env.APP_SECRET;
  if (!base || base.length < 32) throw new Error("APP_SECRET is missing or shorter than 32 characters (see docs/ENVIRONMENT_SETUP.md)");
  return base;
}

function sign(code: string) {
  return createHmac("sha256", secret()).update(`booking-access:${code}`).digest("base64url").slice(0, 22);
}

function readEntries(raw: string | undefined) {
  return (raw ?? "").split(".").filter(Boolean);
}

/**
 * Cookies set before the language versions had path /booking; a browser may then send two cookies with
 * the same name. Parsed cookie maps keep only one, so read every copy from the raw header.
 */
async function allEntries() {
  const raw = (await headers()).get("cookie") ?? "";
  const values = raw.split(";").map((p) => p.trim()).filter((p) => p.startsWith(`${COOKIE}=`)).map((p) => p.slice(COOKIE.length + 1));
  const decode = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return ""; // a tampered cookie grants nothing
    }
  };
  return [...new Set(values.flatMap((v) => readEntries(decode(v))))];
}

export async function grantBookingAccess(code: string) {
  const jar = await cookies();
  const entry = `${code}~${sign(code)}`;
  const kept = (await allEntries()).filter((e) => !e.startsWith(`${code}~`));
  jar.set(COOKIE, [entry, ...kept].slice(0, MAX_CODES).join("."), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // "/" so the same access works on /booking/… and /en/booking/…, /zh/booking/…
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function hasBookingAccess(code: string) {
  const expected = Buffer.from(sign(code));
  return (await allEntries())
    .filter((e) => e.startsWith(`${code}~`))
    .some((e) => {
      const given = Buffer.from(e.slice(code.length + 1));
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}
