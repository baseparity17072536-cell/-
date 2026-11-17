"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { grantBookingAccess } from "@/lib/booking-access";
import { checkRateLimit, clearRateLimit } from "@/server/auth";
import { changeBookingStatus, createBooking, getBooking, normalizePhone } from "@/server/booking";
import { clientIp, getTenant } from "@/server/context";
import { DomainError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac";

// Public (guest) actions. Every rule is enforced again inside the booking service.

export type FormState = { error?: string; ok?: string } | null;

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const num = (fd: FormData, k: string, min: number, max: number, fallback: number) => {
  const n = Number.parseInt(str(fd, k), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function failure(e: unknown): FormState {
  unstable_rethrow(e);
  if (e instanceof DomainError || e instanceof ForbiddenError) return { error: e.message };
  console.error("[public action]", e);
  return { error: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรือโทรติดต่อรีสอร์ท" };
}

// ----- ลูกค้า: สร้างการจอง -----
export async function createBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const tenant = await getTenant();
  const name = str(fd, "name", 100);
  const email = str(fd, "email", 120);
  if (name.length < 2) return { error: "กรุณากรอกชื่อ-นามสกุล" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "อีเมลไม่ถูกต้อง" };
  if (fd.get("accept") !== "on") return { error: "กรุณายอมรับเงื่อนไขการจองก่อนยืนยัน" };
  if (!(await checkRateLimit(tenant.id, `book:${await clientIp()}`, 10, 3600)))
    return { error: "มีการจองจากเครือข่ายนี้มากเกินไป กรุณาลองใหม่ภายหลังหรือโทรติดต่อรีสอร์ท" };

  const rooms = num(fd, "rooms", 1, 10, 1);
  const adults = num(fd, "guests", 1, 40, 2);
  const children = num(fd, "children", 0, 20, 0);
  if (adults < rooms) return { error: "ต้องมีผู้ใหญ่อย่างน้อย 1 ท่านต่อห้อง" };
  const roomTypeId = str(fd, "room", 40);
  const ratePlanId = str(fd, "plan", 40) || undefined;

  let code = "";
  try {
    const b = await createBooking(tenant.id, {
      propertyId: tenant.propertyId!,
      checkIn: str(fd, "checkin", 10),
      checkOut: str(fd, "checkout", 10),
      rooms: Array.from({ length: rooms }, (_, i) => ({
        roomTypeId,
        ratePlanId,
        adults: Math.floor(adults / rooms) + (i < adults % rooms ? 1 : 0),
        children: Math.floor(children / rooms) + (i < children % rooms ? 1 : 0),
        extraBeds: 0,
      })),
      guest: { name, phone: str(fd, "phone", 30), email: email || null, note: str(fd, "note", 500) || null },
      source: "web",
      idempotencyKey: str(fd, "idempotency_key", 80) || null,
    }, { type: "guest" });
    code = b.code;
  } catch (e) {
    return failure(e);
  }
  await grantBookingAccess(code);
  redirect(`/booking/${code}?new=1`);
}

// ----- ลูกค้า: ค้นหาการจอง -----
export async function lookupBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const tenant = await getTenant();
  const key = `lookup:${await clientIp()}`;
  if (!(await checkRateLimit(tenant.id, key, 5, 900))) return { error: "ค้นหาผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" };
  const code = str(fd, "code", 20).toUpperCase();
  const b = code ? await getBooking(tenant.id, code) : null;
  if (!b || b.guest_phone !== normalizePhone(str(fd, "phone", 30)))
    return { error: "ไม่พบการจอง กรุณาตรวจสอบรหัสการจองและเบอร์โทรศัพท์" };
  await clearRateLimit(tenant.id, key);
  await grantBookingAccess(b.code);
  redirect(`/booking/${b.code}`);
}

// ----- ลูกค้า: ยกเลิกการจอง (ต้องยืนยันด้วยเบอร์โทร) -----
export async function cancelBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const tenant = await getTenant();
  if (!(await checkRateLimit(tenant.id, `cancel:${await clientIp()}`, 5, 900)))
    return { error: "ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่" };
  try {
    await changeBookingStatus(tenant.id, str(fd, "code", 20), "cancelled", { type: "guest" }, {
      guestPhone: str(fd, "phone", 30),
      reason: "ลูกค้ายกเลิกผ่านเว็บไซต์",
    });
  } catch (e) {
    return failure(e);
  }
  redirect(`/booking/${str(fd, "code", 20).toUpperCase()}?cancelled=1`);
}
