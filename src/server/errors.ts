export type DomainErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "SOLD_OUT"
  | "CLOSED"
  | "MIN_STAY"
  | "OCCUPANCY"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "ROOM_TAKEN";

/** Expected business error: message is safe to show to the user (Thai). */
export class DomainError extends Error {
  constructor(
    public code: DomainErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function pgCode(e: unknown) {
  return typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : undefined;
}
export function pgConstraint(e: unknown) {
  return typeof e === "object" && e && "constraint" in e ? String((e as { constraint: unknown }).constraint) : undefined;
}
