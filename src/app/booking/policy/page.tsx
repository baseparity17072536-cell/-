import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Skeleton from "@/components/skeleton";
import { formatSatang } from "@/lib/money";
import { getSite } from "@/server/site";

export const metadata: Metadata = { title: "เงื่อนไขการจองและการเข้าพัก" };

export default function PolicyPage() {
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <Policy />
    </Suspense>
  );
}

// ทุกข้ออ้างอิงค่าที่ระบบใช้งานจริงจากการตั้งค่าที่พัก (หลังบ้าน → ตั้งค่าที่พัก)
async function Policy() {
  const { property: p, holdHours } = await getSite();
  const tm = (t: string) => t.slice(0, 5);
  const rules: { title: string; items: string[] }[] = [
    {
      title: "การจองและการชำระเงิน",
      items: [
        `หลังส่งคำขอจอง ระบบจะกันห้องไว้ให้ ${holdHours} ชั่วโมงเพื่อรอการชำระเงิน`,
        "หากไม่ชำระภายในเวลาที่กำหนด การจองจะหมดอายุและห้องจะเปิดให้ผู้อื่นจองโดยอัตโนมัติ",
        "การจองจะสมบูรณ์เมื่อเจ้าหน้าที่ตรวจสอบการชำระเงินและเปลี่ยนสถานะเป็น “ยืนยันแล้ว”",
        `จองได้สูงสุด ${p.max_nights} คืนต่อการจอง และล่วงหน้าได้ไม่เกิน ${p.booking_window_days} วัน`,
        p.prices_include_tax ? "ราคาที่แสดงรวมภาษีมูลค่าเพิ่มแล้ว" : `ราคาห้องยังไม่รวม${p.service_charge_bp ? ` ค่าบริการ ${p.service_charge_bp / 100}% และ` : ""} VAT ${p.vat_bp / 100}% ซึ่งจะแสดงในยอดรวมก่อนยืนยันการจอง`,
      ],
    },
    {
      title: "การเข้าพัก",
      items: [
        `เช็คอินตั้งแต่เวลา ${tm(p.check_in_time)} น. และเช็คเอาท์ก่อนเวลา ${tm(p.check_out_time)} น.`,
        "กรุณาแสดงรหัสการจองที่เคาน์เตอร์ในวันเช็คอิน",
        `เด็กหมายถึงผู้เข้าพักอายุไม่เกิน ${p.child_max_age} ปี`,
        ...(p.damage_deposit_satang > 0 ? [`มีเงินประกันความเสียหาย ${formatSatang(p.damage_deposit_satang)} ชำระที่รีสอร์ทวันเช็คอิน และได้รับคืนเมื่อเช็คเอาท์`] : []),
      ],
    },
    {
      title: "การยกเลิก",
      items: [
        "การจองที่ยังไม่ได้ชำระเงิน ยกเลิกได้ด้วยตนเองที่หน้า “ตรวจสอบการจอง” โดยยืนยันด้วยเบอร์โทรศัพท์ที่ใช้จอง",
        `การจองที่ชำระเงินแล้ว กรุณาติดต่อรีสอร์ท${p.phone ? `ที่ ${p.phone}` : ""} เพื่อดำเนินการยกเลิกหรือเปลี่ยนแปลง`,
      ],
    },
    {
      title: "ข้อมูลส่วนบุคคล",
      items: [
        "ข้อมูลชื่อ เบอร์โทรศัพท์ และอีเมล ใช้เพื่อการจองและติดต่อเรื่องการเข้าพักเท่านั้น",
        "หน้ารายละเอียดการจองจะแสดงข้อมูลส่วนบุคคลเฉพาะผู้ที่ยืนยันด้วยเบอร์โทรศัพท์แล้ว",
      ],
    },
  ];

  return (
    <article className="mx-auto max-w-3xl space-y-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-cream-200 sm:p-10">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">เงื่อนไขการจองและการเข้าพัก</h1>
        <p className="mt-1 text-sm text-ink/60">{p.name_th}</p>
      </header>
      {rules.map((r) => (
        <section key={r.title}>
          <h2 className="text-lg font-bold">{r.title}</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink/80">
            {r.items.map((i) => <li key={i}>{i}</li>)}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap gap-3 border-t border-cream-200 pt-6">
        <Link href="/booking" className="bg-gold rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow">จองห้องพัก</Link>
        <Link href="/booking/lookup" className="rounded-full border border-ink/20 px-6 py-2.5 text-sm font-semibold">ตรวจสอบการจอง</Link>
      </div>
    </article>
  );
}
