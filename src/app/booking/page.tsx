import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, BedDouble, Check, User } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import StaySearchForm from "@/components/stay-search-form";
import { getAvailability } from "@/lib/bookings";
import { formatBaht, formatThaiDate } from "@/lib/dates";
import { ROOM_TYPES } from "@/lib/rooms";
import { parseStay, stayQuery } from "@/lib/search";

export const metadata: Metadata = { title: "จองห้องพัก | ฟ้าทะเลรีสอร์ท" };

export default function BookingPage({ searchParams }: PageProps<"/booking">) {
  return (
    <div className="space-y-8">
      <Steps current={1} />
      <Suspense fallback={<Skeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/booking">, "searchParams">) {
  const raw = await searchParams;
  await connection(); // ใช้วันที่ปัจจุบันและข้อมูลห้องว่างล่าสุดทุกครั้ง
  const parsed = parseStay(raw);
  const defaults = parsed.ok ? parsed.search : parsed.partial;

  return (
    <>
      <StaySearchForm defaults={defaults} title="ค้นหาห้องว่าง" />
      {parsed.ok ? (
        <RoomList {...parsed.search} />
      ) : (
        <div
          className={`rounded-2xl p-8 text-center ${parsed.error ? "bg-red-50 text-red-700" : "bg-white text-ink/70"}`}
        >
          {parsed.error ?? "เลือกวันเช็คอิน–เช็คเอาท์ แล้วกด “ค้นหาห้องว่าง” เพื่อดูห้องพักและราคา"}
        </div>
      )}
    </>
  );
}

async function RoomList(s: { checkIn: string; checkOut: string; nights: number; guests: number; rooms: number }) {
  const free = await getAvailability(s.checkIn, s.checkOut);

  return (
    <section className="space-y-5">
      <p className="text-ink/70">
        <span className="font-semibold text-ink">
          {formatThaiDate(s.checkIn)} – {formatThaiDate(s.checkOut)}
        </span>{" "}
        · {s.nights} คืน · {s.guests} ผู้ใหญ่ · {s.rooms} ห้อง
      </p>

      {ROOM_TYPES.map((r) => {
        const left = free[r.id];
        const enoughRooms = left >= s.rooms;
        const fits = s.guests <= r.capacity * s.rooms;
        const total = r.price * s.nights * s.rooms;
        const minRooms = Math.ceil(s.guests / r.capacity);

        return (
          <article
            key={r.id}
            className="grid overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-15px_rgba(12,63,77,0.35)] ring-1 ring-cream-200 md:grid-cols-[280px_1fr_240px]"
          >
            <div className="relative h-48 md:h-auto">
              <Image src={r.image} alt={r.name} fill sizes="(min-width:768px) 280px, 100vw" className="object-cover" />
            </div>
            <div className="p-5">
              <h3 className="text-xl font-bold">{r.name}</h3>
              <p className="mt-1 text-sm text-ink/70">{r.description}</p>
              <div className="mt-3 flex gap-5 text-sm text-ink/70">
                <span className="flex items-center gap-1.5">
                  <User className="size-4" /> สูงสุด {r.capacity} คน/ห้อง
                </span>
                <span className="flex items-center gap-1.5">
                  <BedDouble className="size-4" /> {r.beds}
                </span>
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/70">
                {r.amenities.map((a) => (
                  <li key={a} className="flex items-center gap-1">
                    <Check className="size-3 text-gold-500" /> {a}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col justify-between gap-3 border-t border-cream-200 bg-cream/60 p-5 md:border-l md:border-t-0">
              <div>
                <p className="text-sm text-ink/60">฿{formatBaht(r.price)} / ห้อง / คืน</p>
                <p className="text-2xl font-bold">฿{formatBaht(total)}</p>
                <p className="text-xs text-ink/60">
                  รวม {s.nights} คืน × {s.rooms} ห้อง
                </p>
                <p className={`mt-2 text-sm font-medium ${left === 0 ? "text-red-600" : left <= 2 ? "text-orange-600" : "text-emerald-700"}`}>
                  {left === 0 ? "ห้องเต็ม" : `ว่าง ${left} ห้อง`}
                </p>
              </div>
              {enoughRooms && fits ? (
                <Link
                  href={`/booking/details?${stayQuery(s, { room: r.id })}`}
                  className="bg-gold inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold text-white shadow transition hover:brightness-110"
                >
                  เลือกห้องนี้ <ArrowRight className="size-4" />
                </Link>
              ) : (
                <p className="rounded-lg bg-white px-3 py-2 text-xs text-ink/70">
                  {!fits
                    ? `ผู้เข้าพัก ${s.guests} ท่าน ต้องจองอย่างน้อย ${minRooms} ห้อง`
                    : left === 0
                      ? "ไม่มีห้องว่างในช่วงวันที่เลือก"
                      : `เหลือเพียง ${left} ห้อง ลองลดจำนวนห้อง`}
                </p>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
