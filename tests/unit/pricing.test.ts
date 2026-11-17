import { describe, expect, it } from "vitest";
import { expandRoomNumbers } from "@/server/catalog";
import {
  applyRatePlan, computeTax, matchRule, priceRoom, PricingError, resolveNightPrice, splitParty, stayDates, sumNights,
  type PriceRule, type RoomTypePricing,
} from "@/server/pricing";

const rt: RoomTypePricing = {
  base_adults: 2, max_adults: 3, max_children: 2, max_occupancy: 4, max_extra_beds: 1,
  base_price_satang: 350000, extra_adult_satang: 50000, child_satang: 20000, extra_bed_satang: 40000,
};
const plain = { adjust_type: "none" as const, adjust_value: 0, min_nights: 1 };

describe("pricing", () => {
  it("lists every night of a stay (check-out night excluded)", () => {
    expect(stayDates("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("uses base price, daily override and extras per night", () => {
    const nights = priceRoom(rt, plain, [{ stay_date: "2026-12-31", price_satang: 500000, is_closed: false, min_nights: null }],
      "2026-12-30", "2027-01-01", { adults: 3, children: 1, extraBeds: 0 });
    expect(nights.map(({ date, room, extras, source }) => ({ date, room, extras, source }))).toEqual([
      { date: "2026-12-30", room: 350000, extras: 70000, source: "base" },
      { date: "2026-12-31", room: 500000, extras: 70000, source: "daily" },
    ]);
    expect(sumNights(nights)).toBe(990000);
  });

  it("applies rate plan adjustments without going negative", () => {
    expect(applyRatePlan(350000, { adjust_type: "percent", adjust_value: 20 })).toBe(420000);
    expect(applyRatePlan(350000, { adjust_type: "percent", adjust_value: -15 })).toBe(297500);
    expect(applyRatePlan(350000, { adjust_type: "fixed", adjust_value: 30000 })).toBe(380000);
    expect(applyRatePlan(10000, { adjust_type: "fixed", adjust_value: -50000 })).toBe(0);
  });

  it("rejects closed nights, short stays and over-occupancy", () => {
    const closed = [{ stay_date: "2026-12-31", price_satang: null, is_closed: true, min_nights: null }];
    expect(() => priceRoom(rt, plain, closed, "2026-12-30", "2027-01-01", { adults: 2, children: 0, extraBeds: 0 })).toThrow(PricingError);
    const minStay = [{ stay_date: "2026-12-30", price_satang: null, is_closed: false, min_nights: 3 }];
    expect(() => priceRoom(rt, plain, minStay, "2026-12-30", "2027-01-01", { adults: 2, children: 0, extraBeds: 0 })).toThrow(/อย่างน้อย 3 คืน/);
    expect(() => priceRoom(rt, plain, [], "2026-12-30", "2026-12-31", { adults: 4, children: 0, extraBeds: 0 })).toThrow(/ผู้ใหญ่ได้สูงสุด/);
    expect(() => priceRoom(rt, plain, [], "2026-12-30", "2026-12-31", { adults: 3, children: 2, extraBeds: 0 })).toThrow(/รวมสูงสุด/);
    expect(() => priceRoom(rt, plain, [], "2026-12-30", "2026-12-31", { adults: 3, children: 2, extraBeds: 1 })).not.toThrow();
  });

  it("resolves price priority: daily override > highest-priority rule > newest rule > base", () => {
    const rules: PriceRule[] = [
      { id: "fri-sat", name: "ศุกร์-เสาร์", date_from: null, date_to: null, weekdays: [5, 6], price_satang: 400000, priority: 10, created_at: "2026-01-01" },
      { id: "sat", name: "วันเสาร์", date_from: null, date_to: null, weekdays: [6], price_satang: 450000, priority: 20, created_at: "2026-01-01" },
      { id: "ny", name: "ปีใหม่", date_from: "2026-12-29", date_to: "2027-01-02", weekdays: [], price_satang: 550000, priority: 100, created_at: "2026-01-01" },
      { id: "ny2", name: "ปีใหม่ (แก้ไข)", date_from: "2026-12-31", date_to: "2026-12-31", weekdays: [], price_satang: 600000, priority: 100, created_at: "2026-02-01" },
    ];
    // 2026-12-04 is a Friday, 2026-12-05 a Saturday, 2026-12-07 a Monday
    expect(resolveNightPrice(350000, "2026-12-07", undefined, rules)).toMatchObject({ price: 350000, source: "base" });
    expect(resolveNightPrice(350000, "2026-12-04", undefined, rules)).toMatchObject({ price: 400000, source: "rule:fri-sat" });
    expect(resolveNightPrice(350000, "2026-12-05", undefined, rules)).toMatchObject({ price: 450000, source: "rule:sat" });
    expect(resolveNightPrice(350000, "2026-12-30", undefined, rules)).toMatchObject({ price: 550000, source: "rule:ny" });
    expect(resolveNightPrice(350000, "2026-12-31", undefined, rules)).toMatchObject({ price: 600000, source: "rule:ny2" });
    expect(matchRule([...rules].reverse(), "2026-12-31")!.id).toBe("ny2"); // order of input does not matter
    const daily = { stay_date: "2026-12-31", price_satang: 700000, is_closed: false, min_nights: null };
    expect(resolveNightPrice(350000, "2026-12-31", daily, rules)).toMatchObject({ price: 700000, source: "daily" });
  });

  it("computes VAT and service charge exactly once", () => {
    // exclusive: 1,000 + 10% SC = 1,100 ; VAT 7% of 1,100 = 77 -> 1,177
    expect(computeTax(100000, { inclusive: false, vatBp: 700, serviceChargeBp: 1000 })).toEqual({ net: 100000, serviceCharge: 10000, vat: 7700, total: 117700 });
    // inclusive: the same 1,177 split back into its parts, total unchanged
    expect(computeTax(117700, { inclusive: true, vatBp: 700, serviceChargeBp: 1000 })).toEqual({ net: 100000, serviceCharge: 10000, vat: 7700, total: 117700 });
    // inclusive VAT only: 3,500 incl. 7% VAT
    const t = computeTax(350000, { inclusive: true, vatBp: 700, serviceChargeBp: 0 });
    expect(t.total).toBe(350000);
    expect(t.net + t.serviceCharge + t.vat).toBe(350000);
    expect(t.vat).toBe(22897);
  });

  it("expands room numbering patterns", () => {
    expect(expandRoomNumbers("A101", 10)).toEqual(["A101", "A102", "A103", "A104", "A105", "A106", "A107", "A108", "A109", "A110"]);
    expect(expandRoomNumbers("V01", 3)).toEqual(["V01", "V02", "V03"]);
    expect(expandRoomNumbers("ROOM001", 2)).toEqual(["ROOM001", "ROOM002"]);
    expect(expandRoomNumbers("99", 2)).toEqual(["99", "100"]);
    expect(() => expandRoomNumbers("VILLA", 2)).toThrow(/ลงท้ายด้วยตัวเลข/);
  });

  it("splits a party across rooms with at least one adult each", () => {
    expect(splitParty(2, 5, 1)).toEqual([{ adults: 3, children: 1, extraBeds: 0 }, { adults: 2, children: 0, extraBeds: 0 }]);
    expect(() => splitParty(3, 2, 0)).toThrow(PricingError);
  });
});
