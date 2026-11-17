import "server-only";
import { todayIn } from "@/lib/dates";
import { expireStaleHolds } from "./booking";
import type { BookingStatus } from "./booking-status";
import { many, one, withTenant } from "./db";

type Row = {
  code: string; status: BookingStatus; guest_name: string; guest_phone: string; check_in: string; check_out: string;
  room_types: string; rooms: string | null; total_satang: number; hold_expires_at: Date | null;
};

const LIST = `SELECT b.code, b.status, g.full_name AS guest_name, g.phone AS guest_phone, b.check_in, b.check_out, b.total_satang,
    b.hold_expires_at,
    (SELECT string_agg(br.room_type_name, ', ' ORDER BY br.room_type_name) FROM booking_rooms br WHERE br.booking_id = b.id) AS room_types,
    (SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number) FROM booking_rooms br
       JOIN room_assignments ra ON ra.booking_room_id = br.id AND ra.active JOIN rooms r ON r.id = ra.room_id
     WHERE br.booking_id = b.id) AS rooms
  FROM bookings b JOIN guests g ON g.id = b.guest_id`;

export async function getDashboard(tenantId: string, propertyId: string) {
  return withTenant(tenantId, async (tx) => {
    await expireStaleHolds(tx, tenantId);
    const tz = (await one<{ timezone: string }>(tx, "SELECT timezone FROM properties WHERE id = $1", [propertyId]))!.timezone;
    const today = todayIn(tz);
    const arrivals = await many<Row>(tx, `${LIST} WHERE b.property_id = $1 AND b.check_in = $2 AND b.status IN ('confirmed','payment_review','pending_payment') ORDER BY g.full_name`, [propertyId, today]);
    const departures = await many<Row>(tx, `${LIST} WHERE b.property_id = $1 AND b.check_out = $2 AND b.status = 'checked_in' ORDER BY g.full_name`, [propertyId, today]);
    const inHouse = await many<Row>(tx, `${LIST} WHERE b.property_id = $1 AND b.status = 'checked_in' ORDER BY b.check_out`, [propertyId]);
    const awaiting = await many<Row>(tx, `${LIST} WHERE b.property_id = $1 AND b.status IN ('pending_payment','payment_review') ORDER BY b.status DESC, b.hold_expires_at NULLS LAST LIMIT 20`, [propertyId]);
    const occ = await one<{ sold: number; held: number; total: number; ooo: number }>(
      tx,
      `SELECT COALESCE(sum(COALESCE(i.sold,0)),0)::int AS sold, COALESCE(sum(COALESCE(i.held,0)),0)::int AS held,
              COALESCE(sum(COALESCE(i.total, (SELECT count(*) FROM rooms r WHERE r.room_type_id = t.id AND r.status='active'))),0)::int AS total,
              (SELECT count(*)::int FROM rooms r JOIN room_types t2 ON t2.id = r.room_type_id WHERE t2.property_id = $1 AND r.status = 'maintenance') AS ooo
       FROM room_types t LEFT JOIN inventory_nights i ON i.room_type_id = t.id AND i.stay_date = $2
       WHERE t.property_id = $1 AND t.is_active`,
      [propertyId, today],
    );
    const dirty = await one<{ n: number }>(
      tx, `SELECT count(*)::int AS n FROM rooms r JOIN room_types t ON t.id = r.room_type_id WHERE t.property_id = $1 AND r.status = 'active' AND r.housekeeping_status = 'dirty'`,
      [propertyId]);
    const revenue = await one<{ month: number; bookings: number }>(
      tx,
      `SELECT COALESCE(sum(total_satang),0)::int AS month, count(*)::int AS bookings FROM bookings
       WHERE property_id = $1 AND status IN ('confirmed','checked_in','checked_out') AND date_trunc('month', check_in) = date_trunc('month', $2::date)`,
      [propertyId, today],
    );
    return { today, arrivals, departures, inHouse, awaiting, occupancy: occ!, dirtyRooms: dirty!.n, revenue: revenue! };
  });
}
