import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import { GuestForm } from "@/components/booking-forms";
import { getAvailability } from "@/lib/bookings";
import { formatBaht, formatThaiDate } from "@/lib/dates";
import { RESORT, getRoomType } from "@/lib/rooms";
import { parseStay, stayQuery } from "@/lib/search";

export const metadata: Metadata = { title: "กรอกข้อมูลผู้เข้าพัก | ฟ้าทะเลรีสอร์ท" };

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
  await connection(); // ใช้วันที่ปัจจุบันและข้อมูลห้องว่างล่าสุดทุกครั้ง
  const parsed = parseStay(raw);
  const room = getRoomType(Array.isArray(raw.room) ? raw.room[0] : raw.room);

  if (!parsed.ok) return <Problem message={parsed.error ?? "กรุณาเลือกวันที่เข้าพัก"} back="/booking" />;
  const s = parsed.search;
  const back = `/booking?${stayQuery(s)}`;
  if (!room) return <Problem message="ไม่พบประเภทห้องพักที่เลือก" back={back} />;
  if (s.guests > room.capacity * s.rooms)
    return <Problem message={`ห้อง ${room.name} พักได้สูงสุด ${room.capacity} ท่านต่อห้อง`} back={back} />;

  const left = (await getAvailability(s.checkIn, s.checkOut))[room.id];
  if (left < s.rooms) return <Problem message="ขออภัย ห้องประเภทนี้ไม่ว่างแล้วในช่วงวันที่เลือก" back={back} />;

  const total = room.price * s.nights * s.rooms;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-cream-200 sm:p-8">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
          <ArrowLeft className="size-4" /> เปลี่ยนห้องพัก
        </Link>
        <h1 className="mt-2 text-2xl font-bold">ข้อมูลผู้เข้าพัก</h1>
        <p className="mb-6 mt-1 text-sm text-ink/60">กรอกข้อมูลผู้ติดต่อหลักสำหรับการจองนี้</p>
        <GuestForm
          hidden={{
            room: room.id,
            checkin: s.checkIn,
            checkout: s.checkOut,
            guests: String(s.guests),
            rooms: String(s.rooms),
          }}
        />
      </section>

      <aside className="h-fit overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-cream-200 lg:sticky lg:top-6">
        <div className="relative h-40">
          <Image src={room.image} alt={room.name} fill sizes="380px" className="object-cover" />
        </div>
        <div className="space-y-3 p-6 text-sm">
          <h2 className="text-lg font-bold">{room.name}</h2>
          <Row label="เช็คอิน" value={`${formatThaiDate(s.checkIn, { weekday: "short" })} · ${RESORT.checkInTime} น.`} />
          <Row label="เช็คเอาท์" value={`${formatThaiDate(s.checkOut, { weekday: "short" })} · ${RESORT.checkOutTime} น.`} />
          <Row label="จำนวน" value={`${s.nights} คืน · ${s.rooms} ห้อง · ${s.guests} ผู้ใหญ่`} />
          <Row label="ราคาห้อง" value={`฿${formatBaht(room.price)} × ${s.nights} คืน × ${s.rooms} ห้อง`} />
          <div className="flex items-end justify-between border-t border-cream-200 pt-3">
            <span className="font-semibold">ยอดรวม</span>
            <span className="text-2xl font-bold">฿{formatBaht(total)}</span>
          </div>
          <p className="text-xs text-ink/60">
            ราคารวมภาษีแล้ว · เงินประกันความเสียหาย ฿{RESORT.deposit} ชำระที่รีสอร์ทวันเช็คอิน (ได้คืนเมื่อเช็คเอาท์)
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
