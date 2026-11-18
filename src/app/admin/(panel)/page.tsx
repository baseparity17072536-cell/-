import Link from "next/link";
import { ActionButton } from "@/components/admin/action-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { btnDanger, btnGhost, btnPrimary, Card, Empty, PageHeader, Stat, Table } from "@/components/admin/ui";
import { formatThaiDate, formatThaiDateTime } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { getCalendar } from "@/server/booking";
import { STATUS_LABEL, type BookingStatus } from "@/server/booking-status";
import { requireStaff } from "@/server/context";
import { getDashboard } from "@/server/dashboard";
import { can } from "@/server/rbac";
import { bookingStatusAction } from "../actions";

type Row = Awaited<ReturnType<typeof getDashboard>>["arrivals"][number];
type Quick = "check_in" | "late" | "check_out";

const btnSm = "!px-2.5 !py-1.5 text-xs whitespace-nowrap";

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const { tenant, propertyId, session } = await requireStaff("booking.view");
  const sp = await searchParams;
  const d = await getDashboard(tenant.id, propertyId);
  const cal = await getCalendar(tenant.id, propertyId, d.today, 14);
  const canAct = can(session.role, "booking.status");
  const occPct = d.occupancy.total ? Math.round((d.occupancy.sold / d.occupancy.total) * 100) : 0;
  const reviewing = d.awaiting.filter((b) => b.status === "payment_review").length;
  const dueToday = d.departures.filter((b) => b.check_out === d.today);
  const overdue = d.departures.filter((b) => b.check_out < d.today);
  const done = typeof sp.done === "string" ? sp.done : null;
  const doneCode = typeof sp.code === "string" ? sp.code : "";

  return (
    <>
      <PageHeader title={`สวัสดี ${session.name}`} subtitle={`วันนี้ ${formatThaiDate(d.today, { weekday: "long" })}`} />
      {done && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {done === "approval"
            ? `ส่งคำขอของการจอง ${doneCode} ให้เจ้าของอนุมัติแล้ว`
            : `การจอง ${doneCode}: อัปเดตสถานะเป็น “${STATUS_LABEL[done as BookingStatus] ?? done}” เรียบร้อย`}
          {done === "checked_out" && " · ห้องถูกตั้งเป็น “รอทำความสะอาด” แล้ว"}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="เช็คอินวันนี้" value={d.arrivals.length} hint="ยืนยันแล้ว + รอชำระ" href="#arrivals" />
        <Stat label="เช็คเอาท์วันนี้" value={dueToday.length} hint="ผู้เข้าพักที่ต้องออกวันนี้" href="#departures" />
        <Stat label="เข้าพักคืนนี้" value={`${d.occupancy.sold}/${d.occupancy.total}`} hint={`อัตราเข้าพัก ${occPct}% · ห้องซ่อม ${d.occupancy.ooo}`} />
        <Stat label="รอชำระ / รอตรวจสลิป" value={`${d.awaiting.length - reviewing} / ${reviewing}`} tone={d.awaiting.length ? "warn" : "default"} href="/admin/bookings?status=pending_payment" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="กำลังเข้าพัก" value={d.inHouse.length} hint="สถานะเช็คอินแล้ว" />
        <Stat label="ห้องรอทำความสะอาด" value={d.dirtyRooms} tone={d.dirtyRooms ? "warn" : "ok"} href="/admin/rooms#units" />
        <Stat label="ยอดจองที่ยืนยัน เดือนนี้" value={formatSatang(d.revenue.month)} hint={`${d.revenue.bookings} การจอง (ตามวันเข้าพัก)`} />
        <Stat
          label="ต้องตามงาน"
          value={d.lateArrivals.length + overdue.length}
          hint={`ยังไม่มาเช็คอิน ${d.lateArrivals.length} · เลยเวลาเช็คเอาท์ ${overdue.length}`}
          tone={d.lateArrivals.length + overdue.length ? "warn" : "default"}
          href="#follow-up"
        />
      </div>

      <Card title="ห้องว่าง 14 วันข้างหน้า" className="mt-6" actions={<Link href="/admin/calendar" className="text-sm text-gold-600 underline">เปิดปฏิทินเต็ม</Link>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-center text-xs tabular-nums">
            <thead>
              <tr className="text-ink/60">
                <th className="sticky left-0 bg-white py-1 pr-2 text-left font-medium">ประเภทห้อง</th>
                {cal[0]?.days.map((x) => (
                  <th key={x.date} className="px-1 py-1 font-medium">{formatThaiDate(x.date, { day: "numeric", month: "short", year: undefined })}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cal.map((t) => (
                <tr key={t.id} className="border-t border-cream-200">
                  <td className="sticky left-0 max-w-28 bg-white py-2 pr-2 text-left font-medium leading-tight">{t.name_th}</td>
                  {t.days.map((x) => (
                    <td key={x.date} className="px-1 py-1">
                      <span className={`inline-block min-w-8 rounded px-1 py-0.5 font-semibold ${x.closed ? "bg-gray-200 text-gray-500" : x.free === 0 ? "bg-red-100 text-red-700" : x.free <= 1 ? "bg-orange-100 text-orange-800" : "bg-emerald-50 text-emerald-800"}`}>
                        {x.closed ? "ปิด" : x.free}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <BookingList id="arrivals" title="เช็คอินวันนี้" rows={d.arrivals} empty="ไม่มีผู้เข้าพักที่จะเช็คอินวันนี้" quick={canAct ? "check_in" : undefined} />
        <BookingList id="departures" title="เช็คเอาท์วันนี้" rows={dueToday} empty="ไม่มีผู้เข้าพักที่ต้องเช็คเอาท์วันนี้" quick={canAct ? "check_out" : undefined} />
      </div>
      {(d.lateArrivals.length > 0 || overdue.length > 0) && (
        <div id="follow-up" className="mt-6 grid scroll-mt-6 gap-6 xl:grid-cols-2">
          <BookingList title="ยังไม่มาเช็คอิน (เลยวันเข้าพัก)" rows={d.lateArrivals} empty="ไม่มี" quick={canAct ? "late" : undefined}
            note="ลูกค้ามาช้าให้เช็คอินตามปกติ ถ้าไม่มาแล้วให้บันทึก “ไม่มาเข้าพัก” เพื่อปล่อยห้องกลับมาขาย" />
          <BookingList title="เลยวันเช็คเอาท์แล้ว" rows={overdue} empty="ไม่มี" quick={canAct ? "check_out" : undefined}
            note="ผู้เข้าพักออกแล้วให้กดเช็คเอาท์ ถ้าพักต่อให้แก้ไขการจองเพื่อขยายวันพัก" />
        </div>
      )}
      <div className="mt-6">
        <BookingList title="รอชำระเงิน / รอตรวจสอบสลิป" rows={d.awaiting} empty="ไม่มีการจองที่รอชำระ" showHold />
      </div>
    </>
  );
}

function QuickActions({ b, quick }: { b: Row; quick: Quick }) {
  const fields = { code: b.code, version: b.version, back: "dashboard" };
  const checkIn = () => {
    if (b.status !== "confirmed") return <span className="text-xs text-ink/50">ยืนยันการชำระก่อน</span>;
    if (b.unassigned > 0) return <Link href={`/admin/bookings/${b.code}`} className={`${btnGhost} ${btnSm}`}>จัดห้องก่อน</Link>;
    return <ActionButton action={bookingStatusAction} fields={{ ...fields, to: "checked_in" }} label="เช็คอิน" className={`${btnPrimary} ${btnSm}`} />;
  };
  if (quick === "check_out")
    return <ActionButton action={bookingStatusAction} fields={{ ...fields, to: "checked_out" }} label="เช็คเอาท์" className={`${btnPrimary} ${btnSm}`} confirm={`ยืนยันเช็คเอาท์ ${b.guest_name}?`} />;
  if (quick === "check_in") return checkIn();
  return (
    <div className="flex flex-wrap gap-1">
      {checkIn()}
      {b.status === "confirmed" && (
        <ActionButton action={bookingStatusAction} fields={{ ...fields, to: "no_show" }} label="ไม่มาเข้าพัก" className={`${btnDanger} ${btnSm}`}
          confirm={`ยืนยันว่า ${b.guest_name} ไม่มาเข้าพัก? ห้องจะถูกปล่อยกลับมาขาย`} />
      )}
    </div>
  );
}

function BookingList({ id, title, rows, empty, showHold, quick, note }: {
  id?: string; title: string; rows: Row[]; empty: string; showHold?: boolean; quick?: Quick; note?: string;
}) {
  return (
    <section id={id} className="min-w-0 scroll-mt-6">
      <h2 className="mb-2 text-base font-bold">{title}</h2>
      {note && rows.length > 0 && <p className="mb-2 text-xs text-ink/60">{note}</p>}
      {rows.length === 0 ? (
        <Empty title={empty} />
      ) : (
        <Table head={["รหัส", "ผู้เข้าพัก", "ห้อง", "เข้าพัก", showHold ? "หมดเวลาชำระ" : "ยอดรวม", quick ? "ดำเนินการ" : "สถานะ"]} minWidth={quick ? 720 : 640}>
          {rows.map((b) => (
            <tr key={b.code}>
              <td className="px-4 py-2"><Link href={`/admin/bookings/${b.code}`} className="font-semibold text-gold-600 hover:underline">{b.code}</Link></td>
              <td className="px-4 py-2">{b.guest_name}<div className="text-xs text-ink/50">{b.guest_phone}</div></td>
              <td className="px-4 py-2">
                {b.room_types}
                {b.rooms && <div className="text-xs text-ink/50">ห้อง {b.rooms}</div>}
                {quick !== "check_out" && b.not_ready && <div className="text-xs font-medium text-orange-700">ห้อง {b.not_ready} รอทำความสะอาด</div>}
                {quick !== "check_out" && b.unassigned > 0 && b.rooms && <div className="text-xs text-ink/50">ยังไม่จัดห้อง {b.unassigned} ห้อง</div>}
              </td>
              <td className="px-4 py-2 text-xs">{formatThaiDate(b.check_in)} – {formatThaiDate(b.check_out)}</td>
              <td className="px-4 py-2 text-xs tabular-nums">{showHold ? (b.hold_expires_at ? formatThaiDateTime(b.hold_expires_at.toISOString()) : "—") : formatSatang(b.total_satang)}</td>
              <td className="px-4 py-2">{quick ? <QuickActions b={b} quick={quick} /> : <StatusBadge status={b.status} />}</td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
