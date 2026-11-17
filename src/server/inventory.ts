import "server-only";
import { many, type Tx } from "./db";
import { DomainError, pgCode } from "./errors";
import { stayDates } from "./pricing";

/**
 * Inventory ledger (Phase 0 §9). One row per room type per night with CHECK (held + sold <= total).
 * Rows are created lazily with total = number of active rooms of that type.
 */
export async function ensureInventoryRows(tx: Tx, tenantId: string, roomTypeId: string, checkIn: string, checkOut: string) {
  await tx.query(
    `INSERT INTO inventory_nights (tenant_id, room_type_id, stay_date, total)
     SELECT $1, $2, d::date,
            (SELECT count(*) FROM rooms WHERE tenant_id = $1 AND room_type_id = $2 AND status = 'active')
     FROM unnest($3::date[]) AS d
     ON CONFLICT DO NOTHING`,
    [tenantId, roomTypeId, stayDates(checkIn, checkOut)],
  );
}

/**
 * Move `held`/`sold` counters for every night of a stay. Locks rows in (room_type, date) order
 * so concurrent bookings cannot deadlock; the CHECK constraint rejects any overbooking.
 */
export async function applyInventoryDelta(
  tx: Tx,
  tenantId: string,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  delta: { held: number; sold: number },
) {
  if (!delta.held && !delta.sold) return;
  await ensureInventoryRows(tx, tenantId, roomTypeId, checkIn, checkOut);
  await tx.query(
    `SELECT 1 FROM inventory_nights
     WHERE tenant_id = $1 AND room_type_id = $2 AND stay_date >= $3 AND stay_date < $4
     ORDER BY stay_date FOR UPDATE`,
    [tenantId, roomTypeId, checkIn, checkOut],
  );
  try {
    await tx.query("SAVEPOINT inv");
    await tx.query(
      `UPDATE inventory_nights SET held = held + $5, sold = sold + $6
       WHERE tenant_id = $1 AND room_type_id = $2 AND stay_date >= $3 AND stay_date < $4`,
      [tenantId, roomTypeId, checkIn, checkOut, delta.held, delta.sold],
    );
    await tx.query("RELEASE SAVEPOINT inv");
  } catch (e) {
    await tx.query("ROLLBACK TO SAVEPOINT inv");
    if (pgCode(e) === "23514") {
      const full = await many<{ stay_date: string }>(
        tx,
        `SELECT stay_date FROM inventory_nights
         WHERE tenant_id = $1 AND room_type_id = $2 AND stay_date >= $3 AND stay_date < $4
           AND held + sold + $5 + $6 > total ORDER BY stay_date`,
        [tenantId, roomTypeId, checkIn, checkOut, Math.max(delta.held, 0), Math.max(delta.sold, 0)],
      );
      throw new DomainError("SOLD_OUT", "ขออภัย ห้องประเภทนี้เต็มแล้วในช่วงวันที่เลือก", {
        nights: full.map((r) => r.stay_date),
      });
    }
    throw e;
  }
}

/**
 * Recalculate `total` for future nights after rooms are added/removed/put in maintenance.
 * Fails (and changes nothing) if a night would end up with fewer rooms than already booked.
 */
export async function resyncInventoryTotals(tx: Tx, tenantId: string, roomTypeId: string, fromDate: string) {
  try {
    await tx.query("SAVEPOINT resync");
    await tx.query(
      `UPDATE inventory_nights SET total =
         (SELECT count(*) FROM rooms WHERE tenant_id = $1 AND room_type_id = $2 AND status = 'active')
       WHERE tenant_id = $1 AND room_type_id = $2 AND stay_date >= $3`,
      [tenantId, roomTypeId, fromDate],
    );
    await tx.query("RELEASE SAVEPOINT resync");
  } catch (e) {
    await tx.query("ROLLBACK TO SAVEPOINT resync");
    if (pgCode(e) === "23514")
      throw new DomainError("CONFLICT", "ไม่สามารถลดจำนวนห้องได้ เพราะมีการจองในอนาคตเต็มจำนวนห้องอยู่แล้ว กรุณาย้ายการจองก่อน");
    throw e;
  }
}

/** Rooms still sellable per night (missing rows = all active rooms free). */
export async function availabilityByNight(tx: Tx, tenantId: string, roomTypeIds: string[], checkIn: string, checkOut: string) {
  const rows = await many<{ room_type_id: string; stay_date: string; free: number }>(
    tx,
    `WITH active AS (
       SELECT room_type_id, count(*)::int AS n FROM rooms
       WHERE tenant_id = $1 AND status = 'active' AND room_type_id = ANY($2::uuid[]) GROUP BY room_type_id
     )
     SELECT t.id AS room_type_id, d::date::text AS stay_date,
            COALESCE(i.total - i.held - i.sold, a.n, 0)::int AS free
     FROM unnest($2::uuid[]) AS t(id)
     CROSS JOIN unnest($3::date[]) AS d
     LEFT JOIN active a ON a.room_type_id = t.id
     LEFT JOIN inventory_nights i ON i.tenant_id = $1 AND i.room_type_id = t.id AND i.stay_date = d::date`,
    [tenantId, roomTypeIds, stayDates(checkIn, checkOut)],
  );
  const result = new Map<string, number>();
  for (const id of roomTypeIds) result.set(id, Number.POSITIVE_INFINITY);
  for (const r of rows) result.set(r.room_type_id, Math.min(result.get(r.room_type_id)!, r.free));
  for (const [k, v] of result) if (!Number.isFinite(v)) result.set(k, 0);
  return result;
}
