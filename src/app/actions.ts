"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { errorText, getDict, isLocale, localePath, type Locale } from "@/i18n";
import { grantBookingAccess } from "@/lib/booking-access";
import { checkRateLimit, clearRateLimit } from "@/server/auth";
import { changeBookingStatus, createBooking, getBooking, normalizePhone } from "@/server/booking";
import { clientIp, getTenant } from "@/server/context";
import { DomainError } from "@/server/errors";
import { ForbiddenError } from "@/server/rbac";

// Public (guest) actions. Every rule is enforced again inside the booking service.
// Each form sends "lang" so messages and redirects stay in the guest's language.

export type FormState = { error?: string; ok?: string } | null;

const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);
const num = (fd: FormData, k: string, min: number, max: number, fallback: number) => {
  const n = Number.parseInt(str(fd, k), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const langOf = (fd: FormData): Locale => {
  const l = str(fd, "lang", 5);
  return isLocale(l) ? l : "th";
};

function failure(e: unknown, lang: Locale): FormState {
  unstable_rethrow(e);
  if (e instanceof DomainError) return { error: errorText(lang, e) };
  if (e instanceof ForbiddenError) return { error: errorText(lang, { code: "FORBIDDEN", message: e.message }) };
  console.error("[public action]", e);
  return { error: getDict(lang).errors.system };
}

// ----- ลูกค้า: สร้างการจอง -----
export async function createBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const lang = langOf(fd);
  const err = getDict(lang).errors;
  const tenant = await getTenant();
  const name = str(fd, "name", 100);
  const email = str(fd, "email", 120);
  if (name.length < 2) return { error: err.name };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: err.email };
  if (fd.get("accept") !== "on") return { error: err.accept };
  if (!(await checkRateLimit(tenant.id, `book:${await clientIp()}`, 10, 3600))) return { error: err.tooManyBookings };

  const rooms = num(fd, "rooms", 1, 10, 1);
  const adults = num(fd, "guests", 1, 40, 2);
  const children = num(fd, "children", 0, 20, 0);
  if (adults < rooms) return { error: err.adultsPerRoom };
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
    return failure(e, lang);
  }
  await grantBookingAccess(code);
  redirect(`${localePath(lang, `/booking/${code}`)}?new=1`);
}

// ----- ลูกค้า: ค้นหาการจอง -----
export async function lookupBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const lang = langOf(fd);
  const err = getDict(lang).errors;
  const tenant = await getTenant();
  const key = `lookup:${await clientIp()}`;
  if (!(await checkRateLimit(tenant.id, key, 5, 900))) return { error: err.tooManyTries };
  const code = str(fd, "code", 20).toUpperCase();
  const b = code ? await getBooking(tenant.id, code) : null;
  if (!b || b.guest_phone !== normalizePhone(str(fd, "phone", 30))) return { error: err.lookupFailed };
  await clearRateLimit(tenant.id, key);
  await grantBookingAccess(b.code);
  redirect(localePath(lang, `/booking/${b.code}`));
}

// ----- ลูกค้า: ยกเลิกการจอง (ต้องยืนยันด้วยเบอร์โทร) -----
export async function cancelBookingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const lang = langOf(fd);
  const tenant = await getTenant();
  if (!(await checkRateLimit(tenant.id, `cancel:${await clientIp()}`, 5, 900))) return { error: getDict(lang).errors.tooManyTries };
  try {
    await changeBookingStatus(tenant.id, str(fd, "code", 20), "cancelled", { type: "guest" }, {
      guestPhone: str(fd, "phone", 30),
      reason: "ลูกค้ายกเลิกผ่านเว็บไซต์",
    });
  } catch (e) {
    return failure(e, lang);
  }
  redirect(`${localePath(lang, `/booking/${str(fd, "code", 20).toUpperCase()}`)}?cancelled=1`);
}
