import "server-only";
import { todayIn } from "@/lib/dates";
import { createChangeRequest, registerApprovalHandler } from "./approvals";
import { audit, type Actor } from "./audit";
import { many, one, withTenant, type Tx } from "./db";
import { DomainError, pgCode } from "./errors";
import { resyncInventoryTotals } from "./inventory";
import { stayDates } from "./pricing";
import { decide, ForbiddenError, type Permission } from "./rbac";

// ------------------------------------------------------------------ helpers --
function decision(actor: Actor, p: Permission) {
  if (actor.type !== "staff") throw new ForbiddenError();
  const d = decide(actor.role, p);
  if (d === "deny") throw new ForbiddenError();
  return d;
}

const baht = (satang: number) => (satang / 100).toLocaleString("th-TH");

async function uniqueGuard<T>(fn: () => Promise<T>, message: string, tx: Tx) {
  await tx.query("SAVEPOINT uq");
  try {
    const r = await fn();
    await tx.query("RELEASE SAVEPOINT uq");
    return r;
  } catch (e) {
    await tx.query("ROLLBACK TO SAVEPOINT uq");
    if (pgCode(e) === "23505") throw new DomainError("VALIDATION", message);
    throw e;
  }
}

export type ApplyResult = { applied: boolean; pendingApproval: boolean; requestId?: string; id?: string };

// ----------------------------------------------------------------- property --
export type PropertyRecord = {
  id: string; slug: string; name_th: string; name_en: string | null; phone: string | null; email: string | null;
  address: string | null; facebook_url: string | null; line_url: string | null; timezone: string;
  check_in_time: string; check_out_time: string; hold_minutes: number; max_nights: number; booking_window_days: number;
  damage_deposit_satang: number; child_max_age: number; is_active: boolean;
  prices_include_tax: boolean; vat_bp: number; service_charge_bp: number; tax_id: string | null; legal_name: string | null;
};

export async function listProperties(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    many<PropertyRecord>(tx, `SELECT * FROM properties WHERE is_active ORDER BY created_at`),
  );
}

export async function getProperty(tenantId: string, propertyId: string) {
  return withTenant(tenantId, (tx) => one<PropertyRecord>(tx, `SELECT * FROM properties WHERE id = $1`, [propertyId]));
}

export type PropertyInput = Omit<PropertyRecord, "id" | "slug" | "is_active" | "timezone">;

async function applyPropertyUpdate(tx: Tx, tenantId: string, p: { id: string } & PropertyInput, actor: Actor) {
  const before = await one<PropertyRecord>(tx, "SELECT * FROM properties WHERE id = $1 FOR UPDATE", [p.id]);
  if (!before) throw new DomainError("NOT_FOUND", "ไม่พบที่พัก");
  await tx.query(
    `UPDATE properties SET name_th=$2, name_en=$3, phone=$4, email=$5, address=$6, facebook_url=$7, line_url=$8,
       check_in_time=$9, check_out_time=$10, hold_minutes=$11, max_nights=$12, booking_window_days=$13,
       damage_deposit_satang=$14, child_max_age=$15, prices_include_tax=$16, vat_bp=$17, service_charge_bp=$18,
       tax_id=$19, legal_name=$20
     WHERE id = $1`,
    [p.id, p.name_th, p.name_en, p.phone, p.email, p.address, p.facebook_url, p.line_url, p.check_in_time, p.check_out_time,
     p.hold_minutes, p.max_nights, p.booking_window_days, p.damage_deposit_satang, p.child_max_age,
     p.prices_include_tax, p.vat_bp, p.service_charge_bp, p.tax_id, p.legal_name],
  );
  await audit(tx, tenantId, actor, "property.update", "property", p.id, { before, after: p });
}

export async function updateProperty(tenantId: string, input: { id: string } & PropertyInput, actor: Actor): Promise<ApplyResult> {
  const d = decision(actor, "property.edit");
  return withTenant(tenantId, async (tx) => {
    if (d === "approval") {
      const requestId = await createChangeRequest(tx, tenantId, actor, {
        kind: "property.update", entityId: input.id, summary: `แก้ไขข้อมูลที่พัก “${input.name_th}”`, payload: input,
      });
      return { applied: false, pendingApproval: true, requestId };
    }
    await applyPropertyUpdate(tx, tenantId, input, actor);
    return { applied: true, pendingApproval: false };
  });
}
registerApprovalHandler("property.update", applyPropertyUpdate);

// --------------------------------------------------------------- room types --
export type RoomTypeRecord = {
  id: string; property_id: string; slug: string; code: string; view_type: string; bed_count: number; building: string | null;
  video_url: string | null; name_th: string; name_en: string | null; description_th: string;
  description_en: string | null; bed_info: string; size_sqm: number | null; base_adults: number; max_adults: number;
  max_children: number; max_occupancy: number; max_extra_beds: number; base_price_satang: number; extra_adult_satang: number;
  child_satang: number; extra_bed_satang: number; amenities: string[]; sort_order: number; is_active: boolean;
};

export async function listRoomTypes(tenantId: string, propertyId: string, opts: { includeInactive?: boolean } = {}) {
  return withTenant(tenantId, (tx) =>
    many<RoomTypeRecord & { room_count: number; active_rooms: number; cover: string | null }>(
      tx,
      `SELECT t.*,
              (SELECT count(*)::int FROM rooms r WHERE r.room_type_id = t.id AND r.status <> 'inactive') AS room_count,
              (SELECT count(*)::int FROM rooms r WHERE r.room_type_id = t.id AND r.status = 'active') AS active_rooms,
              (SELECT url FROM room_type_images i WHERE i.room_type_id = t.id ORDER BY sort_order, created_at LIMIT 1) AS cover
       FROM room_types t WHERE t.property_id = $1 ${opts.includeInactive ? "" : "AND t.is_active"}
       ORDER BY t.sort_order, t.name_th`,
      [propertyId],
    ),
  );
}

export async function getRoomType(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const t = await one<RoomTypeRecord>(tx, "SELECT * FROM room_types WHERE id = $1", [id]);
    if (!t) return null;
    const images = await many<{ id: string; url: string; alt: string; sort_order: number }>(
      tx, "SELECT id, url, alt, sort_order FROM room_type_images WHERE room_type_id = $1 ORDER BY sort_order, created_at", [id],
    );
    const rooms = await many<RoomRecord>(
      tx, `SELECT id, room_type_id, room_number, building, floor, zone, status, housekeeping_status, note
           FROM rooms WHERE room_type_id = $1 ORDER BY room_number`, [id],
    );
    return { ...t, images, rooms };
  });
}

export type RoomTypeInput = Omit<RoomTypeRecord, "id"> & { id?: string };
const PRICE_FIELDS = ["base_price_satang", "extra_adult_satang", "child_satang", "extra_bed_satang"] as const;
type PriceChange = { id: string; name: string } & Pick<RoomTypeRecord, (typeof PRICE_FIELDS)[number]>;

function checkOccupancy(t: RoomTypeInput) {
  if (t.max_adults < t.base_adults) throw new DomainError("VALIDATION", "ผู้ใหญ่สูงสุดต้องไม่น้อยกว่าจำนวนผู้ใหญ่ที่รวมในราคา");
  if (t.max_occupancy < t.base_adults) throw new DomainError("VALIDATION", "จำนวนผู้เข้าพักรวมสูงสุดต้องไม่น้อยกว่าจำนวนผู้ใหญ่ที่รวมในราคา");
}

async function applyRoomTypePrices(tx: Tx, tenantId: string, p: PriceChange, actor: Actor) {
  const before = await one<Pick<RoomTypeRecord, (typeof PRICE_FIELDS)[number]>>(
    tx, `SELECT ${PRICE_FIELDS.join(", ")} FROM room_types WHERE id = $1`, [p.id]);
  const r = await tx.query(
    `UPDATE room_types SET base_price_satang=$2, extra_adult_satang=$3, child_satang=$4, extra_bed_satang=$5 WHERE id=$1`,
    [p.id, p.base_price_satang, p.extra_adult_satang, p.child_satang, p.extra_bed_satang],
  );
  if (!r.rowCount) throw new DomainError("NOT_FOUND", "ไม่พบประเภทห้อง");
  await audit(tx, tenantId, actor, "room_type.prices", "room_type", p.id, { name: p.name, before, after: p });
}
registerApprovalHandler("room_type.prices", applyRoomTypePrices);

/**
 * Create or update a room type. Descriptive fields follow catalog.edit; price fields follow rates.edit,
 * so an admin's price change becomes an approval request while the rest is saved immediately.
 */
export async function saveRoomType(tenantId: string, t: RoomTypeInput, actor: Actor): Promise<ApplyResult> {
  decision(actor, "catalog.edit");
  const priceDecision = decision(actor, "rates.edit") ;
  checkOccupancy(t);
  return withTenant(tenantId, async (tx) => {
    if (!t.id) {
      if (priceDecision !== "allow")
        throw new ForbiddenError("การสร้างประเภทห้องใหม่ (ซึ่งต้องกำหนดราคา) ทำได้เฉพาะเจ้าของ");
      const row = await uniqueGuard(
        () =>
          one<{ id: string }>(
            tx,
            `INSERT INTO room_types (tenant_id, property_id, slug, name_th, name_en, description_th, description_en, bed_info,
               size_sqm, base_adults, max_adults, max_children, max_occupancy, max_extra_beds, base_price_satang,
               extra_adult_satang, child_satang, extra_bed_satang, amenities, sort_order, is_active,
               code, view_type, bed_count, building, video_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id`,
            [tenantId, t.property_id, t.slug, t.name_th, t.name_en, t.description_th, t.description_en, t.bed_info, t.size_sqm,
             t.base_adults, t.max_adults, t.max_children, t.max_occupancy, t.max_extra_beds, t.base_price_satang,
             t.extra_adult_satang, t.child_satang, t.extra_bed_satang, t.amenities, t.sort_order, t.is_active,
             t.code, t.view_type, t.bed_count, t.building, t.video_url],
          ),
        "รหัสประเภทห้อง (code) หรือ slug นี้ถูกใช้แล้ว",
        tx,
      );
      await audit(tx, tenantId, actor, "room_type.create", "room_type", row!.id, { name: t.name_th });
      return { applied: true, pendingApproval: false, id: row!.id };
    }

    const current = await one<RoomTypeRecord>(tx, "SELECT * FROM room_types WHERE id = $1 FOR UPDATE", [t.id]);
    if (!current) throw new DomainError("NOT_FOUND", "ไม่พบประเภทห้อง");
    await uniqueGuard(
      () =>
        tx.query(
          `UPDATE room_types SET slug=$2, name_th=$3, name_en=$4, description_th=$5, description_en=$6, bed_info=$7, size_sqm=$8,
             base_adults=$9, max_adults=$10, max_children=$11, max_occupancy=$12, max_extra_beds=$13, amenities=$14,
             sort_order=$15, is_active=$16, code=$17, view_type=$18, bed_count=$19, building=$20, video_url=$21
           WHERE id = $1`,
          [t.id, t.slug, t.name_th, t.name_en, t.description_th, t.description_en, t.bed_info, t.size_sqm, t.base_adults,
           t.max_adults, t.max_children, t.max_occupancy, t.max_extra_beds, t.amenities, t.sort_order, t.is_active,
           t.code, t.view_type, t.bed_count, t.building, t.video_url],
        ),
      "รหัสประเภทห้อง (code) หรือ slug นี้ถูกใช้แล้ว",
      tx,
    );
    await audit(tx, tenantId, actor, "room_type.update", "room_type", t.id, { name: t.name_th });

    const priceChanged = PRICE_FIELDS.some((f) => current[f] !== t[f]);
    if (!priceChanged) return { applied: true, pendingApproval: false, id: t.id };
    const change: PriceChange = {
      id: t.id, name: t.name_th, base_price_satang: t.base_price_satang, extra_adult_satang: t.extra_adult_satang,
      child_satang: t.child_satang, extra_bed_satang: t.extra_bed_satang,
    };
    if (priceDecision === "allow") {
      await applyRoomTypePrices(tx, tenantId, change, actor);
      return { applied: true, pendingApproval: false, id: t.id };
    }
    const requestId = await createChangeRequest(tx, tenantId, actor, {
      kind: "room_type.prices",
      entityId: t.id,
      summary: `เปลี่ยนราคา “${t.name_th}”: ราคาห้อง ฿${baht(current.base_price_satang)} → ฿${baht(t.base_price_satang)}, ผู้ใหญ่เพิ่ม ฿${baht(current.extra_adult_satang)} → ฿${baht(t.extra_adult_satang)}, เด็ก ฿${baht(current.child_satang)} → ฿${baht(t.child_satang)}, เตียงเสริม ฿${baht(current.extra_bed_satang)} → ฿${baht(t.extra_bed_satang)}`,
      payload: change,
    });
    return { applied: true, pendingApproval: true, requestId, id: t.id };
  });
}

// --------------------------------------------------------------------- rooms --
export type RoomStatus = "active" | "maintenance" | "inactive";
export type HousekeepingStatus = "clean" | "dirty" | "inspected" | "out_of_service";
export type RoomRecord = {
  id: string; room_type_id: string; room_number: string; building: string | null; floor: string | null; zone: string | null;
  status: RoomStatus; housekeeping_status: HousekeepingStatus; note: string | null;
};
export type RoomInput = Omit<RoomRecord, "id" | "housekeeping_status"> & { id?: string; housekeeping_status?: HousekeepingStatus };

export async function listRooms(tenantId: string, propertyId: string) {
  return withTenant(tenantId, (tx) =>
    many<RoomRecord & { type_name: string; type_code: string }>(
      tx,
      `SELECT r.id, r.room_type_id, r.room_number, r.building, r.floor, r.zone, r.status, r.housekeeping_status, r.note,
              t.name_th AS type_name, t.code AS type_code
       FROM rooms r JOIN room_types t ON t.id = r.room_type_id
       WHERE t.property_id = $1 ORDER BY r.building NULLS FIRST, r.room_number`,
      [propertyId],
    ),
  );
}

/** History of one physical room: assignments and audit entries. */
export async function roomHistory(tenantId: string, roomId: string) {
  return withTenant(tenantId, async (tx) => ({
    stays: await many<{ code: string; guest: string; stay: string; active: boolean; status: string }>(
      tx,
      `SELECT b.code, g.full_name AS guest, ra.stay::text AS stay, ra.active, b.status
       FROM room_assignments ra JOIN booking_rooms br ON br.id = ra.booking_room_id
       JOIN bookings b ON b.id = br.booking_id JOIN guests g ON g.id = b.guest_id
       WHERE ra.room_id = $1 ORDER BY lower(ra.stay) DESC LIMIT 100`,
      [roomId],
    ),
    changes: await many<{ action: string; data: Record<string, unknown> | null; created_at: Date; user_name: string | null }>(
      tx,
      `SELECT a.action, a.data, a.created_at, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = 'room' AND a.entity_id = $1 ORDER BY a.id DESC LIMIT 100`,
      [roomId],
    ),
  }));
}

/**
 * Expand a numbering pattern: the trailing digits of `start` are incremented, keeping width.
 * "A101" x3 -> A101 A102 A103 · "V01" x2 -> V01 V02 · "ROOM001" x2 -> ROOM001 ROOM002
 */
export function expandRoomNumbers(start: string, count: number) {
  const m = /^(.*?)(\d+)$/.exec(start.trim());
  if (!m) throw new DomainError("VALIDATION", "หมายเลขเริ่มต้นต้องลงท้ายด้วยตัวเลข เช่น A101, 101, V01, ROOM001");
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new DomainError("VALIDATION", "เพิ่มได้ครั้งละ 1–200 ห้อง");
  const [, prefix, digits] = m;
  const first = Number(digits);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(first + i).padStart(digits.length, "0")}`);
}

export async function bulkCreateRooms(
  tenantId: string,
  input: { room_type_id: string; start: string; count: number; building: string | null; floor: string | null; zone: string | null },
  actor: Actor,
) {
  decision(actor, "catalog.edit");
  const numbers = expandRoomNumbers(input.start, input.count);
  return withTenant(tenantId, async (tx) => {
    const type = await one<{ timezone: string }>(
      tx, `SELECT p.timezone FROM room_types t JOIN properties p ON p.id = t.property_id WHERE t.id = $1 FOR UPDATE OF t`, [input.room_type_id]);
    if (!type) throw new DomainError("NOT_FOUND", "ไม่พบประเภทห้อง");
    const dup = await many<{ room_number: string }>(
      tx, "SELECT room_number FROM rooms WHERE room_type_id = $1 AND room_number = ANY($2::text[]) ORDER BY room_number",
      [input.room_type_id, numbers]);
    if (dup.length) throw new DomainError("VALIDATION", `หมายเลขห้องซ้ำ: ${dup.map((d) => d.room_number).join(", ")}`, { duplicates: dup.map((d) => d.room_number) });
    await tx.query(
      `INSERT INTO rooms (tenant_id, room_type_id, room_number, building, floor, zone)
       SELECT $1, $2, n, $4, $5, $6 FROM unnest($3::text[]) AS n`,
      [tenantId, input.room_type_id, numbers, input.building, input.floor, input.zone],
    );
    await resyncInventoryTotals(tx, tenantId, input.room_type_id, todayIn(type.timezone));
    await audit(tx, tenantId, actor, "room.bulk_create", "room_type", input.room_type_id, { numbers });
    return numbers;
  });
}

export async function setHousekeepingStatus(tenantId: string, roomId: string, status: HousekeepingStatus, actor: Actor) {
  decision(actor, "booking.status");
  return withTenant(tenantId, async (tx) => {
    const r = await one<{ room_number: string; prev: string }>(
      tx, `UPDATE rooms r SET housekeeping_status = $2 FROM (SELECT housekeeping_status AS prev FROM rooms WHERE id = $1) p
           WHERE r.id = $1 RETURNING r.room_number, p.prev`, [roomId, status]);
    if (!r) throw new DomainError("NOT_FOUND", "ไม่พบห้องนี้");
    await audit(tx, tenantId, actor, "room.housekeeping", "room", roomId, { room_number: r.room_number, before: r.prev, after: status });
  });
}

export async function saveRoom(tenantId: string, r: RoomInput, actor: Actor) {
  decision(actor, "catalog.edit");
  return withTenant(tenantId, async (tx) => {
    const type = await one<{ property_id: string; timezone: string }>(
      tx,
      `SELECT t.property_id, p.timezone FROM room_types t JOIN properties p ON p.id = t.property_id WHERE t.id = $1 FOR UPDATE OF t`,
      [r.room_type_id],
    );
    if (!type) throw new DomainError("NOT_FOUND", "ไม่พบประเภทห้อง");
    let id = r.id;
    if (id) {
      const prev = await one<{ room_type_id: string }>(tx, "SELECT room_type_id FROM rooms WHERE id = $1 FOR UPDATE", [id]);
      if (!prev) throw new DomainError("NOT_FOUND", "ไม่พบห้องนี้");
      if (prev.room_type_id !== r.room_type_id) throw new DomainError("VALIDATION", "ไม่สามารถย้ายห้องไปประเภทอื่นได้ กรุณาปิดใช้งานแล้วสร้างใหม่");
      if (r.status !== "active") {
        const busy = await one<{ n: number }>(
          tx,
          `SELECT count(*)::int AS n FROM room_assignments WHERE room_id = $1 AND active AND upper(stay) > $2::date`,
          [id, todayIn(type.timezone)],
        );
        if (busy!.n > 0) throw new DomainError("CONFLICT", "ห้องนี้มีการจัดผู้เข้าพักในอนาคตอยู่ กรุณาย้ายห้องให้การจองนั้นก่อน");
      }
      await uniqueGuard(
        () => tx.query(
          "UPDATE rooms SET room_number=$2, floor=$3, status=$4, note=$5, building=$6, zone=$7 WHERE id=$1",
          [id, r.room_number, r.floor, r.status, r.note, r.building, r.zone]),
        `เลขห้อง ${r.room_number} มีอยู่แล้ว`,
        tx,
      );
    } else {
      const row = await uniqueGuard(
        () =>
          one<{ id: string }>(
            tx,
            `INSERT INTO rooms (tenant_id, room_type_id, room_number, floor, status, note, building, zone)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [tenantId, r.room_type_id, r.room_number, r.floor, r.status, r.note, r.building, r.zone],
          ),
        `เลขห้อง ${r.room_number} มีอยู่แล้ว`,
        tx,
      );
      id = row!.id;
    }
    await resyncInventoryTotals(tx, tenantId, r.room_type_id, todayIn(type.timezone));
    await audit(tx, tenantId, actor, r.id ? "room.update" : "room.create", "room", id!, { room_number: r.room_number, status: r.status });
    return id!;
  });
}

// -------------------------------------------------------------------- images --
export async function addRoomTypeImage(tenantId: string, roomTypeId: string, url: string, alt: string, actor: Actor) {
  decision(actor, "catalog.edit");
  return withTenant(tenantId, async (tx) => {
    const max = await one<{ m: number }>(tx, "SELECT COALESCE(max(sort_order), -1)::int AS m FROM room_type_images WHERE room_type_id = $1", [roomTypeId]);
    const row = await one<{ id: string }>(
      tx,
      "INSERT INTO room_type_images (tenant_id, room_type_id, url, alt, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [tenantId, roomTypeId, url, alt, max!.m + 1],
    );
    await audit(tx, tenantId, actor, "room_type.image_add", "room_type", roomTypeId, { url });
    return row!.id;
  });
}

export async function deleteRoomTypeImage(tenantId: string, imageId: string, actor: Actor) {
  decision(actor, "catalog.edit");
  return withTenant(tenantId, async (tx) => {
    const img = await one<{ room_type_id: string; url: string }>(tx, "DELETE FROM room_type_images WHERE id = $1 RETURNING room_type_id, url", [imageId]);
    if (!img) throw new DomainError("NOT_FOUND", "ไม่พบรูปนี้");
    await audit(tx, tenantId, actor, "room_type.image_delete", "room_type", img.room_type_id, { url: img.url });
    return img;
  });
}

export async function moveRoomTypeImage(tenantId: string, imageId: string, direction: -1 | 1, actor: Actor) {
  decision(actor, "catalog.edit");
  return withTenant(tenantId, async (tx) => {
    const img = await one<{ room_type_id: string }>(tx, "SELECT room_type_id FROM room_type_images WHERE id = $1", [imageId]);
    if (!img) throw new DomainError("NOT_FOUND", "ไม่พบรูปนี้");
    const list = await many<{ id: string }>(tx, "SELECT id FROM room_type_images WHERE room_type_id = $1 ORDER BY sort_order, created_at FOR UPDATE", [img.room_type_id]);
    const i = list.findIndex((x) => x.id === imageId);
    const j = i + direction;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (const [k, x] of list.entries()) await tx.query("UPDATE room_type_images SET sort_order = $2 WHERE id = $1", [x.id, k]);
  });
}

// ---------------------------------------------------------------- rate plans --
export type RatePlanRecord = {
  id: string; property_id: string; code: string; name_th: string; name_en: string | null; description_th: string;
  meal_plan: "room_only" | "breakfast" | "half_board" | "full_board"; adjust_type: "none" | "percent" | "fixed";
  adjust_value: number; min_nights: number; is_refundable: boolean; is_default: boolean; is_active: boolean; sort_order: number;
};
export type RatePlanInput = Omit<RatePlanRecord, "id"> & { id?: string };

export async function listRatePlans(tenantId: string, propertyId: string) {
  return withTenant(tenantId, (tx) =>
    many<RatePlanRecord>(tx, "SELECT * FROM rate_plans WHERE property_id = $1 ORDER BY is_default DESC, sort_order, name_th", [propertyId]),
  );
}

async function applyRatePlan(tx: Tx, tenantId: string, p: RatePlanInput, actor: Actor) {
  if (p.is_default && !p.is_active) throw new DomainError("VALIDATION", "แพ็กเกจหลักต้องเปิดใช้งานอยู่เสมอ");
  if (p.is_default) await tx.query("UPDATE rate_plans SET is_default = false WHERE property_id = $1 AND is_default AND id IS DISTINCT FROM $2", [p.property_id, p.id ?? null]);
  const values = [p.code, p.name_th, p.name_en, p.description_th, p.meal_plan, p.adjust_type, p.adjust_value, p.min_nights, p.is_refundable, p.is_default, p.is_active, p.sort_order];
  if (p.id) {
    const r = await uniqueGuard(
      () => tx.query(
        `UPDATE rate_plans SET code=$2, name_th=$3, name_en=$4, description_th=$5, meal_plan=$6, adjust_type=$7, adjust_value=$8,
           min_nights=$9, is_refundable=$10, is_default=$11, is_active=$12, sort_order=$13 WHERE id=$1`,
        [p.id, ...values],
      ),
      `รหัสแพ็กเกจ ${p.code} ถูกใช้แล้ว`, tx,
    );
    if (!r.rowCount) throw new DomainError("NOT_FOUND", "ไม่พบแพ็กเกจราคา");
  } else {
    const row = await uniqueGuard(
      () => one<{ id: string }>(
        tx,
        `INSERT INTO rate_plans (tenant_id, property_id, code, name_th, name_en, description_th, meal_plan, adjust_type, adjust_value,
           min_nights, is_refundable, is_default, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [tenantId, p.property_id, ...values],
      ),
      `รหัสแพ็กเกจ ${p.code} ถูกใช้แล้ว`, tx,
    );
    p = { ...p, id: row!.id };
  }
  const defaults = await one<{ n: number }>(tx, "SELECT count(*)::int AS n FROM rate_plans WHERE property_id = $1 AND is_default", [p.property_id]);
  if (defaults!.n !== 1) throw new DomainError("VALIDATION", "ต้องมีแพ็กเกจหลัก (ค่าเริ่มต้น) 1 รายการ");
  await audit(tx, tenantId, actor, "rate_plan.save", "rate_plan", p.id!, p);
}
registerApprovalHandler("rate_plan.save", applyRatePlan);

export async function saveRatePlan(tenantId: string, p: RatePlanInput, actor: Actor): Promise<ApplyResult> {
  const d = decision(actor, "rates.edit");
  if (p.adjust_type === "percent" && (p.adjust_value < -100 || p.adjust_value > 1000))
    throw new DomainError("VALIDATION", "เปอร์เซ็นต์ปรับราคาต้องอยู่ระหว่าง -100 ถึง 1000");
  return withTenant(tenantId, async (tx) => {
    if (d === "approval") {
      const requestId = await createChangeRequest(tx, tenantId, actor, {
        kind: "rate_plan.save", entityId: p.id ?? null,
        summary: `${p.id ? "แก้ไข" : "สร้าง"}แพ็กเกจราคา “${p.name_th}” (${p.adjust_type === "none" ? "ราคาห้องปกติ" : p.adjust_type === "percent" ? `${p.adjust_value > 0 ? "+" : ""}${p.adjust_value}%` : `${p.adjust_value > 0 ? "+" : ""}฿${baht(p.adjust_value)}/คืน`})`,
        payload: p,
      });
      return { applied: false, pendingApproval: true, requestId };
    }
    await applyRatePlan(tx, tenantId, p, actor);
    return { applied: true, pendingApproval: false };
  });
}

// --------------------------------------------------------------- daily rates --
export type DailyRateChange = {
  roomTypeIds: string[];
  from: string;
  to: string; // inclusive
  weekdays: number[]; // 0=Sun..6=Sat; empty = every day
  price: { mode: "keep" } | { mode: "set"; satang: number } | { mode: "reset" };
  closed: "keep" | "close" | "open";
  minNights: { mode: "keep" } | { mode: "set"; nights: number } | { mode: "reset" };
};

function datesFor(c: DailyRateChange) {
  const all = stayDates(c.from, addOne(c.to));
  return c.weekdays.length ? all.filter((d) => c.weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) : all;
}
function addOne(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

async function applyDailyRates(tx: Tx, tenantId: string, c: DailyRateChange, actor: Actor) {
  const dates = datesFor(c);
  if (!dates.length) throw new DomainError("VALIDATION", "ไม่มีวันที่ตรงกับเงื่อนไขที่เลือก");
  const before = await many<{ room_type_id: string; stay_date: string; price_satang: number | null; is_closed: boolean; min_nights: number | null }>(
    tx,
    `SELECT room_type_id, stay_date, price_satang, is_closed, min_nights FROM daily_rates
     WHERE room_type_id = ANY($1::uuid[]) AND stay_date = ANY($2::date[]) ORDER BY room_type_id, stay_date`,
    [c.roomTypeIds, dates],
  );
  for (const typeId of c.roomTypeIds) {
    await tx.query(
      `INSERT INTO daily_rates (tenant_id, room_type_id, stay_date, price_satang, is_closed, min_nights)
       SELECT $1, $2, d, $4, $5, $6 FROM unnest($3::date[]) AS d
       ON CONFLICT (tenant_id, room_type_id, stay_date) DO UPDATE SET
         price_satang = CASE $7 WHEN 'set' THEN $4 WHEN 'reset' THEN NULL ELSE daily_rates.price_satang END,
         is_closed    = CASE $8 WHEN 'close' THEN true WHEN 'open' THEN false ELSE daily_rates.is_closed END,
         min_nights   = CASE $9 WHEN 'set' THEN $6 WHEN 'reset' THEN NULL ELSE daily_rates.min_nights END`,
      [
        tenantId, typeId, dates,
        c.price.mode === "set" ? c.price.satang : null,
        c.closed === "close",
        c.minNights.mode === "set" ? c.minNights.nights : null,
        c.price.mode, c.closed, c.minNights.mode,
      ],
    );
  }
  // tidy rows that no longer override anything
  await tx.query(
    `DELETE FROM daily_rates WHERE room_type_id = ANY($1::uuid[]) AND stay_date = ANY($2::date[])
       AND price_satang IS NULL AND NOT is_closed AND min_nights IS NULL`,
    [c.roomTypeIds, dates],
  );
  await audit(tx, tenantId, actor, "daily_rates.set", "room_type", c.roomTypeIds.join(","), {
    change: c, nights: dates.length, before_overrides: before,
  });
}

// --------------------------------------------------------------- price rules --
export type PriceRuleRecord = {
  id: string; room_type_id: string; name: string; kind: "weekday" | "season" | "holiday" | "event";
  date_from: string | null; date_to: string | null; weekdays: number[]; price_satang: number; priority: number;
  is_active: boolean; created_at: Date;
};
export type PriceRuleInput = Omit<PriceRuleRecord, "id" | "created_at"> & { id?: string; delete?: boolean };

export async function listPriceRules(tenantId: string, propertyId: string) {
  return withTenant(tenantId, (tx) =>
    many<PriceRuleRecord & { type_name: string }>(
      tx,
      `SELECT r.id, r.room_type_id, r.name, r.kind, r.date_from::text, r.date_to::text, r.weekdays::int[] AS weekdays,
              r.price_satang, r.priority, r.is_active, r.created_at, t.name_th AS type_name
       FROM price_rules r JOIN room_types t ON t.id = r.room_type_id
       WHERE t.property_id = $1 ORDER BY t.sort_order, r.priority DESC, r.created_at DESC`,
      [propertyId],
    ),
  );
}

async function applyPriceRule(tx: Tx, tenantId: string, p: PriceRuleInput, actor: Actor) {
  const before = p.id ? await one<PriceRuleRecord>(tx, "SELECT * FROM price_rules WHERE id = $1 FOR UPDATE", [p.id]) : null;
  if (p.id && !before) throw new DomainError("NOT_FOUND", "ไม่พบกฎราคา");
  if (p.delete) {
    await tx.query("DELETE FROM price_rules WHERE id = $1", [p.id]);
    await audit(tx, tenantId, actor, "price_rule.delete", "price_rule", p.id!, { before });
    return;
  }
  const values = [p.room_type_id, p.name, p.kind, p.date_from, p.date_to, p.weekdays, p.price_satang, p.priority, p.is_active];
  let id = p.id;
  if (id) {
    await tx.query(
      `UPDATE price_rules SET room_type_id=$2, name=$3, kind=$4, date_from=$5, date_to=$6, weekdays=$7, price_satang=$8,
         priority=$9, is_active=$10 WHERE id=$1`, [id, ...values]);
  } else {
    id = (await one<{ id: string }>(
      tx,
      `INSERT INTO price_rules (tenant_id, room_type_id, name, kind, date_from, date_to, weekdays, price_satang, priority, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tenantId, ...values, actor.type === "staff" ? actor.userId : null],
    ))!.id;
  }
  await audit(tx, tenantId, actor, p.id ? "price_rule.update" : "price_rule.create", "price_rule", id!, { before, after: p });
}
registerApprovalHandler("price_rule.save", applyPriceRule);

export async function savePriceRule(tenantId: string, p: PriceRuleInput, actor: Actor): Promise<ApplyResult> {
  const d = decision(actor, "rates.edit");
  if (!p.delete) {
    if (p.date_from && p.date_to && p.date_to < p.date_from) throw new DomainError("VALIDATION", "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");
    if (p.weekdays.some((w) => w < 0 || w > 6)) throw new DomainError("VALIDATION", "วันในสัปดาห์ไม่ถูกต้อง");
    if (p.kind === "weekday" && !p.weekdays.length) throw new DomainError("VALIDATION", "กฎราคาตามวันในสัปดาห์ต้องเลือกอย่างน้อย 1 วัน");
    if ((p.kind === "season" || p.kind === "holiday" || p.kind === "event") && (!p.date_from || !p.date_to))
      throw new DomainError("VALIDATION", "กฎราคาตามฤดูกาล/เทศกาลต้องระบุช่วงวันที่");
  }
  return withTenant(tenantId, async (tx) => {
    if (d === "approval") {
      const typeName = (await one<{ name_th: string }>(tx, "SELECT name_th FROM room_types WHERE id = $1", [p.room_type_id]))?.name_th ?? "";
      const requestId = await createChangeRequest(tx, tenantId, actor, {
        kind: "price_rule.save", entityId: p.id ?? null,
        summary: p.delete
          ? `ลบกฎราคา “${p.name}” (${typeName})`
          : `${p.id ? "แก้ไข" : "เพิ่ม"}กฎราคา “${p.name}” ${typeName}: ฿${baht(p.price_satang)}/คืน ลำดับความสำคัญ ${p.priority}`,
        payload: p,
      });
      return { applied: false, pendingApproval: true, requestId };
    }
    await applyPriceRule(tx, tenantId, p, actor);
    return { applied: true, pendingApproval: false };
  });
}
registerApprovalHandler("daily_rates.set", applyDailyRates);

export async function setDailyRates(tenantId: string, c: DailyRateChange, actor: Actor): Promise<ApplyResult> {
  if (c.price.mode === "keep" && c.closed === "keep" && c.minNights.mode === "keep") throw new DomainError("VALIDATION", "ยังไม่ได้เลือกสิ่งที่ต้องการเปลี่ยน");
  if (c.to < c.from) throw new DomainError("VALIDATION", "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม");
  if (datesFor(c).length > 400) throw new DomainError("VALIDATION", "แก้ไขได้ครั้งละไม่เกิน 400 วัน");
  if (!c.roomTypeIds.length) throw new DomainError("VALIDATION", "กรุณาเลือกประเภทห้องอย่างน้อย 1 ประเภท");
  const decisions = [
    c.price.mode !== "keep" || c.minNights.mode !== "keep" ? decision(actor, "rates.edit") : "allow",
    c.closed !== "keep" ? decision(actor, "inventory.close") : "allow",
  ];
  return withTenant(tenantId, async (tx) => {
    if (decisions.includes("approval")) {
      const names = (await many<{ name_th: string }>(tx, "SELECT name_th FROM room_types WHERE id = ANY($1::uuid[])", [c.roomTypeIds])).map((x) => x.name_th);
      const parts = [
        c.price.mode === "set" ? `ราคา ฿${baht(c.price.satang)}/คืน` : c.price.mode === "reset" ? "คืนราคาปกติ" : null,
        c.closed === "close" ? "ปิดขาย" : c.closed === "open" ? "เปิดขาย" : null,
        c.minNights.mode === "set" ? `พักขั้นต่ำ ${c.minNights.nights} คืน` : c.minNights.mode === "reset" ? "ยกเลิกพักขั้นต่ำ" : null,
      ].filter(Boolean);
      const requestId = await createChangeRequest(tx, tenantId, actor, {
        kind: "daily_rates.set", entityId: null,
        summary: `${parts.join(", ")} · ${names.join(", ")} · ${c.from} ถึง ${c.to}${c.weekdays.length ? ` (เฉพาะวัน ${c.weekdays.map((w) => "อา จ อ พ พฤ ศ ส".split(" ")[w]).join(" ")})` : ""}`,
        payload: c,
      });
      return { applied: false, pendingApproval: true, requestId };
    }
    await applyDailyRates(tx, tenantId, c, actor);
    return { applied: true, pendingApproval: false };
  });
}
