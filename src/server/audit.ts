import "server-only";
import type { Tx } from "./db";

export type Actor =
  | { type: "staff"; userId: string; role: import("./rbac").Role; name: string; ip?: string }
  | { type: "guest"; ip?: string }
  | { type: "system" };

export function actorUserId(a: Actor) {
  return a.type === "staff" ? a.userId : null;
}

/** Append-only audit trail (the app role has no UPDATE/DELETE on this table). */
export async function audit(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  data?: Record<string, unknown>,
) {
  await tx.query(
    `INSERT INTO audit_logs (tenant_id, user_id, action, entity, entity_id, data, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, actorUserId(actor), action, entity, entityId, data ? JSON.stringify(data) : null, "ip" in actor ? (actor.ip ?? null) : null],
  );
}

/** Queue a notification in the same transaction as the change that caused it (outbox pattern). */
export async function enqueue(
  tx: Tx,
  tenantId: string,
  channel: "email" | "line",
  template: string,
  recipient: string | null,
  payload: Record<string, unknown>,
) {
  await tx.query(
    `INSERT INTO outbox_messages (tenant_id, channel, template, recipient, payload) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, channel, template, recipient, JSON.stringify(payload)],
  );
}
