import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import { GuestForm } from "@/components/booking-forms";
import { formatThaiDate, todayIn } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { parseStay, stayQuery } from "@/lib/search";
import { searchAvailability } from "@/server/booking";
import { DomainError } from "@/server/errors";
import { getPublicRoomType, getSite } from "@/server/site";

export const metadata: Metadata = { title: "กรอกข้อมูลผู้เข้าพัก" };

export default function DetailsPage({ searchParams }: PageProps<"/booking/details">) {
  return (
    <div className="space-y-8">
      <Steps current={2} />
      <Suspense fallback={<Skeleton rows={2} />}>
        <Details searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Problem({ message, back }: { message: string; back: string }) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center">
      <p className="text-red-700">{message}</p>
      <Link href={back} className="mt-4 inline-flex items-center gap-2 font-semibold text-gold-600 underline">
        <ArrowLeft className="size-4" /> กลับไปเลือกห้องพัก
      </Link>
    </div>
  );
}

async function Details({ searchParams }: Pick<PageProps<"/booking/details">, "searchParams">) {
  const raw = await searchParams;
  const { tenant, property, holdHours } = await getSite();
  const parsed = parseStay(raw, { today: todayIn(property.timezone), maxNights: property.max_nights });
  if (!parsed.ok) return <Problem message={parsed.error ?? "กรุณาเลือกวันที่เข้าพัก"} back="/booking" />;
  const s = parsed.search;
  const back = `/booking?${stayQuery(s)}`;
  const roomId = typeof raw.room === "string" ? raw.room : "";
  const planId = typeof raw.plan === "string" ? raw.plan : "";
  const room = await getPublicRoomType(roomId);
  if (!room) return <Problem message="ไม่พบประเภทห้องพักที่เลือก" back={back} />;

  let result;
  try {
    result = (await searchAvailability(tenant.id, { propertyId: tenant.propertyId!, checkIn: s.checkIn, checkOut: s.checkOut, adults: s.guests, children: s.children, rooms: s.rooms }))
      .find((r) => r.roomTypeId === room.id);
  } catch (e) {
    if (e instanceof DomainError) return <Problem message={e.message} back={back} />;
    throw e;
  }
  const plan = result?.plans.find((p) => p.ratePlanId === planId) ?? result?.plans[0];
  if (!result || !plan) return <Problem message="ไม่พบแพ็กเกจราคาที่เลือก" back={back} />;
  if (plan.error) return <Problem message={plan.error} back={back} />;
  if (result.closed || result.available < s.rooms) return <Problem message="ขออภัย ห้องประเภทนี้ไม่ว่างแล้วในช่วงวันที่เลือก" back={back} />;

  const tm = (t: string) => t.slice(0, 5);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-cream-200 sm:p-8">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"><ArrowLeft className="size-4" /> เปลี่ยนห้องพัก</Link>
        <h1 className="mt-2 text-2xl font-bold">ข้อมูลผู้เข้าพัก</h1>
        <p className="mb-6 mt-1 text-sm text-ink/60">กรอกข้อมูลผู้ติดต่อหลักสำหรับการจองนี้</p>
        <GuestForm
          holdHours={holdHours}
          hidden={{ room: room.id, plan: plan.ratePlanId, checkin: s.checkIn, checkout: s.checkOut, guests: String(s.guests), children: String(s.children), rooms: String(s.rooms) }}
        />
      </section>

      <aside className="h-fit overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-cream-200 lg:sticky lg:top-6">
        <div className="relative h-40 bg-ivory">
          {room.images[0] && <Image src={room.images[0].url} alt={room.name_th} fill sizes="380px" className="object-cover" />}
        </div>
        <div className="space-y-3 p-6 text-sm">
          <h2 className="text-lg font-bold">{room.name_th}</h2>
          <Row label="แพ็กเกจ" value={plan.name} />
          <Row label="เช็คอิน" value={`${formatThaiDate(s.checkIn, { weekday: "short" })} · ${tm(property.check_in_time)} น.`} />
          <Row label="เช็คเอาท์" value={`${formatThaiDate(s.checkOut, { weekday: "short" })} · ${tm(property.check_out_time)} น.`} />
          <Row label="จำนวน" value={`${s.nights} คืน · ${s.rooms} ห้อง · ${s.guests} ผู้ใหญ่${s.children ? ` · ${s.children} เด็ก` : ""}`} />
          <details className="rounded-lg bg-ivory px-3 py-2 text-xs">
            <summary className="cursor-pointer">ราคาแต่ละคืน</summary>
            <ul className="mt-2 space-y-1">
              {plan.nightly.map((n) => (
                <li key={n.date} className="flex justify-between gap-2"><span>{formatThaiDate(n.date, { weekday: "short" })} <span className="text-ink/50">({n.source})</span></span><span className="tabular-nums">{formatSatang(n.amount)}</span></li>
              ))}
            </ul>
          </details>
          {!plan.tax.inclusive && (
            <>
              <Row label="ค่าห้องพัก" value={formatSatang(plan.tax.net)} />
              {plan.tax.serviceCharge > 0 && <Row label="ค่าบริการ" value={formatSatang(plan.tax.serviceCharge)} />}
              <Row label="VAT" value={formatSatang(plan.tax.vat)} />
            </>
          )}
          <div className="flex items-end justify-between border-t border-cream-200 pt-3">
            <span className="font-semibold">ยอดรวม</span>
            <span className="text-2xl font-bold tabular-nums">{formatSatang(plan.total)}</span>
          </div>
          <p className="text-xs text-ink/60">
            {plan.tax.inclusive ? "ราคารวมภาษีแล้ว" : "ราคารวมภาษีและค่าบริการแล้ว"}
            {property.damage_deposit_satang > 0 && ` · เงินประกันความเสียหาย ${formatSatang(property.damage_deposit_satang)} ชำระที่รีสอร์ทวันเช็คอิน (ได้คืนเมื่อเช็คเอาท์)`}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink/60">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
