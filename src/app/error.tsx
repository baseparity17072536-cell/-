"use client";

// Shown when a page fails on the server. In production the real reason is only in the server logs
// (e.g. Vercel → Logs); the "digest" code below matches the log entry.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-cream-200">
        <h1 className="text-xl font-bold text-ink">ขออภัย ระบบขัดข้องชั่วคราว</h1>
        <p className="mt-2 text-sm text-ink/70">กรุณาลองใหม่อีกครั้ง หากยังเกิดซ้ำ กรุณาติดต่อรีสอร์ททางโทรศัพท์</p>
        <button onClick={reset} className="bg-gold mt-6 rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow">
          ลองใหม่
        </button>
        {error.digest && <p className="mt-6 font-mono text-xs text-ink/40">รหัสอ้างอิง: {error.digest}</p>}
        <p className="mt-2 text-xs text-ink/40">สำหรับผู้ดูแลระบบ: ดูสาเหตุได้ใน Server Logs โดยค้นหารหัสอ้างอิงนี้</p>
      </div>
    </div>
  );
}
