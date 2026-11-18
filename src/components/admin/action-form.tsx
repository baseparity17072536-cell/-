"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import type { ActionState } from "@/app/admin/actions";

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

/** Form bound to a server action: shows pending state, success/error message and optional link to copy. */
export function ActionForm({
  action,
  children,
  submitLabel = "บันทึก",
  submitClass,
  className = "space-y-4",
  confirm: confirmText,
  resetOnSuccess = false,
  inlineSubmit = false,
  hideSubmit = false,
}: {
  action: Action;
  children: ReactNode;
  submitLabel?: ReactNode;
  submitClass?: string;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
  inlineSubmit?: boolean;
  hideSubmit?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  const btn = (
    <button
      type="submit"
      disabled={pending}
      className={submitClass ?? "inline-flex items-center justify-center gap-2 rounded-lg bg-teal-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-mid disabled:opacity-60"}
    >
      {pending && <Loader2 className="size-4 animate-spin" />} {submitLabel}
    </button>
  );

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      {inlineSubmit ? !hideSubmit && btn : (
        <div className="flex flex-wrap items-center gap-3">
          {!hideSubmit && btn}
          <Message state={state} />
        </div>
      )}
      {inlineSubmit && <Message state={state} />}
    </form>
  );
}

export function Message({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <div role="status" className="space-y-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
        <p>{state.ok}</p>
        {state.link && <CopyLink link={state.link} />}
        {state.codes && <RecoveryCodes codes={state.codes} />}
      </div>
    );
  return null;
}

/** One-time recovery codes: shown once, so offer copy and download. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`รหัสกู้คืน FahTalay (ใช้ได้รหัสละ 1 ครั้ง)\n\n${text}\n`], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "fahtalay-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-2 text-ink">
      <p className="font-semibold text-red-700">เก็บรหัสกู้คืนเหล่านี้ไว้ในที่ปลอดภัย ระบบจะแสดงครั้งเดียว</p>
      <p className="text-xs text-ink/70">ใช้แทนรหัสจากแอปได้รหัสละ 1 ครั้ง เมื่อโทรศัพท์หายหรือเปลี่ยนเครื่อง</p>
      <ol className="grid grid-cols-2 gap-1 rounded-lg bg-white p-3 font-mono text-sm ring-1 ring-emerald-200">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-1 text-xs"
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"}
        </button>
        <button type="button" className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs" onClick={download}>ดาวน์โหลดเป็นไฟล์</button>
      </div>
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={link} className="w-full min-w-0 rounded border border-emerald-200 bg-white px-2 py-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-300 bg-white px-2 py-1 text-xs"
        onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? "คัดลอกแล้ว" : "คัดลอก"}
      </button>
    </div>
  );
}

/** A single button that submits a server action with hidden fields (e.g. status change). */
export function ActionButton({
  action, fields, label, className, confirm: confirmText, prompt,
}: {
  action: Action; fields: Record<string, string | number>; label: ReactNode; className?: string; confirm?: string;
  /** ask for a reason before submitting (stored in field "reason") */
  prompt?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const reasonRef = useRef<HTMLInputElement>(null);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col gap-1"
      onSubmit={(e) => {
        if (prompt) {
          const r = window.prompt(prompt);
          if (!r?.trim()) return e.preventDefault();
          reasonRef.current!.value = r.trim();
        } else if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {prompt && <input ref={reasonRef} type="hidden" name="reason" />}
      <button type="submit" disabled={pending} className={className}>
        {pending && <Loader2 className="size-4 animate-spin" />} {label}
      </button>
      {state?.error && <span className="max-w-64 text-xs text-red-700">{state.error}</span>}
      {state?.ok && <span className="max-w-64 text-xs text-emerald-700">{state.ok}</span>}
    </form>
  );
}
