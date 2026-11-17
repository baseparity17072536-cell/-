import "server-only";
import { registerApprovalHandler } from "./approvals";
import { applyApprovedStatusChange } from "./booking";
import type { BookingStatus } from "./booking-status";

registerApprovalHandler<{ code: string; to: BookingStatus; reason: string | null; expectedVersion: number }>(
  "booking.status",
  (tx, tenantId, payload, approver) => applyApprovedStatusChange(tx, tenantId, payload, approver),
);
