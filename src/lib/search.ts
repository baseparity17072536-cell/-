import { RESORT } from "./rooms";
import { isIsoDate, nightsBetween, todayInBangkok } from "./dates";

export type StaySearch = {
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  nights: number;
};

type Raw = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function int(v: string | undefined, min: number, max: number, fallback: number) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** ตรวจสอบช่วงวันเข้าพัก คืนค่า error เป็นข้อความภาษาไทย หรือ search ที่ผ่านการตรวจแล้ว */
export function parseStay(
  raw: Raw,
  today = todayInBangkok(),
): { ok: true; search: StaySearch } | { ok: false; error: string | null; partial: Partial<StaySearch> } {
  const checkIn = one(raw.checkin);
  const checkOut = one(raw.checkout);
  const guests = int(one(raw.guests), 1, 30, 2);
  const rooms = int(one(raw.rooms), 1, 10, 1);
  const partial = { checkIn, checkOut, guests, rooms };

  if (!checkIn && !checkOut) return { ok: false, error: null, partial };
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut))
    return { ok: false, error: "กรุณาเลือกวันเช็คอินและวันเช็คเอาท์", partial };
  if (checkIn < today) return { ok: false, error: "วันเช็คอินต้องไม่เป็นวันที่ผ่านมาแล้ว", partial };
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) return { ok: false, error: "วันเช็คเอาท์ต้องอยู่หลังวันเช็คอิน", partial };
  if (nights > RESORT.maxNights)
    return { ok: false, error: `จองได้สูงสุด ${RESORT.maxNights} คืนต่อการจอง`, partial };

  return { ok: true, search: { checkIn, checkOut, guests, rooms, nights } };
}

export function stayQuery(s: Pick<StaySearch, "checkIn" | "checkOut" | "guests" | "rooms">, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    checkin: s.checkIn,
    checkout: s.checkOut,
    guests: String(s.guests),
    rooms: String(s.rooms),
    ...extra,
  }).toString();
}
