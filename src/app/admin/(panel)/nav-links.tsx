"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BedDouble, CalendarDays, ClipboardCheck, History, LayoutDashboard, ListChecks, Plus, Settings, Tags, Users,
} from "lucide-react";

const ICONS = {
  dashboard: LayoutDashboard, bookings: ListChecks, plus: Plus, calendar: CalendarDays, rooms: BedDouble,
  rates: Tags, approvals: ClipboardCheck, staff: Users, settings: Settings, audit: History,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

export default function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const active = (href: string) =>
    href === "/admin" ? path === "/admin" : path === href || (path.startsWith(`${href}/`) && !items.some((i) => i.href !== href && i.href.startsWith(href) && path.startsWith(i.href)));
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const on = active(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              on ? "bg-white/12 font-semibold text-white ring-1 ring-gold-400/60" : "text-white/75 hover:bg-white/8 hover:text-white"
            }`}
          >
            <Icon className={`size-4 ${on ? "text-gold-300" : ""}`} />
            <span className="flex-1">{it.label}</span>
            {it.badge ? <span className="rounded-full bg-gold-500 px-2 text-xs font-bold text-white">{it.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
