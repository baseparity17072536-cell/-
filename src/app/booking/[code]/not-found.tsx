import Link from "next/link";

export default function BookingNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-cream-200">
      <h1 className="text-xl font-bold">ไม่พบการจองนี้</h1>
      <p className="mt-2 text-sm text-ink/60">กรุณาตรวจสอบรหัสการจองอีกครั้ง</p>
      <Link href="/booking/lookup" className="mt-4 inline-block font-semibold text-gold-600 underline">
        ค้นหาการจอง
      </Link>
    </div>
  );
}
