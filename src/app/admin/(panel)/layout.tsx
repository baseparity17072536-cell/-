import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Menu } from "lucide-react";
import Logo from "@/components/logo";
import { Skeleton } from "@/components/admin/ui";
import { countPendingRequests } from "@/server/approvals";
import { requireStaff } from "@/server/context";
import { can, ROLE_LABEL } from "@/server/rbac";
import { logoutAction } from "../actions";
import NavLinks, { type NavItem } from "./nav-links";

export const metadata: Metadata = { title: "หลังบ้าน | FahTalay Booking Engine", robots: { index: false, follow: false } };

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="min-h-full bg-ivory lg:grid lg:grid-cols-[248px_1fr]">
      <Suspense fallback={<aside className="hidden bg-teal-deep lg:block" />}>
        <Sidebar />
      </Suspense>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        <Suspense fallback={<Skeleton rows={4} />}>{children}</Suspense>
      </main>
    </div>
  );
}

async function Sidebar() {
  const { tenant, session } = await requireStaff();
  const pending = can(session.role, "approvals.review") ? await countPendingRequests(tenant.id) : 0;
  const items: NavItem[] = [
    { href: "/admin", label: "ภาพรวมวันนี้", icon: "dashboard" },
    { href: "/admin/bookings", label: "การจอง", icon: "bookings" },
    ...(can(session.role, "booking.create") ? [{ href: "/admin/bookings/new", label: "จองแทนลูกค้า", icon: "plus" } as NavItem] : []),
    { href: "/admin/calendar", label: "ปฏิทินห้องว่าง & ราคา", icon: "calendar" },
    { href: "/admin/rooms", label: "ห้องพัก", icon: "rooms" },
    ...(session.role === "owner" || session.role === "admin" ? [{ href: "/admin/rates", label: "แพ็กเกจ & กฎราคา", icon: "rates" } as NavItem] : []),
    ...(session.role === "owner" || session.role === "admin"
      ? [{ href: "/admin/approvals", label: session.role === "owner" ? "รออนุมัติ" : "คำขอของฉัน", icon: "approvals", badge: pending || undefined } as NavItem]
      : []),
    ...(can(session.role, "users.view") ? [{ href: "/admin/staff", label: "พนักงาน", icon: "staff" } as NavItem] : []),
    ...(session.role === "owner" || session.role === "admin" ? [{ href: "/admin/settings", label: "ตั้งค่าที่พัก & ภาษี", icon: "settings" } as NavItem] : []),
    ...(can(session.role, "audit.view") ? [{ href: "/admin/audit", label: "ประวัติการแก้ไข", icon: "audit" } as NavItem] : []),
  ];

  const panel = (
    <div className="flex h-full flex-col">
      <Link href="/admin" className="px-5 py-5">
        <Logo />
      </Link>
      <p className="px-5 pb-3 text-xs text-white/60">{tenant.name}</p>
      <NavLinks items={items} />
      <div className="mt-auto border-t border-white/10 px-5 py-4 text-sm">
        <p className="font-semibold text-white">{session.name}</p>
        <p className="text-xs text-white/60">{ROLE_LABEL[session.role]}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link href="/admin/account" className="rounded border border-white/25 px-2 py-1 text-white/85 hover:bg-white/10">
            เปลี่ยนรหัสผ่าน
          </Link>
          <Link href="/" className="rounded border border-white/25 px-2 py-1 text-white/85 hover:bg-white/10">
            ดูหน้าเว็บ
          </Link>
          <form action={logoutAction}>
            <button className="rounded border border-white/25 px-2 py-1 text-white/85 hover:bg-white/10">ออกจากระบบ</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen overflow-y-auto bg-teal-deep lg:block">{panel}</aside>
      <details className="group sticky top-0 z-30 bg-teal-deep text-white lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
          <span className="font-semibold">{tenant.name}</span>
          <span className="inline-flex items-center gap-2 text-sm">
            {pending > 0 && <span className="rounded-full bg-gold-500 px-2 text-xs font-bold">{pending}</span>}
            <Menu className="size-5" /> เมนู
          </span>
        </summary>
        <div className="max-h-[80vh] overflow-y-auto pb-2">{panel}</div>
      </details>
    </>
  );
}
