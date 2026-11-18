import { isIsoDate, nightsBetween, todayInBangkok } from "./dates";

export type StaySearch = {
  checkIn: string;
  checkOut: string;
  guests: number; // adults
  children: number;
  rooms: number;
  nights: number;
};

type Raw = Record<string, string | string[] | undefined>;

/** Why a stay search is not valid (translated by the page, see errors.* in the dictionaries). */
export type StayError = "datesRequired" | "pastDate" | "dateOrder" | "maxNights" | "adultsPerRoom";

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
  opts: { today?: string; maxNights?: number } = {},
): { ok: true; search: StaySearch } | { ok: false; error: string | null; code: StayError | null; maxNights: number; partial: Partial<StaySearch> } {
  const today = opts.today ?? todayInBangkok();
  const maxNights = opts.maxNights ?? 30;
  const checkIn = one(raw.checkin);
  const checkOut = one(raw.checkout);
  const guests = int(one(raw.guests), 1, 40, 2);
  const children = int(one(raw.children), 0, 20, 0);
  const rooms = int(one(raw.rooms), 1, 10, 1);
  const partial = { checkIn, checkOut, guests, children, rooms };

  const fail = (code: StayError | null, error: string | null) => ({ ok: false as const, error, code, maxNights, partial });
  if (!checkIn && !checkOut) return fail(null, null);
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return fail("datesRequired", "กรุณาเลือกวันเช็คอินและวันเช็คเอาท์");
  if (checkIn < today) return fail("pastDate", "วันเช็คอินต้องไม่เป็นวันที่ผ่านมาแล้ว");
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) return fail("dateOrder", "วันเช็คเอาท์ต้องอยู่หลังวันเช็คอิน");
  if (nights > maxNights) return fail("maxNights", `จองได้สูงสุด ${maxNights} คืนต่อการจอง`);
  if (guests < rooms) return fail("adultsPerRoom", "ต้องมีผู้ใหญ่อย่างน้อย 1 ท่านต่อห้อง");

  return { ok: true, search: { checkIn, checkOut, guests, children, rooms, nights } };
}

export function stayQuery(
  s: Pick<StaySearch, "checkIn" | "checkOut" | "guests" | "rooms"> & { children?: number },
  extra: Record<string, string> = {},
) {
  return new URLSearchParams({
    checkin: s.checkIn,
    checkout: s.checkOut,
    guests: String(s.guests),
    children: String(s.children ?? 0),
    rooms: String(s.rooms),
    ...extra,
  }).toString();
}
