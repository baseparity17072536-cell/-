// วันที่ทั้งหมดในระบบเก็บเป็นสตริง "YYYY-MM-DD" (ตามเวลาประเทศไทย)

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function nightsBetween(checkIn: string, checkOut: string) {
  const ms = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** วันนี้ตามเวลาประเทศไทย */
export function todayInBangkok(now = new Date()) {
  return todayIn("Asia/Bangkok", now);
}

/** วันนี้ (YYYY-MM-DD) ตาม timezone ของที่พัก */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function formatThaiDate(date: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("th-TH", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opts,
  });
}

export function formatThaiDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBaht(n: number) {
  return n.toLocaleString("th-TH");
}
