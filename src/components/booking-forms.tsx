"use client";

import { useActionState, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { cancelBookingAction, createBookingAction, lookupBookingAction, type FormState } from "@/app/actions";
import { getDict, localePath, type Locale } from "@/i18n";

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

/** The server answers (errors, redirects) in the language of the page the form was sent from. */
const LangField = ({ lang }: { lang: Locale }) => <input type="hidden" name="lang" value={lang} />;

// ----- ขั้นตอนที่ 2: ข้อมูลผู้เข้าพัก -----
export function GuestForm({ hidden, holdHours, lang }: { hidden: Record<string, string>; holdHours: number; lang: Locale }) {
  const t = getDict(lang).form;
  const [state, action, pending] = useActionState(createBookingAction, null);
  // one key per form: double clicks / resubmits create a single booking
  const [idem] = useState(() => crypto.randomUUID());
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <LangField lang={lang} />
      <input type="hidden" name="idempotency_key" value={idem} />
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="text-sm font-medium sm:col-span-2">
        {t.name} <span className="text-red-600">*</span>
        <input name="name" required autoComplete="name" className={field} placeholder={t.namePh} />
      </label>
      <label className="text-sm font-medium">
        {t.phone} <span className="text-red-600">*</span>
        <input name="phone" type="tel" required autoComplete="tel" className={field} placeholder={lang === "th" ? "08x-xxx-xxxx" : "+66 8x xxx xxxx"} />
      </label>
      <label className="text-sm font-medium">
        {t.email}
        <input name="email" type="email" autoComplete="email" className={field} placeholder="you@example.com" />
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        {t.note}
        <textarea name="note" rows={3} className={field} placeholder={t.notePh} />
      </label>
      <label className="flex items-start gap-3 text-sm sm:col-span-2">
        <input name="accept" type="checkbox" required className="mt-1 size-4 accent-[#c49a4c]" />
        <span>
          {t.acceptPre}{" "}
          <a href={localePath(lang, "/booking/policy")} target="_blank" className="font-semibold text-gold-600 underline">
            {t.acceptLink}
          </a>
          {t.acceptPost(holdHours)}
        </span>
      </label>
      <div className="sm:col-span-2">
        <Message state={state} />
      </div>
      <button type="submit" disabled={pending} className={`${goldBtn} sm:col-span-2`}>
        <Spinner show={pending} /> {pending ? t.submitting : t.submit}
      </button>
    </form>
  );
}

// ----- ตรวจสอบการจอง -----
export function LookupForm({ lang }: { lang: Locale }) {
  const t = getDict(lang).form;
  const [state, action, pending] = useActionState(lookupBookingAction, null);
  return (
    <form action={action} className="space-y-4">
      <LangField lang={lang} />
      <label className="block text-sm font-medium">
        {t.code}
        <input name="code" required className={`${field} uppercase`} placeholder="FTXXXXXXXX" />
      </label>
      <label className="block text-sm font-medium">
        {t.lookupPhone}
        <input name="phone" type="tel" required className={field} placeholder={lang === "th" ? "08x-xxx-xxxx" : "+66 8x xxx xxxx"} />
      </label>
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${goldBtn} w-full`}>
        <Spinner show={pending} /> {t.lookupSubmit}
      </button>
    </form>
  );
}

// ----- ยกเลิกการจอง (ลูกค้า) -----
export function CancelForm({ code, lang }: { code: string; lang: Locale }) {
  const t = getDict(lang).form;
  const [state, action, pending] = useActionState(cancelBookingAction, null);
  if (state?.ok) return <Message state={state} />;
  return (
    <details className="rounded-xl border border-cream-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-red-700">{t.cancelAsk}</summary>
      <form
        action={action}
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          if (!confirm(t.cancelConfirm)) e.preventDefault();
        }}
      >
        <LangField lang={lang} />
        <input type="hidden" name="code" value={code} />
        <label className="block text-sm">
          {t.cancelPhone}
          <input name="phone" type="tel" required className={field} />
        </label>
        <Message state={state} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full border border-red-600 px-5 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
        >
          <Spinner show={pending} /> {t.cancelSubmit}
        </button>
      </form>
    </details>
  );
}

export function PrintButton({ lang }: { lang: Locale }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-full border border-gold-500 px-5 py-2 text-sm font-semibold transition hover:bg-gold-500 hover:text-white print:hidden"
    >
      <Printer className="size-4" /> {getDict(lang).form.print}
    </button>
  );
}
