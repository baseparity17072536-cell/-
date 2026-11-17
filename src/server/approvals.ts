import "server-only";
import { audit, enqueue, type Actor } from "./audit";
import { many, one, withTenant, type Tx } from "./db";
import { DomainError } from "./errors";
import { can, ForbiddenError } from "./rbac";

// Maker-checker workflow: admins request sensitive changes, the owner (approver) applies them.

export type ChangeKind = "booking.status" | "room_type.prices" | "daily_rates.set" | "rate_plan.save" | "price_rule.save" | "property.update";

type Handler = (tx: Tx, tenantId: string, payload: never, approver: Actor) => Promise<void>;
const handlers = new Map<ChangeKind, Handler>();

/** Each module registers how to apply its own approved payloads. */
export function registerApprovalHandler<P>(kind: ChangeKind, fn: (tx: Tx, tenantId: string, payload: P, approver: Actor) => Promise<void>) {
  handlers.set(kind, fn as Handler);
}

async function loadHandlers() {
  // modules register themselves on import
  await Promise.all([import("./catalog"), import("./booking-approvals")]);
}

export async function createChangeRequest(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  req: { kind: ChangeKind; entityId: string | null; summary: string; payload: Record<string, unknown> },
) {
  if (actor.type !== "staff") throw new ForbiddenError();
  const row = await one<{ id: string }>(
    tx,
    `INSERT INTO change_requests (tenant_id, kind, entity_id, summary, payload, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, req.kind, req.entityId, req.summary, JSON.stringify(req.payload), actor.userId],
  );
  await audit(tx, tenantId, actor, "approval.requested", "change_request", row!.id, { kind: req.kind, summary: req.summary });
  await enqueue(tx, tenantId, "line", "owner.approval_requested", null, { summary: req.summary, by: actor.name });
  return row!.id;
}

export async function listChangeRequests(tenantId: string, status: "pending" | "all" = "pending") {
  return withTenant(tenantId, (tx) =>
    many<{
      id: string; kind: string; entity_id: string | null; summary: string; status: string; created_at: Date;
      requested_by_name: string; reviewed_by_name: string | null; reviewed_at: Date | null; review_note: string | null; apply_error: string | null;
    }>(
      tx,
      `SELECT c.id, c.kind, c.entity_id, c.summary, c.status, c.created_at, c.reviewed_at, c.review_note, c.apply_error,
              u.name AS requested_by_name, r.name AS reviewed_by_name
       FROM change_requests c JOIN users u ON u.id = c.requested_by LEFT JOIN users r ON r.id = c.reviewed_by
       ${status === "pending" ? "WHERE c.status = 'pending'" : ""}
       ORDER BY c.created_at DESC LIMIT 200`,
    ),
  );
}

export async function countPendingRequests(tenantId: string) {
  return withTenant(tenantId, async (tx) => (await one<{ n: number }>(tx, "SELECT count(*)::int AS n FROM change_requests WHERE status = 'pending'"))!.n);
}

export async function reviewChangeRequest(tenantId: string, id: string, decision: "approve" | "reject", actor: Actor, note?: string) {
  if (actor.type !== "staff" || !can(actor.role, "approvals.review")) throw new ForbiddenError("เฉพาะเจ้าของ (ผู้อนุมัติ) เท่านั้นที่อนุมัติรายการได้");
  await loadHandlers();
  return withTenant(tenantId, async (tx) => {
    const req = await one<{ id: string; kind: ChangeKind; payload: never; status: string; requested_by: string; summary: string }>(
      tx,
      "SELECT id, kind, payload, status, requested_by, summary FROM change_requests WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!req) throw new DomainError("NOT_FOUND", "ไม่พบคำขอนี้");
    if (req.status !== "pending") throw new DomainError("CONFLICT", "คำขอนี้ถูกดำเนินการไปแล้ว");
    if (req.requested_by === actor.userId) throw new DomainError("FORBIDDEN", "ไม่สามารถอนุมัติคำขอของตนเองได้");

    if (decision === "reject") {
      await tx.query(
        "UPDATE change_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3 WHERE id = $1",
        [id, actor.userId, note ?? null],
      );
      await audit(tx, tenantId, actor, "approval.rejected", "change_request", id, { summary: req.summary, note });
      return { status: "rejected" as const };
    }

    const handler = handlers.get(req.kind);
    if (!handler) throw new Error(`no approval handler for ${req.kind}`);
    try {
      await tx.query("SAVEPOINT apply");
      await handler(tx, tenantId, req.payload, actor);
      await tx.query("RELEASE SAVEPOINT apply");
    } catch (e) {
      await tx.query("ROLLBACK TO SAVEPOINT apply");
      if (!(e instanceof DomainError)) throw e;
      await tx.query(
        "UPDATE change_requests SET status = 'failed', reviewed_by = $2, reviewed_at = now(), review_note = $3, apply_error = $4 WHERE id = $1",
        [id, actor.userId, note ?? null, e.message],
      );
      await audit(tx, tenantId, actor, "approval.failed", "change_request", id, { summary: req.summary, error: e.message });
      return { status: "failed" as const, error: e.message };
    }
    await tx.query(
      "UPDATE change_requests SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3 WHERE id = $1",
      [id, actor.userId, note ?? null],
    );
    await audit(tx, tenantId, actor, "approval.approved", "change_request", id, { summary: req.summary });
    return { status: "approved" as const };
  });
}

export async function withdrawChangeRequest(tenantId: string, id: string, actor: Actor) {
  if (actor.type !== "staff") throw new ForbiddenError();
  return withTenant(tenantId, async (tx) => {
    const r = await tx.query(
      "UPDATE change_requests SET status = 'withdrawn' WHERE id = $1 AND status = 'pending' AND requested_by = $2",
      [id, actor.userId],
    );
    if (!r.rowCount) throw new DomainError("NOT_FOUND", "ไม่พบคำขอที่ยกเลิกได้");
    await audit(tx, tenantId, actor, "approval.withdrawn", "change_request", id);
  });
}
