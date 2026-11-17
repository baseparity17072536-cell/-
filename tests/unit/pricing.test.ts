import { describe, expect, it } from "vitest";
import { applyRatePlan, priceRoom, PricingError, splitParty, stayDates, sumNights, type RoomTypePricing } from "@/server/pricing";

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
    expect(nights).toEqual([
      { date: "2026-12-30", room: 350000, extras: 70000 },
      { date: "2026-12-31", room: 500000, extras: 70000 },
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

  it("splits a party across rooms with at least one adult each", () => {
    expect(splitParty(2, 5, 1)).toEqual([{ adults: 3, children: 1, extraBeds: 0 }, { adults: 2, children: 0, extraBeds: 0 }]);
    expect(() => splitParty(3, 2, 0)).toThrow(PricingError);
  });
});
