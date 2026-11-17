// Server-safe presentational pieces for the admin area.
import Link from "next/link";
import type { ReactNode } from "react";

export const inputCls =
  "mt-1 w-full rounded-lg border border-cream-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-gold-500 focus:ring-2 focus:ring-gold-300/50 disabled:bg-cream";
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-teal-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-mid disabled:opacity-60";
export const btnGold =
  "bg-gold inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-cream-200 bg-white px-3 py-2 text-sm font-medium transition hover:bg-cream disabled:opacity-60";
export const btnDanger =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink/60">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-cream-200 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "warn" | "ok"; href?: string }) {
  const toneCls = tone === "warn" ? "ring-orange-200 bg-orange-50/60" : tone === "ok" ? "ring-emerald-200 bg-emerald-50/50" : "ring-cream-200 bg-white";
  const body = (
    <div className={`h-full rounded-xl p-3 shadow-sm ring-1 sm:p-4 ${toneCls}`}>
      <p className="text-xs font-medium leading-snug text-ink/60">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink/50 sm:text-xs">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block transition hover:-translate-y-0.5">{body}</Link> : body;
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block text-sm font-medium text-ink ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-ink/50">{hint}</span>}
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-cream-200 bg-white/60 p-8 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-ink/60">{children}</div>}
    </div>
  );
}

export function NoAccess({ what = "หน้านี้" }: { what?: string }) {
  return <Empty title={`คุณไม่มีสิทธิ์เข้าถึง${what}`}>หากต้องการใช้งาน กรุณาติดต่อเจ้าของ (ผู้อนุมัติ)</Empty>;
}

export function ApprovalNotice() {
  return (
    <p className="mb-4 rounded-lg bg-gold-300/25 px-4 py-2 text-sm text-ink ring-1 ring-gold-300">
      การแก้ไขในส่วนนี้จะถูกส่งเป็น <b>คำขอ</b> และมีผลเมื่อเจ้าของ (ผู้อนุมัติ) อนุมัติแล้ว
    </p>
  );
}

export function Table({ head, children, minWidth = 720 }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-cream-200">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead className="bg-ivory text-xs text-ink/60">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cream-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-white/70 ring-1 ring-cream-200" />
      ))}
    </div>
  );
}
