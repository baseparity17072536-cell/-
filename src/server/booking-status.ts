// Pure booking state machine — the only place that defines legal transitions.
export const BOOKING_STATUSES = [
  "pending_payment",
  "payment_review",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "expired",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type ActorType = "guest" | "staff" | "system" | "api";

/** Which inventory bucket a booking occupies in each status. */
export type Bucket = "held" | "sold" | null;
export const BUCKET: Record<BookingStatus, Bucket> = {
  pending_payment: "held",
  payment_review: "held",
  confirmed: "sold",
  checked_in: "sold",
  checked_out: "sold",
  cancelled: null,
  expired: null,
  no_show: null,
};

const TRANSITIONS: Record<BookingStatus, Partial<Record<BookingStatus, ActorType[]>>> = {
  pending_payment: {
    payment_review: ["guest", "staff"],
    confirmed: ["staff", "system"],
    expired: ["system"],
    cancelled: ["guest", "staff"],
  },
  payment_review: {
    confirmed: ["staff", "system"],
    pending_payment: ["staff"],
    cancelled: ["staff"],
  },
  expired: { confirmed: ["staff"] },
  confirmed: { checked_in: ["staff"], cancelled: ["staff"], no_show: ["staff"] },
  checked_in: { checked_out: ["staff"] },
  checked_out: {},
  cancelled: {},
  no_show: {},
};

export function canTransition(from: BookingStatus, to: BookingStatus, actor: ActorType) {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function nextStatuses(from: BookingStatus, actor: ActorType): BookingStatus[] {
  return (Object.keys(TRANSITIONS[from]) as BookingStatus[]).filter((to) => canTransition(from, to, actor));
}

/** Inventory change for n rooms when moving between statuses. */
export function inventoryDelta(from: BookingStatus | null, to: BookingStatus, rooms: number) {
  const d = { held: 0, sold: 0 };
  const a = from ? BUCKET[from] : null;
  const b = BUCKET[to];
  if (a === b) return d;
  if (a) d[a] -= rooms;
  if (b) d[b] += rooms;
  return d;
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: "รอชำระเงิน",
  payment_review: "รอตรวจสอบการชำระ",
  confirmed: "ยืนยันแล้ว",
  checked_in: "เข้าพักอยู่",
  checked_out: "เช็คเอาท์แล้ว",
  cancelled: "ยกเลิก",
  expired: "หมดอายุ",
  no_show: "ไม่มาเข้าพัก",
};
