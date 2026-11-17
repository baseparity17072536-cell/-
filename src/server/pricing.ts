// Pure pricing rules (no I/O) — unit tested in tests/unit/pricing.test.ts
import { addDays, nightsBetween } from "@/lib/dates";

export type RoomTypePricing = {
  base_adults: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  max_extra_beds: number;
  base_price_satang: number;
  extra_adult_satang: number;
  child_satang: number;
  extra_bed_satang: number;
};

export type RatePlanPricing = {
  adjust_type: "none" | "percent" | "fixed";
  adjust_value: number;
  min_nights: number;
};

export type DailyRate = { stay_date: string; price_satang: number | null; is_closed: boolean; min_nights: number | null };

export type Occupancy = { adults: number; children: number; extraBeds: number };

export type PriceRule = {
  id: string;
  name: string;
  date_from: string | null;
  date_to: string | null;
  weekdays: number[];
  price_satang: number;
  priority: number;
  created_at: Date | string;
};

/** Where a night's room price came from — stored on every booked night (ADR-0004). */
export type PriceSource = "base" | "daily" | `rule:${string}`;

export type NightPrice = { date: string; room: number; extras: number; source: PriceSource; sourceLabel: string };

function weekday(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Highest priority wins; ties go to the most recently created rule. Deterministic for any input. */
export function matchRule(rules: PriceRule[], date: string): PriceRule | null {
  let best: PriceRule | null = null;
  for (const r of rules) {
    if (r.date_from && date < r.date_from) continue;
    if (r.date_to && date > r.date_to) continue;
    if (r.weekdays.length && !r.weekdays.includes(weekday(date))) continue;
    if (
      !best ||
      r.priority > best.priority ||
      (r.priority === best.priority && new Date(r.created_at).getTime() > new Date(best.created_at).getTime()) ||
      (r.priority === best.priority && new Date(r.created_at).getTime() === new Date(best.created_at).getTime() && r.id > best.id)
    )
      best = r;
  }
  return best;
}

/** Resolve the room price for one night before rate-plan adjustment. */
export function resolveNightPrice(base: number, date: string, daily: DailyRate | undefined, rules: PriceRule[]) {
  if (daily?.price_satang != null) return { price: daily.price_satang, source: "daily" as PriceSource, label: "ราคากำหนดรายวัน" };
  const rule = matchRule(rules, date);
  if (rule) return { price: rule.price_satang, source: `rule:${rule.id}` as PriceSource, label: rule.name };
  return { price: base, source: "base" as PriceSource, label: "ราคาพื้นฐาน" };
}

export class PricingError extends Error {
  constructor(
    public code: "OCCUPANCY" | "CLOSED" | "MIN_STAY",
    message: string,
  ) {
    super(message);
  }
}

export function stayDates(checkIn: string, checkOut: string) {
  const n = nightsBetween(checkIn, checkOut);
  return Array.from({ length: n }, (_, i) => addDays(checkIn, i));
}

export function applyRatePlan(base: number, plan: Pick<RatePlanPricing, "adjust_type" | "adjust_value">) {
  if (plan.adjust_type === "percent") return Math.max(0, Math.round((base * (100 + plan.adjust_value)) / 100));
  if (plan.adjust_type === "fixed") return Math.max(0, base + plan.adjust_value);
  return base;
}

export function validateOccupancy(rt: RoomTypePricing, o: Occupancy) {
  if (!Number.isInteger(o.adults) || o.adults < 1) throw new PricingError("OCCUPANCY", "ต้องมีผู้ใหญ่อย่างน้อย 1 ท่านต่อห้อง");
  if (o.adults > rt.max_adults) throw new PricingError("OCCUPANCY", `ห้องนี้รับผู้ใหญ่ได้สูงสุด ${rt.max_adults} ท่านต่อห้อง`);
  if (o.children > rt.max_children) throw new PricingError("OCCUPANCY", `ห้องนี้รับเด็กได้สูงสุด ${rt.max_children} ท่านต่อห้อง`);
  if (o.extraBeds > rt.max_extra_beds)
    throw new PricingError("OCCUPANCY", rt.max_extra_beds ? `เพิ่มเตียงเสริมได้สูงสุด ${rt.max_extra_beds} เตียง` : "ห้องนี้ไม่รองรับเตียงเสริม");
  if (o.adults + o.children > rt.max_occupancy + o.extraBeds)
    throw new PricingError("OCCUPANCY", `ห้องนี้พักได้รวมสูงสุด ${rt.max_occupancy} ท่านต่อห้อง (เพิ่มได้ด้วยเตียงเสริม)`);
}

/**
 * Price one room for a stay. Daily rates may override the base price, close a night,
 * or set a minimum stay for stays arriving that day.
 */
export function priceRoom(
  rt: RoomTypePricing,
  plan: RatePlanPricing,
  daily: DailyRate[],
  checkIn: string,
  checkOut: string,
  o: Occupancy,
  rules: PriceRule[] = [],
): NightPrice[] {
  validateOccupancy(rt, o);
  const byDate = new Map(daily.map((d) => [d.stay_date, d]));
  const dates = stayDates(checkIn, checkOut);
  const arrivalMin = byDate.get(checkIn)?.min_nights ?? 1;
  const minStay = Math.max(plan.min_nights, arrivalMin);
  if (dates.length < minStay) throw new PricingError("MIN_STAY", `ช่วงวันที่นี้ต้องเข้าพักอย่างน้อย ${minStay} คืน`);

  const extras =
    Math.max(0, o.adults - rt.base_adults) * rt.extra_adult_satang +
    o.children * rt.child_satang +
    o.extraBeds * rt.extra_bed_satang;

  return dates.map((date) => {
    const d = byDate.get(date);
    if (d?.is_closed) throw new PricingError("CLOSED", `ปิดรับจองคืนวันที่ ${date}`);
    const p = resolveNightPrice(rt.base_price_satang, date, d, rules);
    return { date, room: applyRatePlan(p.price, plan), extras, source: p.source, sourceLabel: p.label };
  });
}

export type TaxConfig = { inclusive: boolean; vatBp: number; serviceChargeBp: number };
export type TaxBreakdown = { net: number; serviceCharge: number; vat: number; total: number };

/**
 * Thai convention: service charge on the net price, VAT on (net + service charge).
 * Inclusive prices are split back into components (total unchanged);
 * exclusive prices get the charges added once. Tax is never applied twice.
 */
export function computeTax(amount: number, t: TaxConfig): TaxBreakdown {
  const sc = t.serviceChargeBp / 10_000;
  const vat = t.vatBp / 10_000;
  if (t.inclusive) {
    const net = Math.round(amount / ((1 + sc) * (1 + vat)));
    const serviceCharge = Math.round(net * sc);
    return { net, serviceCharge, vat: amount - net - serviceCharge, total: amount };
  }
  const serviceCharge = Math.round(amount * sc);
  const v = Math.round((amount + serviceCharge) * vat);
  return { net: amount, serviceCharge, vat: v, total: amount + serviceCharge + v };
}

export function sumNights(nights: NightPrice[]) {
  return nights.reduce((s, n) => s + n.room + n.extras, 0);
}

/** Split party across rooms as evenly as possible (adults first, at least 1 adult per room). */
export function splitParty(rooms: number, adults: number, children: number): Occupancy[] {
  if (adults < rooms) throw new PricingError("OCCUPANCY", "ต้องมีผู้ใหญ่อย่างน้อย 1 ท่านต่อห้อง");
  return Array.from({ length: rooms }, (_, i) => ({
    adults: Math.floor(adults / rooms) + (i < adults % rooms ? 1 : 0),
    children: Math.floor(children / rooms) + (i < children % rooms ? 1 : 0),
    extraBeds: 0,
  }));
}
