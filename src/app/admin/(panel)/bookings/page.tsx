import Link from "next/link";
import { Plus } from "lucide-react";
import { SOURCE_LABEL, StatusBadge } from "@/components/admin/status-badge";
import { btnGold, btnGhost, Empty, inputCls, PageHeader, Table } from "@/components/admin/ui";
import { formatThaiDate, formatThaiDateTime } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { listBookings } from "@/server/booking";
import { BOOKING_STATUSES, STATUS_LABEL, type BookingStatus } from "@/server/booking-status";
import { requireStaff } from "@/server/context";
import { can } from "@/server/rbac";

const TABS: { key: string; label: string }[] = [
  { key: "active", label: "ใช้งานอยู่" },
  { key: "pending_payment", label: STATUS_LABEL.pending_payment },
  { key: "payment_review", label: STATUS_LABEL.payment_review },
  { key: "confirmed", label: STATUS_LABEL.confirmed },
  { key: "checked_in", label: STATUS_LABEL.checked_in },
  { key: "all", label: "ทั้งหมด" },
];

export default async function BookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  const { tenant, session } = await requireStaff("booking.view");
  const sp = await searchParams;
  const status = typeof sp.status === "string" && (sp.status === "all" || sp.status === "active" || BOOKING_STATUSES.includes(sp.status as BookingStatus)) ? sp.status : "active";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : "";
  const page = Math.max(0, Number(sp.page) || 0);
  const rows = await listBookings(tenant.id, { status: status as BookingStatus | "active" | "all", q: q || undefined, limit: 51, offset: page * 50 });
  const more = rows.length > 50;
  const qs = (extra: Record<string, string | number>) => new URLSearchParams({ status, ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) }).toString();

  return (
    <>
      <PageHeader
        title="การจอง"
        subtitle="ค้นหาด้วยรหัสการจอง ชื่อ หรือเบอร์โทร"
        actions={can(session.role, "booking.create") && <Link href="/admin/bookings/new" className={btnGold}><Plus className="size-4" /> จองแทนลูกค้า</Link>}
      />
      <form className="mb-4 flex gap-2" action="/admin/bookings">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={q} placeholder="FT… / ชื่อ / เบอร์โทร" className={`${inputCls} mt-0 min-w-0 flex-1 sm:max-w-xs sm:flex-none`} aria-label="ค้นหา" />
        <button className={btnGhost}>ค้นหา</button>
        {q && <Link href={`/admin/bookings?status=${status}`} className={btnGhost}>ล้าง</Link>}
      </form>
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/bookings?${new URLSearchParams({ status: t.key, ...(q ? { q } : {}) })}`}
            className={`rounded-full px-3 py-1 ring-1 ${status === t.key ? "bg-teal-deep text-white ring-teal-deep" : "bg-white ring-cream-200 hover:bg-cream"}`}>
            {t.label}
          </Link>
        ))}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-full bg-white px-3 py-1 ring-1 ring-cream-200">สถานะอื่น ▾</summary>
          <div className="absolute z-10 mt-1 flex flex-col rounded-lg bg-white p-1 shadow ring-1 ring-cream-200">
            {(["checked_out", "cancelled", "expired", "no_show"] as const).map((k) => (
              <Link key={k} href={`/admin/bookings?status=${k}`} className="rounded px-3 py-1 hover:bg-cream">{STATUS_LABEL[k]}</Link>
            ))}
          </div>
        </details>
      </nav>

      {rows.length === 0 ? (
        <Empty title="ไม่พบการจอง">{q ? "ลองค้นหาด้วยคำอื่น หรือเลือกแท็บ “ทั้งหมด”" : "การจองใหม่จากหน้าเว็บและที่จองแทนลูกค้าจะแสดงที่นี่"}</Empty>
      ) : (
        <>
        {/* mobile: one card per booking */}
        <ul className="space-y-3 md:hidden">
          {rows.slice(0, 50).map((b) => (
            <li key={b.code}>
              <Link href={`/admin/bookings/${b.code}`} className="block rounded-xl bg-white p-4 shadow-sm ring-1 ring-cream-200 active:bg-cream">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-gold-600">{b.code}</span>
                  <StatusBadge status={b.status} />
                </div>
                <p className="mt-1 font-medium">{b.guest_name} <span className="text-sm font-normal text-ink/50">{b.guest_phone}</span></p>
                <p className="text-sm text-ink/70">{formatThaiDate(b.check_in)} – {formatThaiDate(b.check_out)}</p>
                <div className="mt-1 flex justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-ink/60">{b.room_types} · {b.room_count} ห้อง · {SOURCE_LABEL[b.source] ?? b.source}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatSatang(b.total_satang)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
        <Table head={["รหัส / วันที่จอง", "ผู้เข้าพัก", "ห้องพัก", "เข้าพัก", "ช่องทาง", "ยอดรวม", "สถานะ"]} minWidth={900}>
          {rows.slice(0, 50).map((b) => (
            <tr key={b.code} className="align-top">
              <td className="px-4 py-3">
                <Link href={`/admin/bookings/${b.code}`} className="font-semibold text-gold-600 hover:underline">{b.code}</Link>
                <div className="text-xs text-ink/50">{formatThaiDateTime(b.created_at.toISOString())}</div>
              </td>
              <td className="px-4 py-3">{b.guest_name}<div className="text-xs text-ink/50">{b.guest_phone}</div></td>
              <td className="px-4 py-3">{b.room_types}<div className="text-xs text-ink/50">{b.room_count} ห้อง · {b.adults} ผู้ใหญ่{b.children ? ` · ${b.children} เด็ก` : ""}</div></td>
              <td className="px-4 py-3 text-xs">{formatThaiDate(b.check_in)} – {formatThaiDate(b.check_out)}</td>
              <td className="px-4 py-3 text-xs">{SOURCE_LABEL[b.source] ?? b.source}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatSatang(b.total_satang)}</td>
              <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
            </tr>
          ))}
        </Table>
        </div>
        </>
      )}
      <div className="mt-4 flex gap-2">
        {page > 0 && <Link className={btnGhost} href={`/admin/bookings?${qs({ page: page - 1 })}`}>← ก่อนหน้า</Link>}
        {more && <Link className={btnGhost} href={`/admin/bookings?${qs({ page: page + 1 })}`}>ถัดไป →</Link>}
      </div>
    </>
  );
}
