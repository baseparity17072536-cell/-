import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// สิทธิ์ดูข้อมูลส่วนบุคคลในหน้า /booking/[code]
// ได้รับเมื่อสร้างการจอง หรือยืนยันรหัสการจอง + เบอร์โทรในหน้า lookup แล้วเท่านั้น
// (ชั่วคราวจนกว่าจะมี guest token ในฐานข้อมูลตาม Phase 0 หัวข้อ 10.6)

const COOKIE = "ft_access";
const MAX_CODES = 10;

function secret() {
  const base = process.env.BOOKING_ACCESS_SECRET ?? process.env.ADMIN_PASSWORD;
  if (!base) throw new Error("ยังไม่ได้ตั้งค่า BOOKING_ACCESS_SECRET หรือ ADMIN_PASSWORD ในไฟล์ .env.local");
  return base;
}

function sign(code: string) {
  return createHmac("sha256", secret()).update(`booking-access:${code}`).digest("base64url").slice(0, 22);
}

function readEntries(raw: string | undefined) {
  return (raw ?? "").split(".").filter(Boolean);
}

export async function grantBookingAccess(code: string) {
  const jar = await cookies();
  const entry = `${code}~${sign(code)}`;
  const kept = readEntries(jar.get(COOKIE)?.value).filter((e) => !e.startsWith(`${code}~`));
  jar.set(COOKIE, [entry, ...kept].slice(0, MAX_CODES).join("."), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/booking",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function hasBookingAccess(code: string) {
  const entry = readEntries((await cookies()).get(COOKIE)?.value).find((e) => e.startsWith(`${code}~`));
  if (!entry) return false;
  const given = Buffer.from(entry.slice(code.length + 1));
  const expected = Buffer.from(sign(code));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
