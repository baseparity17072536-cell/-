import { randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOM_TYPES, RESORT, getRoomType } from "./rooms";
import { addDays } from "./dates";

export type BookingStatus = "pending" | "confirmed" | "cancelled";

export type Booking = {
  code: string;
  roomTypeId: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  guests: number;
  pricePerNight: number;
  total: number;
  guest: {
    name: string;
    phone: string;
    email: string;
    note: string;
  };
  status: BookingStatus;
  cancelledBy?: "guest" | "admin";
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Storage: ไฟล์ JSON ในโฟลเดอร์ data/ (เหมาะกับการรันบนเครื่อง/เซิร์ฟเวอร์ของตัวเอง)
// ถ้า deploy บน serverless (เช่น Vercel) ต้องเปลี่ยนไปใช้ฐานข้อมูลจริง
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "bookings.json");

async function load(): Promise<Booking[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8")) as Booking[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function save(list: Booking[]) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await rename(tmp, DATA_FILE);
}

// คิวเขียนข้อมูลทีละคำขอ ป้องกันการจองชนกันในห้องสุดท้าย
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------

/** การจองที่ยังกันห้องอยู่: ยืนยันแล้ว หรือรอชำระเงินและยังไม่หมดเวลา */
export function isHolding(b: Booking, now = Date.now()) {
  if (b.status === "confirmed") return true;
  if (b.status === "pending") return now - Date.parse(b.createdAt) < RESORT.holdHours * 3_600_000;
  return false;
}

export function isExpired(b: Booking, now = Date.now()) {
  return b.status === "pending" && !isHolding(b, now);
}

function overlaps(b: Booking, checkIn: string, checkOut: string) {
  return b.checkIn < checkOut && checkIn < b.checkOut;
}

function availabilityFrom(list: Booking[], checkIn: string, checkOut: string, now: number) {
  const result: Record<string, number> = {};
  for (const type of ROOM_TYPES) {
    const active = list.filter((b) => b.roomTypeId === type.id && isHolding(b, now) && overlaps(b, checkIn, checkOut));
    // หาคืนที่มีการใช้ห้องสูงสุดในช่วงที่ค้นหา
    let peak = 0;
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      const used = active.filter((b) => b.checkIn <= d && d < b.checkOut).reduce((s, b) => s + b.rooms, 0);
      peak = Math.max(peak, used);
    }
    result[type.id] = Math.max(0, type.inventory - peak);
  }
  return result;
}

/** จำนวนห้องว่างของแต่ละประเภทในช่วงวันที่ */
export async function getAvailability(checkIn: string, checkOut: string) {
  return availabilityFrom(await load(), checkIn, checkOut, Date.now());
}

export async function listBookings() {
  const list = await load();
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findBooking(code: string) {
  const list = await load();
  return list.find((b) => b.code === code.trim().toUpperCase()) ?? null;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(existing: Set<string>) {
  for (;;) {
    let c = "FT";
    for (let i = 0; i < 8; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!existing.has(c)) return c;
  }
}

export class BookingError extends Error {}

export function createBooking(input: {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  guests: number;
  guest: Booking["guest"];
}) {
  return withLock(async () => {
    const type = getRoomType(input.roomTypeId);
    if (!type) throw new BookingError("ไม่พบประเภทห้องพักที่เลือก");
    if (input.guests > type.capacity * input.rooms)
      throw new BookingError(`ห้อง ${type.name} พักได้สูงสุด ${type.capacity} ท่านต่อห้อง`);

    const list = await load();
    const now = Date.now();
    const free = availabilityFrom(list, input.checkIn, input.checkOut, now)[type.id];
    if (free < input.rooms)
      throw new BookingError(
        free === 0 ? "ขออภัย ห้องประเภทนี้เต็มแล้วในช่วงวันที่เลือก" : `ขออภัย เหลือห้องว่างเพียง ${free} ห้อง`,
      );

    const stamp = new Date(now).toISOString();
    const booking: Booking = {
      code: newCode(new Set(list.map((b) => b.code))),
      roomTypeId: type.id,
      roomName: type.name,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: input.nights,
      rooms: input.rooms,
      guests: input.guests,
      pricePerNight: type.price,
      total: type.price * input.nights * input.rooms,
      guest: input.guest,
      status: "pending",
      createdAt: stamp,
      updatedAt: stamp,
    };
    list.push(booking);
    await save(list);
    return booking;
  });
}

export function updateStatus(code: string, status: BookingStatus, by: "guest" | "admin") {
  return withLock(async () => {
    const list = await load();
    const b = list.find((x) => x.code === code);
    if (!b) throw new BookingError("ไม่พบการจองนี้");
    if (by === "guest" && b.status !== "pending")
      throw new BookingError("การจองนี้ไม่สามารถยกเลิกออนไลน์ได้ กรุณาติดต่อรีสอร์ท");
    if (status === "confirmed" && b.status === "cancelled")
      throw new BookingError("การจองนี้ถูกยกเลิกไปแล้ว");
    if (status === "confirmed" && isExpired(b)) {
      // ยืนยันการจองที่หมดเวลากันห้อง ต้องเช็คว่ายังมีห้องว่าง
      const others = list.filter((x) => x.code !== code);
      const free = availabilityFrom(others, b.checkIn, b.checkOut, Date.now())[b.roomTypeId];
      if (free < b.rooms) throw new BookingError("ห้องเต็มแล้ว ไม่สามารถยืนยันการจองที่หมดเวลานี้ได้");
    }
    b.status = status;
    b.cancelledBy = status === "cancelled" ? by : undefined;
    b.updatedAt = new Date().toISOString();
    await save(list);
    return b;
  });
}
