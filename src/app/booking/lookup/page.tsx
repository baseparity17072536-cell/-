import type { Metadata } from "next";
import { LookupForm } from "@/components/booking-forms";

export const metadata: Metadata = { title: "ตรวจสอบการจอง | ฟ้าทะเลรีสอร์ท" };

export default function LookupPage() {
  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-cream-200">
      <h1 className="text-2xl font-bold">ตรวจสอบการจอง</h1>
      <p className="mb-6 mt-1 text-sm text-ink/60">กรอกรหัสการจองและเบอร์โทรศัพท์ที่ใช้จอง</p>
      <LookupForm />
    </div>
  );
}
