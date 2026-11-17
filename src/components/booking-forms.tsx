"use client";

import { useActionState } from "react";
import { Loader2, Printer } from "lucide-react";
import {
  adminLoginAction,
  adminSetStatusAction,
  cancelBookingAction,
  createBookingAction,
  lookupBookingAction,
  type FormState,
} from "@/app/actions";

const field =
  "mt-1 w-full rounded-lg border border-cream-200 bg-cream px-4 py-3 outline-none transition focus:border-gold-500 focus:ring-2 focus:ring-gold-300/40";
const goldBtn =
  "bg-gold inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-semibold text-white shadow transition hover:brightness-110 disabled:opacity-60";

function Message({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        {state.ok}
      </p>
    );
  return null;
}

function Spinner({ show }: { show: boolean }) {
  return show ? <Loader2 className="size-4 animate-spin" /> : null;
}

// ----- ขั้นตอนที่ 2: ข้อมูลผู้เข้าพัก -----
export function GuestForm({ hidden }: { hidden: Record<string, string> }) {
  const [state, action, pending] = useActionState(createBookingAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="text-sm font-medium sm:col-span-2">
        ชื่อ-นามสกุล <span className="text-red-600">*</span>
        <input name="name" required autoComplete="name" className={field} placeholder="ชื่อ นามสกุล" />
      </label>
      <label className="text-sm font-medium">
        เบอร์โทรศัพท์ <span className="text-red-600">*</span>
        <input name="phone" type="tel" required autoComplete="tel" className={field} placeholder="08x-xxx-xxxx" />
      </label>
      <label className="text-sm font-medium">
        อีเมล
        <input name="email" type="email" autoComplete="email" className={field} placeholder="you@example.com" />
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        คำขอพิเศษ
        <textarea name="note" rows={3} className={field} placeholder="เช่น ขอเตียงเสริม, เช็คอินดึก" />
      </label>
      <label className="flex items-start gap-3 text-sm sm:col-span-2">
        <input name="accept" type="checkbox" required className="mt-1 size-4 accent-[#c49a4c]" />
        <span>
          ฉันยอมรับเงื่อนไขการจอง: ระบบจะกันห้องไว้ 24 ชั่วโมงเพื่อรอการชำระเงิน
          หากไม่ได้ชำระภายในเวลาที่กำหนด การจองจะหมดอายุอัตโนมัติ
        </span>
      </label>
      <div className="sm:col-span-2">
        <Message state={state} />
      </div>
      <button type="submit" disabled={pending} className={`${goldBtn} sm:col-span-2`}>
        <Spinner show={pending} /> {pending ? "กำลังจอง..." : "ยืนยันการจอง"}
      </button>
    </form>
  );
}

// ----- ตรวจสอบการจอง -----
export function LookupForm() {
  const [state, action, pending] = useActionState(lookupBookingAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        รหัสการจอง
        <input name="code" required className={`${field} uppercase`} placeholder="FTXXXXXXXX" />
      </label>
      <label className="block text-sm font-medium">
        เบอร์โทรศัพท์ที่ใช้จอง
        <input name="phone" type="tel" required className={field} placeholder="08x-xxx-xxxx" />
      </label>
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${goldBtn} w-full`}>
        <Spinner show={pending} /> ค้นหาการจอง
      </button>
    </form>
  );
}

// ----- ยกเลิกการจอง (ลูกค้า) -----
export function CancelForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(cancelBookingAction, null);
  if (state?.ok) return <Message state={state} />;
  return (
    <details className="rounded-xl border border-cream-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-red-700">ต้องการยกเลิกการจอง?</summary>
      <form
        action={action}
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          if (!confirm("ยืนยันการยกเลิกการจองนี้?")) e.preventDefault();
        }}
      >
        <input type="hidden" name="code" value={code} />
        <label className="block text-sm">
          กรอกเบอร์โทรศัพท์ที่ใช้จองเพื่อยืนยัน
          <input name="phone" type="tel" required className={field} />
        </label>
        <Message state={state} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full border border-red-600 px-5 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
        >
          <Spinner show={pending} /> ยกเลิกการจอง
        </button>
      </form>
    </details>
  );
}

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-full border border-gold-500 px-5 py-2 text-sm font-semibold transition hover:bg-gold-500 hover:text-white print:hidden"
    >
      <Printer className="size-4" /> พิมพ์ / บันทึก PDF
    </button>
  );
}

// ----- แอดมิน -----
export function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLoginAction, null);
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        รหัสผ่านผู้ดูแล
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${goldBtn} w-full`}>
        <Spinner show={pending} /> เข้าสู่ระบบ
      </button>
    </form>
  );
}

export function AdminStatusButtons({ code, status, expired }: { code: string; status: string; expired: boolean }) {
  const [state, action, pending] = useActionState(adminSetStatusAction, null);
  const btn = "rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-50";
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="code" value={code} />
      <div className="flex flex-wrap justify-end gap-2">
        {status === "pending" && (
          <button name="status" value="confirmed" disabled={pending} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {expired ? "ยืนยัน (หมดเวลาแล้ว)" : "ยืนยันชำระเงิน"}
          </button>
        )}
        {status !== "cancelled" && (
          <button
            name="status"
            value="cancelled"
            disabled={pending}
            onClick={(e) => {
              if (!confirm(`ยกเลิกการจอง ${code}?`)) e.preventDefault();
            }}
            className={`${btn} border border-red-600 text-red-700 hover:bg-red-50`}
          >
            ยกเลิก
          </button>
        )}
      </div>
      {state?.error && <p className="text-xs text-red-700">{state.error}</p>}
    </form>
  );
}
