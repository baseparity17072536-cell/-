import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES, canTransition, inventoryDelta, nextStatuses } from "@/server/booking-status";
import { can, decide, PERMISSION_MATRIX, ROLES } from "@/server/rbac";

describe("booking state machine", () => {
  it("only lets guests cancel or submit payment while unpaid", () => {
    expect(nextStatuses("pending_payment", "guest").sort()).toEqual(["cancelled", "payment_review"]);
    expect(canTransition("confirmed", "cancelled", "guest")).toBe(false);
  });

  it("only the system expires holds", () => {
    expect(canTransition("pending_payment", "expired", "system")).toBe(true);
    expect(canTransition("pending_payment", "expired", "staff")).toBe(false);
  });

  it("terminal statuses have no exits", () => {
    for (const s of ["checked_out", "cancelled", "no_show"] as const)
      for (const to of BOOKING_STATUSES) expect(canTransition(s, to, "staff")).toBe(false);
  });

  it("moves inventory between held and sold buckets", () => {
    expect(inventoryDelta(null, "pending_payment", 2)).toEqual({ held: 2, sold: 0 });
    expect(inventoryDelta("pending_payment", "confirmed", 2)).toEqual({ held: -2, sold: 2 });
    expect(inventoryDelta("payment_review", "pending_payment", 2)).toEqual({ held: 0, sold: 0 });
    expect(inventoryDelta("confirmed", "cancelled", 1)).toEqual({ held: 0, sold: -1 });
    expect(inventoryDelta("expired", "confirmed", 1)).toEqual({ held: 0, sold: 1 });
    expect(inventoryDelta("confirmed", "checked_in", 1)).toEqual({ held: 0, sold: 0 });
  });
});

describe("RBAC", () => {
  it("owner can do everything without approval", () => {
    for (const p of Object.keys(PERMISSION_MATRIX) as (keyof typeof PERMISSION_MATRIX)[]) expect(can("owner", p)).toBe(true);
  });

  it("admin edits catalog directly but prices / stop-sell / settings need owner approval", () => {
    expect(decide("admin", "catalog.edit")).toBe("allow");
    expect(decide("admin", "rates.edit")).toBe("approval");
    expect(decide("admin", "inventory.close")).toBe("approval");
    expect(decide("admin", "property.edit")).toBe("approval");
    expect(decide("admin", "booking.cancel_confirmed")).toBe("approval");
    expect(decide("admin", "users.manage")).toBe("deny");
    expect(decide("admin", "approvals.review")).toBe("deny");
  });

  it("only owners review approvals", () => {
    expect(ROLES.filter((r) => can(r, "approvals.review"))).toEqual(["owner"]);
  });
});
