import Link from "next/link";
import { Card, Empty, PageHeader, Stat, Table } from "@/components/admin/ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatThaiDate, formatThaiDateTime } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { getCalendar } from "@/server/booking";
import { requireStaff } from "@/server/context";
import { getDashboard } from "@/server/dashboard";

export default async function DashboardPage() {
  const { tenant, propertyId, session } = await requireStaff("booking.view");
  const d = await getDashboard(tenant.id, propertyId);
  const cal = await getCalendar(tenant.id, propertyId, d.today, 14);
  const occPct = d.occupancy.total ? Math.round((d.occupancy.sold / d.occupancy.total) * 100) : 0;
  const reviewing = d.awaiting.filter((b) => b.status === "payment_review").length;

  return (
    <>
      <PageHeader title={`สวัสดี ${session.name}`} subtitle={`วันนี้ ${formatThaiDate(d.today, { weekday: "long" })}`} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="เช็คอินวันนี้" value={d.arrivals.length} hint="ยืนยันแล้ว + รอชำระ" href="#arrivals" />
        <Stat label="เช็คเอาท์วันนี้" value={d.departures.length} hint="ผู้เข้าพักที่ต้องออกวันนี้" href="#departures" />
        <Stat label="เข้าพักคืนนี้" value={`${d.occupancy.sold}/${d.occupancy.total}`} hint={`อัตราเข้าพัก ${occPct}% · ห้องซ่อม ${d.occupancy.ooo}`} />
        <Stat label="รอชำระ / รอตรวจสลิป" value={`${d.awaiting.length - reviewing} / ${reviewing}`} tone={d.awaiting.length ? "warn" : "default"} href="/admin/bookings?status=pending_payment" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="กำลังเข้าพัก" value={d.inHouse.length} hint="สถานะเช็คอินแล้ว" />
        <Stat label="ห้องรอทำความสะอาด" value={d.dirtyRooms} tone={d.dirtyRooms ? "warn" : "ok"} href="/admin/rooms#units" />
        <Stat label="ยอดจองที่ยืนยัน เดือนนี้" value={formatSatang(d.revenue.month)} hint={`${d.revenue.bookings} การจอง (ตามวันเข้าพัก)`} />
        <Stat label="ห้องค้างเกิน 1 คืน" value={d.inHouse.filter((b) => b.check_out < d.today).length} hint="เลยวันเช็คเอาท์แต่ยังไม่เช็คเอาท์" tone={d.inHouse.some((b) => b.check_out < d.today) ? "warn" : "default"} />
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
        <BookingList id="arrivals" title="เช็คอินวันนี้" rows={d.arrivals} empty="ไม่มีผู้เข้าพักที่จะเช็คอินวันนี้" />
        <BookingList id="departures" title="เช็คเอาท์วันนี้" rows={d.departures} empty="ไม่มีผู้เข้าพักที่ต้องเช็คเอาท์วันนี้" />
      </div>
      <div className="mt-6">
        <BookingList title="รอชำระเงิน / รอตรวจสอบสลิป" rows={d.awaiting} empty="ไม่มีการจองที่รอชำระ" showHold />
      </div>
    </>
  );
}

function BookingList({ id, title, rows, empty, showHold }: { id?: string; title: string; rows: Awaited<ReturnType<typeof getDashboard>>["arrivals"]; empty: string; showHold?: boolean }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-2 text-base font-bold">{title}</h2>
      {rows.length === 0 ? (
        <Empty title={empty} />
      ) : (
        <Table head={["รหัส", "ผู้เข้าพัก", "ห้อง", "เข้าพัก", showHold ? "หมดเวลาชำระ" : "ยอดรวม", "สถานะ"]} minWidth={640}>
          {rows.map((b) => (
            <tr key={b.code}>
              <td className="px-4 py-2"><Link href={`/admin/bookings/${b.code}`} className="font-semibold text-gold-600 hover:underline">{b.code}</Link></td>
              <td className="px-4 py-2">{b.guest_name}<div className="text-xs text-ink/50">{b.guest_phone}</div></td>
              <td className="px-4 py-2">{b.room_types}{b.rooms && <div className="text-xs text-ink/50">ห้อง {b.rooms}</div>}</td>
              <td className="px-4 py-2 text-xs">{formatThaiDate(b.check_in)} – {formatThaiDate(b.check_out)}</td>
              <td className="px-4 py-2 text-xs tabular-nums">{showHold ? (b.hold_expires_at ? formatThaiDateTime(b.hold_expires_at.toISOString()) : "—") : formatSatang(b.total_satang)}</td>
              <td className="px-4 py-2"><StatusBadge status={b.status} /></td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
