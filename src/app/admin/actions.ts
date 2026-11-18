"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { LOCALES, type Translations } from "@/i18n";
import { isIsoDate } from "@/lib/dates";
import { parseBaht } from "@/lib/money";
import { reviewChangeRequest, withdrawChangeRequest } from "@/server/approvals";
import {
  changePassword, createResetLinkFor, inviteStaff, login, logout, requestPasswordReset, resetPassword,
  SESSION_COOKIE, SESSION_HOURS, updateStaff,
} from "@/server/auth";
import { assignRoom, changeBookingStatus, createBooking, type BookingSource } from "@/server/booking";
import { changeRoomType, changeStayDates, totalChangeMessage, updateBookingDetails } from "@/server/booking-changes";
import { createTicket, updateTicketStatus, type TicketPriority, type TicketStatus } from "@/server/operations";
import { BOOKING_STATUSES, type BookingStatus } from "@/server/booking-status";
import {
  addRoomTypeImage, bulkCreateRooms, deleteRoomTypeImage, moveRoomTypeImage, savePriceRule, saveRatePlan, saveRoom,
  saveRoomType, setDailyRates, setHousekeepingStatus, updateProperty, type ApplyResult,
} from "@/server/catalog";
import { baseUrl, clientIp, getStaff, getTenant, requireStaff } from "@/server/context";
import { DomainError } from "@/server/errors";
import { confirmMfaSetup, disableMfa, regenerateRecoveryCodes, resetMfaFor, verifyMfaLogin } from "@/server/mfa";
import { ForbiddenError, ROLES } from "@/server/rbac";
import { deleteStoredFile, saveImage } from "@/server/storage";

/** `codes`: one-time recovery codes, shown once after MFA setup. */
export type ActionState = { error?: string; ok?: string; link?: string; codes?: string[] } | null;

// --------------------------------------------------------------- plumbing --
const PENDING = "ส่งคำขอให้เจ้าของอนุมัติแล้ว การเปลี่ยนแปลงจะมีผลเมื่อได้รับอนุมัติ";

async function run(fn: () => Promise<ActionState | string | void>): Promise<ActionState> {
  try {
    const r = await fn();
    refresh();
    if (typeof r === "string") return { ok: r };
    return r ?? { ok: "บันทึกเรียบร้อย" };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    if (e instanceof DomainError || e instanceof ForbiddenError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
    console.error("[admin action]", e);
    return { error: "เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่ หากยังเกิดซ้ำให้แจ้งผู้ดูแลระบบ" };
  }
}

const applied = (r: ApplyResult, ok = "บันทึกเรียบร้อย") => (r.pendingApproval ? PENDING : ok);

const s = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? "").trim().slice(0, max);
const opt = (fd: FormData, k: string, max = 500) => s(fd, k, max) || null;
const int = (fd: FormData, k: string, label: string, min = 0, max = 100_000) => {
  const raw = s(fd, k);
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < min || n > max) throw new DomainError("VALIDATION", `${label} ต้องเป็นจำนวนเต็ม ${min}–${max}`);
  return n;
};
const money = (fd: FormData, k: string, label: string) => {
  const v = parseBaht(s(fd, k));
  if (v === null || v < 0) throw new DomainError("VALIDATION", `${label} ต้องเป็นจำนวนเงินที่ถูกต้อง`);
  return v;
};
const date = (fd: FormData, k: string, label: string) => {
  const v = s(fd, k);
  if (!isIsoDate(v)) throw new DomainError("VALIDATION", `กรุณาเลือก${label}`);
  return v;
};
const optDate = (fd: FormData, k: string) => {
  const v = s(fd, k);
  return v && isIsoDate(v) ? v : null;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const uuid = (fd: FormData, k: string) => {
  const v = s(fd, k);
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new DomainError("VALIDATION", "ข้อมูลอ้างอิงไม่ถูกต้อง");
  return v;
};
/** Other-language fields named tr_<lang>_<field> (see TranslationFields). Empty values are left out. */
const translationsFrom = (fd: FormData, fields: string[], lists: string[] = []): Translations => {
  const out: Translations = {};
  for (const lang of LOCALES.filter((l) => l !== "th")) {
    const entry: Record<string, string | string[]> = {};
    for (const f of [...fields, ...lists]) {
      const v = s(fd, `tr_${lang}_${f}`, 3000);
      if (!v) continue;
      entry[f] = lists.includes(f) ? v.split(/\r?\n/).map((a) => a.trim()).filter(Boolean).slice(0, 40) : v;
    }
    if (Object.keys(entry).length) out[lang] = entry;
  }
  return out;
};
const en = (t: Translations, f: string) => {
  const v = t.en?.[f];
  return typeof v === "string" ? v : null;
};

const weekdays = (fd: FormData) => fd.getAll("weekdays").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

// -------------------------------------------------------------------- auth --
export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const tenant = await getTenant();
  const email = s(fd, "email", 200);
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  const r = await login(tenant.id, email, password, { ip: await clientIp(), userAgent: "" });
  if (!r.ok) return { error: r.error };
  const jar = await cookies();
  if (r.ok === "mfa") {
    jar.set(MFA_COOKIE, r.challenge, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/admin", expires: r.expiresAt,
    });
    redirect("/admin/login/verify");
  }
  setSessionCookie(jar, r.token);
  redirect("/admin");
}

// ---------------------------------------------------------- two-factor (MFA) --
const MFA_COOKIE = "ft_mfa";

function setSessionCookie(jar: Awaited<ReturnType<typeof cookies>>, token: string) {
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600,
  });
}

export async function verifyMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const tenant = await getTenant();
  const jar = await cookies();
  const r = await verifyMfaLogin(tenant.id, jar.get(MFA_COOKIE)?.value, s(fd, "code", 20), { ip: await clientIp(), userAgent: "" });
  if (!r.ok) {
    if (r.restart) jar.delete({ name: MFA_COOKIE, path: "/admin" });
    return { error: r.error };
  }
  jar.delete({ name: MFA_COOKIE, path: "/admin" });
  setSessionCookie(jar, r.token);
  redirect(r.usedRecovery ? `/admin/account?recovery_left=${r.recoveryLeft}` : "/admin");
}

/** MFA setup is reachable before setup is finished, so it cannot use requireStaff (which redirects here). */
async function sessionForMfa() {
  const tenant = await getTenant();
  const session = await getStaff();
  if (!session) redirect("/admin/login");
  return { tenant, session };
}

// Not wrapped in run(): run() refreshes the page, and the setup page redirects away once MFA is
// on, so the one-time recovery codes would never be seen. The user continues with the page link.
export async function confirmMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { tenant, session } = await sessionForMfa();
  try {
    const codes = await confirmMfaSetup(tenant.id, session, s(fd, "code", 20), (await cookies()).get(SESSION_COOKIE)?.value);
    return { ok: "เปิดการยืนยันตัวตน 2 ขั้นตอนแล้ว", codes };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function regenerateRecoveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, session } = await requireStaff();
    const codes = await regenerateRecoveryCodes(tenant.id, session, s(fd, "code", 20));
    return { ok: "สร้างรหัสกู้คืนชุดใหม่แล้ว รหัสชุดเดิมใช้ไม่ได้อีก", codes };
  });
}

export async function disableMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, session } = await requireStaff();
    if (await disableMfa(tenant.id, session, String(fd.get("password") ?? ""))) redirect("/admin/mfa-setup");
    return "ปิดการยืนยันตัวตน 2 ขั้นตอนแล้ว";
  });
}

export async function resetMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, session } = await requireStaff("users.manage");
    await resetMfaFor(tenant.id, session, uuid(fd, "user_id"));
    return "รีเซ็ตการยืนยันตัวตน 2 ขั้นตอนแล้ว พนักงานต้องตั้งค่าใหม่";
  });
}

export async function logoutAction() {
  const tenant = await getTenant();
  const jar = await cookies();
  await logout(tenant.id, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const tenant = await getTenant();
  const email = s(fd, "email", 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "กรุณากรอกอีเมลให้ถูกต้อง" };
  await requestPasswordReset(tenant.id, email, await baseUrl(), await clientIp());
  return { ok: "ถ้าอีเมลนี้มีบัญชีอยู่ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ภายในไม่กี่นาที (ลิงก์ใช้ได้ 60 นาที) หากยังไม่ได้ตั้งค่าระบบอีเมล ให้ขอลิงก์จากเจ้าของในหน้าพนักงาน" };
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const tenant = await getTenant();
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { error: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };
  try {
    await resetPassword(tenant.id, s(fd, "token", 200), pw);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/admin/login?reset=1");
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, session } = await requireStaff();
    const next = String(fd.get("next") ?? "");
    if (next !== String(fd.get("confirm") ?? "")) throw new DomainError("VALIDATION", "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
    await changePassword(tenant.id, session, String(fd.get("current") ?? ""), next);
    (await cookies()).delete(SESSION_COOKIE);
    redirect("/admin/login?changed=1");
  });
}

// ---------------------------------------------------------------- bookings --
const SOURCES: BookingSource[] = ["phone", "walk_in", "facebook", "line", "web"];

export async function createStaffBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let code = "";
  const r = await run(async () => {
    const { tenant, propertyId, actor } = await requireStaff("booking.create");
    const source = s(fd, "source") as BookingSource;
    if (!SOURCES.includes(source)) throw new DomainError("VALIDATION", "กรุณาเลือกช่องทางการจอง");
    const typeIds = fd.getAll("room_type").map(String);
    const rooms = typeIds.map((roomTypeId, i) => {
      const adults = Number(fd.getAll("adults")[i]);
      const children = Number(fd.getAll("children")[i] ?? 0);
      const extraBeds = Number(fd.getAll("extra_beds")[i] ?? 0);
      if (!/^[0-9a-f-]{36}$/.test(roomTypeId)) throw new DomainError("VALIDATION", `กรุณาเลือกประเภทห้องของห้องที่ ${i + 1}`);
      if (![adults, children, extraBeds].every((n) => Number.isInteger(n) && n >= 0 && n <= 20))
        throw new DomainError("VALIDATION", `จำนวนผู้เข้าพักของห้องที่ ${i + 1} ไม่ถูกต้อง`);
      return { roomTypeId, ratePlanId: s(fd, `rate_plan_${i}`) || undefined, adults, children, extraBeds };
    });
    const b = await createBooking(tenant.id, {
      propertyId,
      checkIn: date(fd, "check_in", "วันเช็คอิน"),
      checkOut: date(fd, "check_out", "วันเช็คเอาท์"),
      rooms,
      guest: { name: s(fd, "name", 100), phone: s(fd, "phone", 30), email: opt(fd, "email", 120), note: opt(fd, "note", 1000) },
      source,
      confirmNow: bool(fd, "confirm_now"),
      internalNote: opt(fd, "internal_note", 1000),
      idempotencyKey: opt(fd, "idempotency_key", 80),
    }, actor);
    code = b.code;
  });
  if (code) redirect(`/admin/bookings/${code}?created=1`);
  return r;
}

export async function bookingStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("booking.status");
    const to = s(fd, "to") as BookingStatus;
    if (!BOOKING_STATUSES.includes(to)) throw new DomainError("VALIDATION", "สถานะไม่ถูกต้อง");
    if (to === "cancelled" && !s(fd, "reason")) throw new DomainError("VALIDATION", "กรุณาระบุเหตุผลการยกเลิก");
    const code = s(fd, "code", 20);
    const r = await changeBookingStatus(tenant.id, code, to, actor, {
      reason: opt(fd, "reason", 500),
      expectedVersion: int(fd, "version", "version", 0, 1_000_000),
    });
    const done = r.pendingApproval ? "approval" : to;
    // quick actions on the dashboard return there; the result is shown as a banner either way
    if (s(fd, "back") === "dashboard") redirect(`/admin?done=${done}&code=${encodeURIComponent(code)}`);
    // the button that was clicked disappears with the new status, so show the result as a page banner
    redirect(`/admin/bookings/${code}?done=${done}`);
  });
}

export async function assignRoomAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("booking.assign_room");
    const roomId = s(fd, "room_id");
    await assignRoom(tenant.id, uuid(fd, "booking_room_id"), roomId ? uuid(fd, "room_id") : null, actor);
    return roomId ? "จัดห้องเรียบร้อย" : "ยกเลิกการจัดห้องแล้ว";
  });
}

export async function changeDatesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("booking.modify");
    const r = await changeStayDates(tenant.id, s(fd, "code", 20), { checkIn: date(fd, "check_in", "วันเช็คอิน"), checkOut: date(fd, "check_out", "วันเช็คเอาท์") }, actor,
      { expectedVersion: int(fd, "version", "version", 0, 1_000_000) });
    const note = r.unassigned.length ? ` · ยกเลิกการจัดห้อง ${r.unassigned.join(", ")} เพราะไม่ว่างในวันที่ใหม่ กรุณาจัดห้องใหม่` : "";
    return `เปลี่ยนวันที่เรียบร้อย · ${totalChangeMessage(r.totalBefore, r.totalAfter)}${note}`;
  });
}

export async function changeRoomTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("booking.modify");
    const r = await changeRoomType(tenant.id, uuid(fd, "booking_room_id"), uuid(fd, "room_type_id"), actor,
      { keepPrice: bool(fd, "keep_price"), expectedVersion: int(fd, "version", "version", 0, 1_000_000) });
    return `เปลี่ยนประเภทห้องเรียบร้อย กรุณาจัดเลขห้องใหม่ · ${totalChangeMessage(r.totalBefore, r.totalAfter)}`;
  });
}

export async function bookingDetailsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("booking.modify");
    const r = await updateBookingDetails(tenant.id, s(fd, "code", 20), {
      name: s(fd, "name", 120), phone: s(fd, "phone", 30), email: opt(fd, "email", 200),
      specialRequest: opt(fd, "special_request", 1000), internalNote: opt(fd, "internal_note", 1000),
    }, actor, { expectedVersion: int(fd, "version", "version", 0, 1_000_000) });
    return r.changed.length ? "บันทึกข้อมูลเรียบร้อย" : "ไม่มีข้อมูลที่เปลี่ยน";
  });
}

// ------------------------------------------------------------------ catalog --
export async function saveRoomTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let createdId = "";
  const r = await run(async () => {
    const { tenant, propertyId, actor } = await requireStaff("catalog.edit");
    const code = s(fd, "code", 20).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new DomainError("VALIDATION", "รหัสประเภทห้องต้องเป็น A–Z, 0–9, _ หรือ - ยาว 2–20 ตัว");
    const name = s(fd, "name_th", 120);
    if (name.length < 2) throw new DomainError("VALIDATION", "กรุณากรอกชื่อประเภทห้อง (ภาษาไทย)");
    const video = opt(fd, "video_url", 500);
    if (video && !/^https:\/\//.test(video)) throw new DomainError("VALIDATION", "ลิงก์วิดีโอต้องขึ้นต้นด้วย https://");
    const id = s(fd, "id") || undefined;
    const translations = translationsFrom(fd, ["name", "description", "bed_info", "view_type"], ["amenities"]);
    const result = await saveRoomType(tenant.id, {
      id,
      property_id: propertyId,
      code,
      slug: code.toLowerCase().replace(/_/g, "-"),
      name_th: name,
      name_en: en(translations, "name"),
      description_th: s(fd, "description_th", 3000),
      description_en: en(translations, "description"),
      translations,
      bed_info: s(fd, "bed_info", 120),
      bed_count: int(fd, "bed_count", "จำนวนเตียง", 0, 20),
      view_type: s(fd, "view_type", 80),
      building: opt(fd, "building", 80),
      video_url: video,
      size_sqm: s(fd, "size_sqm") ? int(fd, "size_sqm", "ขนาดห้อง", 1, 10_000) : null,
      base_adults: int(fd, "base_adults", "ผู้ใหญ่ที่รวมในราคา", 1, 50),
      max_adults: int(fd, "max_adults", "ผู้ใหญ่สูงสุด", 1, 50),
      max_children: int(fd, "max_children", "เด็กสูงสุด", 0, 50),
      max_occupancy: int(fd, "max_occupancy", "ผู้เข้าพักสูงสุด", 1, 100),
      max_extra_beds: int(fd, "max_extra_beds", "เตียงเสริมสูงสุด", 0, 10),
      base_price_satang: money(fd, "base_price", "ราคาพื้นฐาน"),
      extra_adult_satang: money(fd, "extra_adult", "ค่าผู้ใหญ่เพิ่ม"),
      child_satang: money(fd, "child_price", "ค่าเด็ก"),
      extra_bed_satang: money(fd, "extra_bed", "ค่าเตียงเสริม"),
      amenities: s(fd, "amenities", 2000).split(/\r?\n|,/).map((a) => a.trim()).filter(Boolean).slice(0, 40),
      sort_order: int(fd, "sort_order", "ลำดับการแสดง", 0, 1000),
      is_active: bool(fd, "is_active"),
    }, actor);
    if (!id) createdId = result.id!;
    return result.pendingApproval ? "บันทึกข้อมูลห้องแล้ว · การเปลี่ยนราคาส่งให้เจ้าของอนุมัติ" : "บันทึกเรียบร้อย";
  });
  if (createdId) redirect(`/admin/rooms/${createdId}?created=1`);
  return r;
}

export async function saveRoomAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("catalog.edit");
    const status = s(fd, "status") as "active" | "maintenance" | "inactive";
    if (!["active", "maintenance", "inactive"].includes(status)) throw new DomainError("VALIDATION", "สถานะห้องไม่ถูกต้อง");
    const number = s(fd, "room_number", 20);
    if (!number) throw new DomainError("VALIDATION", "กรุณากรอกหมายเลขห้อง");
    await saveRoom(tenant.id, {
      id: s(fd, "id") || undefined, room_type_id: uuid(fd, "room_type_id"), room_number: number,
      building: opt(fd, "building", 40), floor: opt(fd, "floor", 20), zone: opt(fd, "zone", 40), status, note: opt(fd, "note", 500),
    }, actor);
  });
}

export async function bulkRoomsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("catalog.edit");
    const nums = await bulkCreateRooms(tenant.id, {
      room_type_id: uuid(fd, "room_type_id"), start: s(fd, "start", 20), count: int(fd, "count", "จำนวนห้อง", 1, 200),
      building: opt(fd, "building", 40), floor: opt(fd, "floor", 20), zone: opt(fd, "zone", 40),
    }, actor);
    return `เพิ่ม ${nums.length} ห้อง: ${nums[0]} – ${nums[nums.length - 1]}`;
  });
}

export async function housekeepingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("housekeeping.update");
    const st = s(fd, "status") as "clean" | "dirty" | "inspected" | "out_of_service";
    if (!["clean", "dirty", "inspected", "out_of_service"].includes(st)) throw new DomainError("VALIDATION", "สถานะไม่ถูกต้อง");
    await setHousekeepingStatus(tenant.id, uuid(fd, "room_id"), st, actor);
    return "อัปเดตสถานะแม่บ้านแล้ว";
  });
}

export async function createTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, propertyId, actor } = await requireStaff("maintenance.report");
    const priority = s(fd, "priority") as TicketPriority;
    if (!["low", "normal", "urgent"].includes(priority)) throw new DomainError("VALIDATION", "ระดับความเร่งด่วนไม่ถูกต้อง");
    const r = await createTicket(tenant.id, propertyId, {
      roomId: s(fd, "room_id") ? uuid(fd, "room_id") : null, location: opt(fd, "location", 120), title: s(fd, "title", 200),
      detail: opt(fd, "detail", 2000), priority, blockRoom: bool(fd, "block_room"),
    }, actor);
    return r.roomBlocked ? "บันทึกงานซ่อมแล้ว และปิดห้องงดขายระหว่างซ่อม" : "บันทึกงานซ่อมแล้ว";
  });
}

export async function ticketStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("maintenance.manage");
    const to = s(fd, "to") as TicketStatus;
    if (!["open", "in_progress", "done", "cancelled"].includes(to)) throw new DomainError("VALIDATION", "สถานะไม่ถูกต้อง");
    const r = await updateTicketStatus(tenant.id, uuid(fd, "id"), to, actor, { resolution: opt(fd, "reason", 2000) });
    return r.reopened ? `ปิดงานแล้ว ห้อง ${r.reopened} กลับมาขายได้ (สถานะรอทำความสะอาด)` : "อัปเดตงานซ่อมแล้ว";
  });
}

export async function uploadImageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("catalog.edit");
    const typeId = uuid(fd, "room_type_id");
    const files = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new DomainError("VALIDATION", "กรุณาเลือกรูปภาพ");
    if (files.length > 10) throw new DomainError("VALIDATION", "อัปโหลดได้ครั้งละไม่เกิน 10 รูป");
    for (const f of files) {
      const url = await saveImage(tenant.id, f);
      await addRoomTypeImage(tenant.id, typeId, url, s(fd, "alt", 200), actor);
    }
    return `อัปโหลด ${files.length} รูปเรียบร้อย`;
  });
}

export async function imageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("catalog.edit");
    const id = uuid(fd, "image_id");
    const op = s(fd, "op");
    if (op === "delete") {
      const img = await deleteRoomTypeImage(tenant.id, id, actor);
      await deleteStoredFile(tenant.id, img.url);
      return "ลบรูปแล้ว";
    }
    await moveRoomTypeImage(tenant.id, id, op === "up" ? -1 : 1, actor);
    return "จัดลำดับรูปแล้ว";
  });
}

// ------------------------------------------------------------------- rates --
export async function saveRatePlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, propertyId, actor } = await requireStaff("rates.edit");
    const adjust_type = s(fd, "adjust_type") as "none" | "percent" | "fixed";
    if (!["none", "percent", "fixed"].includes(adjust_type)) throw new DomainError("VALIDATION", "รูปแบบการปรับราคาไม่ถูกต้อง");
    const meal = s(fd, "meal_plan") as "room_only" | "breakfast" | "half_board" | "full_board";
    if (!["room_only", "breakfast", "half_board", "full_board"].includes(meal)) throw new DomainError("VALIDATION", "ประเภทอาหารไม่ถูกต้อง");
    const raw = s(fd, "adjust_value") || "0";
    const adjust_value = adjust_type === "fixed" ? parseBaht(raw) : Number(raw);
    if (adjust_value === null || !Number.isFinite(adjust_value) || !Number.isInteger(adjust_value))
      throw new DomainError("VALIDATION", adjust_type === "percent" ? "เปอร์เซ็นต์ต้องเป็นจำนวนเต็ม" : "จำนวนเงินปรับราคาไม่ถูกต้อง");
    const code = s(fd, "code", 20).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new DomainError("VALIDATION", "รหัสแพ็กเกจต้องเป็น A–Z, 0–9, _ หรือ - ยาว 2–20 ตัว");
    const translations = translationsFrom(fd, ["name", "description"]);
    const r = await saveRatePlan(tenant.id, {
      id: s(fd, "id") || undefined, property_id: propertyId, code, name_th: s(fd, "name_th", 120), name_en: en(translations, "name"), translations,
      description_th: s(fd, "description_th", 1000), meal_plan: meal, adjust_type, adjust_value: adjust_type === "none" ? 0 : adjust_value,
      min_nights: int(fd, "min_nights", "พักขั้นต่ำ", 1, 60), is_refundable: bool(fd, "is_refundable"), is_default: bool(fd, "is_default"),
      is_active: bool(fd, "is_active"), sort_order: int(fd, "sort_order", "ลำดับ", 0, 1000),
    }, actor);
    return applied(r);
  });
}

export async function savePriceRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("rates.edit");
    const kind = s(fd, "kind") as "weekday" | "season" | "holiday" | "event";
    if (!["weekday", "season", "holiday", "event"].includes(kind)) throw new DomainError("VALIDATION", "ประเภทกฎราคาไม่ถูกต้อง");
    const typeIds = fd.getAll("room_type_id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
    const id = s(fd, "id") || undefined;
    if (!typeIds.length) throw new DomainError("VALIDATION", "กรุณาเลือกประเภทห้องอย่างน้อย 1 ประเภท");
    if (id && typeIds.length > 1) throw new DomainError("VALIDATION", "การแก้ไขกฎเดิมเลือกได้ 1 ประเภทห้อง");
    const name = s(fd, "name", 80);
    if (!name) throw new DomainError("VALIDATION", "กรุณาตั้งชื่อกฎราคา");
    let pending = false;
    for (const room_type_id of typeIds) {
      const r = await savePriceRule(tenant.id, {
        id, room_type_id, name, kind, date_from: optDate(fd, "date_from"), date_to: optDate(fd, "date_to"), weekdays: weekdays(fd),
        price_satang: money(fd, "price", "ราคา"), priority: int(fd, "priority", "ลำดับความสำคัญ", 0, 1000), is_active: bool(fd, "is_active"),
      }, actor);
      pending ||= r.pendingApproval;
    }
    return pending ? PENDING : `บันทึกกฎราคาแล้ว (${typeIds.length} ประเภทห้อง)`;
  });
}

export async function deletePriceRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("rates.edit");
    const r = await savePriceRule(tenant.id, {
      id: uuid(fd, "id"), room_type_id: uuid(fd, "room_type_id"), name: s(fd, "name", 80), kind: "season", date_from: null, date_to: null,
      weekdays: [], price_satang: 0, priority: 0, is_active: false, delete: true,
    }, actor);
    return applied(r, "ลบกฎราคาแล้ว");
  });
}

export async function dailyRatesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff();
    const priceMode = s(fd, "price_mode");
    const minMode = s(fd, "min_mode");
    const closed = s(fd, "closed") as "keep" | "close" | "open";
    if (!["keep", "close", "open"].includes(closed)) throw new DomainError("VALIDATION", "สถานะการขายไม่ถูกต้อง");
    const r = await setDailyRates(tenant.id, {
      roomTypeIds: fd.getAll("room_type_id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)),
      from: date(fd, "from", "วันที่เริ่ม"),
      to: date(fd, "to", "วันที่สิ้นสุด"),
      weekdays: weekdays(fd),
      price: priceMode === "set" ? { mode: "set", satang: money(fd, "price", "ราคา") } : priceMode === "reset" ? { mode: "reset" } : { mode: "keep" },
      closed,
      minNights: minMode === "set" ? { mode: "set", nights: int(fd, "min_nights", "พักขั้นต่ำ", 1, 60) } : minMode === "reset" ? { mode: "reset" } : { mode: "keep" },
    }, actor);
    return applied(r, "อัปเดตปฏิทินราคาเรียบร้อย");
  });
}

// --------------------------------------------------------------- approvals --
export async function reviewRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff("approvals.review");
    const decision = s(fd, "decision") === "approve" ? "approve" : "reject";
    const r = await reviewChangeRequest(tenant.id, uuid(fd, "id"), decision, actor, opt(fd, "note", 500) ?? undefined);
    if (r.status === "failed") return { error: `อนุมัติไม่สำเร็จ: ${r.error}` };
    return r.status === "approved" ? "อนุมัติและนำไปใช้แล้ว" : "ปฏิเสธคำขอแล้ว";
  });
}

export async function withdrawRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, actor } = await requireStaff();
    await withdrawChangeRequest(tenant.id, uuid(fd, "id"), actor);
    return "ยกเลิกคำขอแล้ว";
  });
}

// ------------------------------------------------------------------- staff --
export async function inviteStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, session } = await requireStaff("users.manage");
    const role = s(fd, "role") as (typeof ROLES)[number];
    const email = s(fd, "email", 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("VALIDATION", "อีเมลไม่ถูกต้อง");
    if (s(fd, "name").length < 2) throw new DomainError("VALIDATION", "กรุณากรอกชื่อพนักงาน");
    const r = await inviteStaff(tenant.id, session, { email, name: s(fd, "name", 100), role }, await baseUrl());
    return { ok: "เพิ่มพนักงานแล้ว ส่งลิงก์นี้ให้พนักงานเพื่อตั้งรหัสผ่าน (ใช้ได้ 60 นาที ครั้งเดียว)", link: r.setupUrl };
  });
}

export async function updateStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, session } = await requireStaff("users.manage");
    const role = s(fd, "role");
    await updateStaff(tenant.id, session, uuid(fd, "user_id"), {
      role: ROLES.includes(role as never) ? (role as (typeof ROLES)[number]) : undefined,
      active: fd.has("active") ? s(fd, "active") === "true" : undefined,
    });
  });
}

export async function resetLinkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, session } = await requireStaff("users.manage");
    const link = await createResetLinkFor(tenant.id, session, uuid(fd, "user_id"), await baseUrl());
    return { ok: "สร้างลิงก์ตั้งรหัสผ่านใหม่แล้ว (ใช้ได้ 60 นาที ครั้งเดียว)", link };
  });
}

// ---------------------------------------------------------------- property --
export async function savePropertyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { tenant, propertyId, actor } = await requireStaff("property.edit");
    const time = (k: string, label: string) => {
      const v = s(fd, k);
      if (!/^\d{2}:\d{2}$/.test(v)) throw new DomainError("VALIDATION", `กรุณาระบุ${label}`);
      return v;
    };
    const pct = (k: string, label: string) => {
      const v = Number(s(fd, k) || "0");
      if (!Number.isFinite(v) || v < 0 || v > 30) throw new DomainError("VALIDATION", `${label} ต้องอยู่ระหว่าง 0–30%`);
      return Math.round(v * 100);
    };
    const url = (k: string) => {
      const v = opt(fd, k, 300);
      if (v && !/^https:\/\//.test(v)) throw new DomainError("VALIDATION", "ลิงก์ต้องขึ้นต้นด้วย https://");
      return v;
    };
    if (s(fd, "name_th").length < 2) throw new DomainError("VALIDATION", "กรุณากรอกชื่อที่พัก");
    const translations = translationsFrom(fd, ["name", "address"]);
    const r = await updateProperty(tenant.id, {
      id: propertyId, name_th: s(fd, "name_th", 120), name_en: en(translations, "name"), translations, phone: opt(fd, "phone", 40),
      email: opt(fd, "email", 120), address: opt(fd, "address", 500), facebook_url: url("facebook_url"), line_url: url("line_url"),
      check_in_time: time("check_in_time", "เวลาเช็คอิน"), check_out_time: time("check_out_time", "เวลาเช็คเอาท์"),
      hold_minutes: int(fd, "hold_hours", "เวลากันห้อง (ชั่วโมง)", 1, 168) * 60,
      max_nights: int(fd, "max_nights", "จำนวนคืนสูงสุด", 1, 365),
      booking_window_days: int(fd, "booking_window_days", "จองล่วงหน้าได้", 1, 730),
      damage_deposit_satang: money(fd, "damage_deposit", "เงินประกัน"),
      child_max_age: int(fd, "child_max_age", "อายุเด็กสูงสุด", 0, 17),
      prices_include_tax: s(fd, "prices_include_tax") === "true",
      vat_bp: pct("vat", "VAT"), service_charge_bp: pct("service_charge", "ค่าบริการ"),
      tax_id: opt(fd, "tax_id", 20), legal_name: opt(fd, "legal_name", 200),
    }, actor);
    return applied(r);
  });
}
