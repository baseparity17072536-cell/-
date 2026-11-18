// Role-based access control. Checked inside services, never only in the UI.
// "approval" = the action is allowed to be *requested*; it takes effect only after an owner approves.
export const ROLES = ["owner", "admin", "front_desk", "accountant"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "เจ้าของ (ผู้อนุมัติ)",
  admin: "แอดมิน",
  front_desk: "พนักงานต้อนรับ",
  accountant: "บัญชี",
};

export type Permission =
  | "booking.view"
  | "booking.create"
  | "booking.status" // confirm payment, check-in/out, no-show, cancel unpaid
  | "booking.cancel_confirmed"
  | "booking.assign_room"
  | "booking.modify" // change dates, room type, guest details (prices are recalculated by the system)
  | "housekeeping.update" // room cleaning status
  | "maintenance.report" // open a repair ticket
  | "maintenance.manage" // work on / close tickets (taking a room out of sale also needs catalog.edit)
  | "catalog.view"
  | "catalog.edit" // names, descriptions, images, rooms, amenities
  | "rates.edit" // base prices, daily prices, rate plans
  | "inventory.close" // stop-sell / reopen dates
  | "property.edit"
  | "users.view"
  | "users.manage"
  | "approvals.review"
  | "audit.view";

type Decision = "allow" | "approval" | "deny";

const MATRIX: Record<Permission, Record<Role, Decision>> = {
  "booking.view":             { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "allow" },
  "booking.create":           { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "deny" },
  "booking.status":           { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "deny" },
  "booking.cancel_confirmed": { owner: "allow", admin: "approval", front_desk: "approval", accountant: "deny" },
  "booking.assign_room":      { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "deny" },
  "booking.modify":           { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "deny" },
  "housekeeping.update":      { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "deny" },
  "maintenance.report":       { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "allow" },
  "maintenance.manage":       { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "deny" },
  "catalog.view":             { owner: "allow", admin: "allow",    front_desk: "allow", accountant: "allow" },
  "catalog.edit":             { owner: "allow", admin: "allow",    front_desk: "deny",  accountant: "deny" },
  "rates.edit":               { owner: "allow", admin: "approval", front_desk: "deny",  accountant: "deny" },
  "inventory.close":          { owner: "allow", admin: "approval", front_desk: "deny",  accountant: "deny" },
  "property.edit":            { owner: "allow", admin: "approval", front_desk: "deny",  accountant: "deny" },
  "users.view":               { owner: "allow", admin: "allow",    front_desk: "deny",  accountant: "deny" },
  "users.manage":             { owner: "allow", admin: "deny",     front_desk: "deny",  accountant: "deny" },
  "approvals.review":         { owner: "allow", admin: "deny",     front_desk: "deny",  accountant: "deny" },
  "audit.view":               { owner: "allow", admin: "allow",    front_desk: "deny",  accountant: "allow" },
};

export function decide(role: Role, permission: Permission): Decision {
  return MATRIX[permission][role];
}

export function can(role: Role, permission: Permission) {
  return decide(role, permission) === "allow";
}

export class ForbiddenError extends Error {
  constructor(message = "คุณไม่มีสิทธิ์ทำรายการนี้") {
    super(message);
  }
}

export const PERMISSION_MATRIX = MATRIX;
