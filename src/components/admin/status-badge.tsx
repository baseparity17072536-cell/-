import { STATUS_LABEL, type BookingStatus } from "@/server/booking-status";

const TONE: Record<BookingStatus, string> = {
  pending_payment: "bg-orange-100 text-orange-800",
  payment_review: "bg-amber-100 text-amber-900",
  confirmed: "bg-emerald-100 text-emerald-800",
  checked_in: "bg-sky-100 text-sky-800",
  checked_out: "bg-slate-100 text-slate-700",
  cancelled: "bg-gray-100 text-gray-600",
  expired: "bg-gray-100 text-gray-600",
  no_show: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const SOURCE_LABEL: Record<string, string> = {
  web: "เว็บไซต์", phone: "โทรศัพท์", walk_in: "Walk-in", facebook: "Facebook", line: "LINE", ota: "OTA", api: "API",
};
