import "server-only";
import { todayIn } from "@/lib/dates";
import { audit, enqueue, type Actor } from "./audit";
import type { HousekeepingStatus, RoomStatus } from "./catalog";
import { many, one, withTenant, type Tx } from "./db";
import { DomainError } from "./errors";
import { resyncInventoryTotals } from "./inventory";
import { decide, ForbiddenError, type Permission } from "./rbac";

// Phase 3 operations: housekeeping board and maintenance tickets.

function allow(actor: Actor, p: Permission, message?: string) {
  if (actor.type !== "staff" || decide(actor.role, p) === "deny") throw new ForbiddenError(message);
}

async function propertyToday(tx: Tx, propertyId: string) {
  const p = await one<{ timezone: string }>(tx, "SELECT timezone FROM properties WHERE id = $1", [propertyId]);
  if (!p) throw new DomainError("NOT_FOUND", "ไม่พบที่พัก");
  return todayIn(p.timezone);
}

// ------------------------------------------------------------ housekeeping --
export type BoardRoom = {
  id: string; room_number: string; building: string | null; floor: string | null; status: RoomStatus;
  housekeeping_status: HousekeepingStatus; type_name: string;
  stay_code: string | null; stay_guest: string | null; stay_out: string | null;
  arrival_code: string | null; arrival_guest: string | null; open_tickets: number;
};

/** Every room with its cleaning status and who is in it / arriving today. */
export async function getHousekeepingBoard(tenantId: string, propertyId: string) {
  return withTenant(tenantId, async (tx) => {
    const today = await propertyToday(tx, propertyId);
    const rooms = await many<BoardRoom>(
      tx,
      `SELECT r.id, r.room_number, r.building, r.floor, r.status, r.housekeeping_status, t.name_th AS type_name,
              occ.code AS stay_code, occ.guest AS stay_guest, occ.check_out AS stay_out,
              arr.code AS arrival_code, arr.guest AS arrival_guest,
              (SELECT count(*)::int FROM maintenance_tickets m WHERE m.room_id = r.id AND m.status IN ('open','in_progress')) AS open_tickets
       FROM rooms r JOIN room_types t ON t.id = r.room_type_id
       LEFT JOIN LATERAL (
         SELECT b.code, g.full_name AS guest, b.check_out FROM room_assignments ra
         JOIN booking_rooms br ON br.id = ra.booking_room_id JOIN bookings b ON b.id = br.booking_id JOIN guests g ON g.id = b.guest_id
         WHERE ra.room_id = r.id AND ra.active AND b.status = 'checked_in' AND lower(ra.stay) <= $2 LIMIT 1
       ) occ ON true
       LEFT JOIN LATERAL (
         SELECT b.code, g.full_name AS guest FROM room_assignments ra
         JOIN booking_rooms br ON br.id = ra.booking_room_id JOIN bookings b ON b.id = br.booking_id JOIN guests g ON g.id = b.guest_id
         WHERE ra.room_id = r.id AND ra.active AND b.status IN ('confirmed','payment_review','pending_payment') AND lower(ra.stay) = $2 LIMIT 1
       ) arr ON true
       WHERE t.property_id = $1 AND r.status <> 'inactive'
       ORDER BY r.building NULLS FIRST, r.floor NULLS FIRST, r.room_number`,
      [propertyId, today],
    );
    return { today, rooms };
  });
}

/** What the housekeeper should do first: dirty rooms with a guest arriving today. */
export function cleaningPriority(r: BoardRoom) {
  if (r.status !== "active" || r.housekeeping_status !== "dirty") return 0;
  if (r.arrival_code) return 3;
  if (!r.stay_code) return 2; // vacant and not sellable until cleaned
  return 1; // stay-over
}

// ------------------------------------------------------------- maintenance --
export type TicketPriority = "low" | "normal" | "urgent";
export type TicketStatus = "open" | "in_progress" | "done" | "cancelled";

export type TicketInput = {
  roomId: string | null; location: string | null; title: string; detail: string | null;
  priority: TicketPriority; blockRoom: boolean;
};

export async function listTickets(tenantId: string, propertyId: string, show: "open" | "closed" = "open") {
  return withTenant(tenantId, (tx) =>
    many<{
      id: string; room_id: string | null; room_number: string | null; location: string | null; title: string; detail: string | null;
      priority: TicketPriority; status: TicketStatus; room_blocked: boolean; created_at: Date; resolved_at: Date | null;
      resolution: string | null; reported_by_name: string | null; resolved_by_name: string | null; room_status: RoomStatus | null;
    }>(
      tx,
      `SELECT m.id, m.room_id, r.room_number, r.status AS room_status, m.location, m.title, m.detail, m.priority, m.status,
              m.room_blocked, m.created_at, m.resolved_at, m.resolution, u.name AS reported_by_name, v.name AS resolved_by_name
       FROM maintenance_tickets m LEFT JOIN rooms r ON r.id = m.room_id
       LEFT JOIN users u ON u.id = m.reported_by LEFT JOIN users v ON v.id = m.resolved_by
       WHERE m.property_id = $1 AND ${show === "open" ? "m.status IN ('open','in_progress')" : "m.status IN ('done','cancelled')"}
       ORDER BY ${show === "open"
         ? "CASE m.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, m.created_at"
         : "m.resolved_at DESC"}
       LIMIT 200`,
      [propertyId],
    ),
  );
}

export async function countOpenTickets(tenantId: string, propertyId: string) {
  return withTenant(tenantId, async (tx) =>
    (await one<{ n: number; urgent: number }>(
      tx,
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE priority = 'urgent')::int AS urgent
       FROM maintenance_tickets WHERE property_id = $1 AND status IN ('open','in_progress')`,
      [propertyId],
    ))!,
  );
}

type RoomRow = { id: string; room_number: string; room_type_id: string; status: RoomStatus };

async function lockRoom(tx: Tx, roomId: string, propertyId: string) {
  const r = await one<RoomRow>(
    tx,
    `SELECT r.id, r.room_number, r.room_type_id, r.status FROM rooms r JOIN room_types t ON t.id = r.room_type_id
     WHERE r.id = $1 AND t.property_id = $2 FOR UPDATE OF r`,
    [roomId, propertyId],
  );
  if (!r) throw new DomainError("NOT_FOUND", "ไม่พบห้องนี้");
  return r;
}

export async function createTicket(tenantId: string, propertyId: string, input: TicketInput, actor: Actor) {
  allow(actor, "maintenance.report");
  if (input.blockRoom) allow(actor, "catalog.edit", "เฉพาะเจ้าของหรือแอดมินที่ปิดห้องงดขายระหว่างซ่อมได้");
  const title = input.title.trim();
  const location = input.location?.trim() || null;
  if (title.length < 2) throw new DomainError("VALIDATION", "กรุณาระบุว่าเสียอะไร");
  if (!input.roomId && !location) throw new DomainError("VALIDATION", "กรุณาเลือกห้อง หรือระบุจุดที่ต้องซ่อม");
  if (input.blockRoom && !input.roomId) throw new DomainError("VALIDATION", "ปิดห้องงดขายได้เฉพาะงานซ่อมที่ระบุห้อง");

  return withTenant(tenantId, async (tx) => {
    const today = await propertyToday(tx, propertyId);
    const room = input.roomId ? await lockRoom(tx, input.roomId, propertyId) : null;
    let blocked = false;
    if (room && input.blockRoom) {
      if (room.status === "inactive") throw new DomainError("VALIDATION", `ห้อง ${room.room_number} ปิดใช้งานอยู่แล้ว`);
      if (room.status === "active") {
        const busy = await one<{ n: number }>(
          tx, "SELECT count(*)::int AS n FROM room_assignments WHERE room_id = $1 AND active AND upper(stay) > $2::date", [room.id, today]);
        if (busy!.n > 0)
          throw new DomainError("CONFLICT", `ห้อง ${room.room_number} มีผู้เข้าพักหรือการจองที่จัดห้องนี้ไว้ กรุณาย้ายห้องให้การจองนั้นก่อน`);
        await tx.query("UPDATE rooms SET status = 'maintenance' WHERE id = $1", [room.id]);
        await resyncInventoryTotals(tx, tenantId, room.room_type_id, today);
        await audit(tx, tenantId, actor, "room.blocked", "room", room.id, { room_number: room.room_number, reason: title });
        blocked = true;
      }
      // already in maintenance (set by hand): leave it as is, closing this ticket will not reopen it
    }
    const t = (await one<{ id: string }>(
      tx,
      `INSERT INTO maintenance_tickets (tenant_id, property_id, room_id, location, title, detail, priority, room_blocked, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [tenantId, propertyId, room?.id ?? null, location, title, input.detail?.trim() || null, input.priority, blocked,
        actor.type === "staff" ? actor.userId : null],
    ))!;
    const where = room ? `ห้อง ${room.room_number}` : location;
    await audit(tx, tenantId, actor, "maintenance.create", "maintenance_ticket", t.id, { where, title, priority: input.priority, room_blocked: blocked });
    await enqueue(tx, tenantId, "line", "staff.maintenance_reported", null, { where, title, priority: input.priority });
    return { id: t.id, roomBlocked: blocked };
  });
}

const NEXT: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "done", "cancelled"],
  in_progress: ["done", "cancelled", "open"],
  done: [],
  cancelled: [],
};
export const ticketNext = (s: TicketStatus) => NEXT[s];

export async function updateTicketStatus(
  tenantId: string,
  ticketId: string,
  to: TicketStatus,
  actor: Actor,
  opts: { resolution?: string | null } = {},
) {
  allow(actor, "maintenance.manage");
  return withTenant(tenantId, async (tx) => {
    const t = await one<{ id: string; property_id: string; room_id: string | null; status: TicketStatus; room_blocked: boolean; title: string }>(
      tx, "SELECT id, property_id, room_id, status, room_blocked, title FROM maintenance_tickets WHERE id = $1 FOR UPDATE", [ticketId]);
    if (!t) throw new DomainError("NOT_FOUND", "ไม่พบงานซ่อมนี้");
    if (!NEXT[t.status].includes(to)) throw new DomainError("INVALID_TRANSITION", "งานซ่อมนี้เปลี่ยนเป็นสถานะดังกล่าวไม่ได้");
    const closing = to === "done" || to === "cancelled";
    if (closing && t.room_blocked) allow(actor, "catalog.edit", "งานนี้ปิดห้องงดขายไว้ ต้องให้เจ้าของหรือแอดมินปิดงาน (ห้องจะกลับมาขาย)");

    await tx.query(
      `UPDATE maintenance_tickets SET status = $2,
         resolved_at = CASE WHEN $3 THEN now() END, resolved_by = CASE WHEN $3 THEN $4::uuid END,
         resolution = CASE WHEN $3 THEN $5 ELSE resolution END
       WHERE id = $1`,
      [t.id, to, closing, actor.type === "staff" ? actor.userId : null, opts.resolution?.trim() || null],
    );

    let reopened: string | null = null;
    if (closing && t.room_blocked && t.room_id) {
      const others = await one<{ n: number }>(
        tx,
        "SELECT count(*)::int AS n FROM maintenance_tickets WHERE room_id = $1 AND room_blocked AND status IN ('open','in_progress') AND id <> $2",
        [t.room_id, t.id],
      );
      const room = await lockRoom(tx, t.room_id, t.property_id);
      if (others!.n === 0 && room.status === "maintenance") {
        // back on sale, but it must be cleaned after the repair first
        await tx.query("UPDATE rooms SET status = 'active', housekeeping_status = 'dirty' WHERE id = $1", [room.id]);
        await resyncInventoryTotals(tx, tenantId, room.room_type_id, await propertyToday(tx, t.property_id));
        await audit(tx, tenantId, actor, "room.unblocked", "room", room.id, { room_number: room.room_number, ticket: t.title });
        reopened = room.room_number;
      }
    }
    await audit(tx, tenantId, actor, `maintenance.${to}`, "maintenance_ticket", t.id, { title: t.title, resolution: opts.resolution ?? null, reopened });
    return { reopened };
  });
}
