import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import SiteHeader from "@/components/site-header";
import Skeleton from "@/components/skeleton";
import { AdminLoginForm, AdminStatusButtons } from "@/components/booking-forms";
import { adminLogoutAction } from "@/app/actions";
import { isAdmin } from "@/lib/admin-auth";
import { isExpired, isHolding, listBookings, type Booking } from "@/lib/bookings";
import { formatBaht, formatThaiDate, formatThaiDateTime, todayInBangkok } from "@/lib/dates";
import { ROOM_TYPES } from "@/lib/rooms";

export const metadata: Metadata = {
  title: "จัดการการจอง | ฟ้าทะเลรีสอร์ท",
  robots: { index: false, follow: false },
};

export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
        <Suspense fallback={<Skeleton rows={2} />}>
          <Gate searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function Gate({ searchParams }: Pick<PageProps<"/admin">, "searchParams">) {
  if (!(await isAdmin())) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-cream-200">
        <h1 className="text-2xl font-bold">เข้าสู่ระบบผู้ดูแล</h1>
        <p className="mb-6 mt-1 text-sm text-ink/60">สำหรับเจ้าหน้าที่รีสอร์ทเท่านั้น</p>
        <AdminLoginForm />
      </div>
    );
  }
  const { status = "all" } = await searchParams;
  await connection();
  return <Dashboard filter={String(status)} />;
}

type View = "all" | "pending" | "confirmed" | "cancelled" | "expired";

function viewOf(b: Booking): Exclude<View, "all"> {
  return isExpired(b) ? "expired" : b.status;
}

const LABEL: Record<Exclude<View, "all">, string> = {
  pending: "รอชำระเงิน",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิก",
  expired: "หมดอายุ",
};

const BADGE: Record<Exclude<View, "all">, string> = {
  pending: "bg-orange-100 text-orange-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-600",
  expired: "bg-gray-100 text-gray-600",
};

async function Dashboard({ filter }: { filter: string }) {
  const all = await listBookings();
  const today = todayInBangkok();

  const counts = { all: all.length, pending: 0, confirmed: 0, cancelled: 0, expired: 0 } as Record<View, number>;
  for (const b of all) counts[viewOf(b)]++;

  const inHouse = all.filter((b) => isHolding(b) &&b.checkIn <= today && today < b.checkOut);
  const roomsTonight = inHouse.reduce((s, b) => s + b.rooms, 0);
  const totalRooms = ROOM_TYPES.reduce((s, r) => s + r.inventory, 0);
  const arrivals = all.filter((b) => b.status === "confirmed" && b.checkIn === today);
  const revenue = all.filter((b) => b.status === "confirmed").reduce((s, b) => s + b.total, 0);

  const shown = filter === "all" ? all : all.filter((b) => viewOf(b) === filter);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">จัดการการจอง</h1>
          <p className="text-sm text-ink/60">วันนี้ {formatThaiDate(today, { weekday: "long" })}</p>
        </div>
        <form action={adminLogoutAction}>
          <button className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-4 py-2 text-sm hover:bg-white">
            <LogOut className="size-4" /> ออกจากระบบ
          </button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="รอชำระเงิน" value={String(counts.pending)} hint="ต้องตรวจสอบสลิป" />
        <Stat label="เข้าพักคืนนี้" value={`${roomsTonight}/${totalRooms}`} hint="ห้องที่ถูกจอง" />
        <Stat label="เช็คอินวันนี้" value={String(arrivals.length)} hint="การจองที่ยืนยันแล้ว" />
        <Stat label="ยอดจองที่ยืนยัน" value={`฿${formatBaht(revenue)}`} hint="รวมทั้งหมด" />
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        {(["all", "pending", "confirmed", "expired", "cancelled"] as View[]).map((v) => (
          <Link
            key={v}
            href={v === "all" ? "/admin" : `/admin?status=${v}`}
            className={`rounded-full px-4 py-1.5 ring-1 transition ${
              filter === v ? "bg-teal-deep text-white ring-teal-deep" : "bg-white ring-cream-200 hover:bg-cream"
            }`}
          >
            {v === "all" ? "ทั้งหมด" : LABEL[v]} ({counts[v]})
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-ink/60">ยังไม่มีการจองในหมวดนี้</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-cream-200">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-cream text-xs text-ink/60">
              <tr>
                <th className="px-4 py-3">รหัส / วันที่จอง</th>
                <th className="px-4 py-3">ผู้เข้าพัก</th>
                <th className="px-4 py-3">ห้องพัก</th>
                <th className="px-4 py-3">เข้าพัก</th>
                <th className="px-4 py-3 text-right">ยอดรวม</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cream-200">
              {shown.map((b) => {
                const v = viewOf(b);
                return (
                  <tr key={b.code} className="align-top">
                    <td className="px-4 py-3">
                      <Link href={`/booking/${b.code}`} className="font-semibold text-gold-600 hover:underline">
                        {b.code}
                      </Link>
                      <div className="text-xs text-ink/50">{formatThaiDateTime(b.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{b.guest.name}</div>
                      <a href={`tel:${b.guest.phone}`} className="text-xs text-ink/60 hover:underline">
                        {b.guest.phone}
                      </a>
                      {b.guest.email && <div className="text-xs text-ink/60">{b.guest.email}</div>}
                      {b.guest.note && <div className="mt-1 max-w-48 text-xs italic text-ink/60">“{b.guest.note}”</div>}
                    </td>
                    <td className="px-4 py-3">
                      {b.roomName} × {b.rooms}
                      <div className="text-xs text-ink/60">{b.guests} ผู้ใหญ่</div>
                    </td>
                    <td className="px-4 py-3">
                      {formatThaiDate(b.checkIn)} – {formatThaiDate(b.checkOut)}
                      <div className="text-xs text-ink/60">{b.nights} คืน</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">฿{formatBaht(b.total)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE[v]}`}>{LABEL[v]}</span>
                      {b.cancelledBy && (
                        <div className="mt-1 text-xs text-ink/50">โดย{b.cancelledBy === "guest" ? "ลูกค้า" : "เจ้าหน้าที่"}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <AdminStatusButtons code={b.code} status={b.status} expired={v === "expired"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-cream-200">
      <p className="text-sm text-ink/60">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      <p className="text-xs text-ink/50">{hint}</p>
    </div>
  );
}
