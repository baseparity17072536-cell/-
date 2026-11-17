import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "ft_admin";

function password() {
  const p = process.env.ADMIN_PASSWORD;
  if (!p) throw new Error("ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ในไฟล์ .env.local");
  return p;
}

function token() {
  return createHmac("sha256", password()).update("fahtalay-admin-session").digest("hex");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(input: string) {
  return safeEqual(input, password());
}

export function sessionToken() {
  return token();
}

export async function isAdmin() {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  return !!value && safeEqual(value, token());
}
