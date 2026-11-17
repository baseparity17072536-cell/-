"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { BookingError, createBooking, findBooking, updateStatus, type BookingStatus } from "@/lib/bookings";
import { parseStay } from "@/lib/search";
import { ADMIN_COOKIE, checkPassword, isAdmin, sessionToken } from "@/lib/admin-auth";
import { grantBookingAccess } from "@/lib/booking-access";
import { clientIp, hit, reset } from "@/lib/rate-limit";

const MINUTE = 60_000;

export type FormState = { error?: string; ok?: string } | null;

const digits = (v: string) => v.replace(/\D/g, "");
const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);

// ----- ลูกค้า: สร้างการจอง -----
export async function createBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const stay = parseStay({
    checkin: str(fd, "checkin"),
    checkout: str(fd, "checkout"),
    guests: str(fd, "guests"),
    rooms: str(fd, "rooms"),
  });
  if (!stay.ok) return { error: stay.error ?? "ข้อมูลวันที่ไม่ถูกต้อง" };

  const name = str(fd, "name", 100);
  const phone = str(fd, "phone", 30);
  const email = str(fd, "email", 120);
  const note = str(fd, "note", 500);

  if (name.length < 2) return { error: "กรุณากรอกชื่อ-นามสกุล" };
  const phoneDigits = digits(phone);
  if (phoneDigits.length < 9 || phoneDigits.length > 12) return { error: "เบอร์โทรศัพท์ไม่ถูกต้อง" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "อีเมลไม่ถูกต้อง" };
  if (fd.get("accept") !== "on") return { error: "กรุณายอมรับเงื่อนไขการจองก่อนยืนยัน" };
  if (!hit(`book:${await clientIp()}`, 10, 60 * MINUTE))
    return { error: "มีการจองจากเครือข่ายนี้มากเกินไป กรุณาลองใหม่ภายหลังหรือโทรติดต่อรีสอร์ท" };

  let code: string;
  try {
    const b = await createBooking({
      roomTypeId: str(fd, "room"),
      checkIn: stay.search.checkIn,
      checkOut: stay.search.checkOut,
      nights: stay.search.nights,
      rooms: stay.search.rooms,
      guests: stay.search.guests,
      guest: { name, phone, email, note },
    });
    code = b.code;
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  await grantBookingAccess(code);
  redirect(`/booking/${code}?new=1`);
}

// ----- ลูกค้า: ค้นหาการจอง -----
export async function lookupBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const key = `lookup:${await clientIp()}`;
  if (!hit(key, 5, 15 * MINUTE)) return { error: "ค้นหาผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" };
  const code = str(fd, "code", 20).toUpperCase();
  const phone = digits(str(fd, "phone", 30));
  const b = code ? await findBooking(code) : null;
  if (!b || digits(b.guest.phone) !== phone) return { error: "ไม่พบการจอง กรุณาตรวจสอบรหัสการจองและเบอร์โทรศัพท์" };
  reset(key);
  await grantBookingAccess(b.code);
  redirect(`/booking/${b.code}`);
}

// ----- ลูกค้า: ยกเลิกการจอง (ต้องยืนยันด้วยเบอร์โทร) -----
export async function cancelBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (!hit(`cancel:${await clientIp()}`, 5, 15 * MINUTE))
    return { error: "ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" };
  const code = str(fd, "code", 20);
  const b = await findBooking(code);
  if (!b || digits(b.guest.phone) !== digits(str(fd, "phone", 30)))
    return { error: "เบอร์โทรศัพท์ไม่ตรงกับข้อมูลการจอง" };
  try {
    await updateStatus(b.code, "cancelled", "guest");
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  refresh();
  return { ok: "ยกเลิกการจองเรียบร้อยแล้ว" };
}

// ----- แอดมิน -----
export async function adminLoginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (!process.env.ADMIN_PASSWORD) return { error: "ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ในไฟล์ .env.local" };
  const key = `admin-login:${await clientIp()}`;
  if (!hit(key, 5, 15 * MINUTE)) return { error: "ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" };
  if (!checkPassword(String(fd.get("password") ?? ""))) return { error: "รหัสผ่านไม่ถูกต้อง" };
  reset(key);
  (await cookies()).set(ADMIN_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return null;
}

export async function adminLogoutAction() {
  (await cookies()).delete(ADMIN_COOKIE);
}

const STATUSES: BookingStatus[] = ["confirmed", "cancelled"];

export async function adminSetStatusAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (!(await isAdmin())) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  const status = String(fd.get("status")) as BookingStatus;
  if (!STATUSES.includes(status)) return { error: "สถานะไม่ถูกต้อง" };
  try {
    await updateStatus(str(fd, "code", 20), status, "admin");
  } catch (e) {
    if (e instanceof BookingError) return { error: e.message };
    throw e;
  }
  refresh();
  return null;
}
