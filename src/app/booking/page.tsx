import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BedDouble, Check, Eye, User } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import StaySearchForm from "@/components/stay-search-form";
import { formatThaiDate, todayIn } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { parseStay, stayQuery } from "@/lib/search";
import { searchAvailability } from "@/server/booking";
import { DomainError } from "@/server/errors";
import { getPublicRoomTypes, getSite } from "@/server/site";

export const metadata: Metadata = { title: "จองห้องพัก" };

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
  const { tenant, property } = await getSite();
  const parsed = parseStay(raw, { today: todayIn(property.timezone), maxNights: property.max_nights });
  const defaults = parsed.ok ? parsed.search : parsed.partial;

  return (
    <>
      <StaySearchForm defaults={defaults} title="ค้นหาห้องว่าง" />
      {parsed.ok ? (
        <RoomList tenantId={tenant.id} propertyId={tenant.propertyId!} s={parsed.search} />
      ) : (
        <div className={`rounded-2xl p-8 text-center ${parsed.error ? "bg-red-50 text-red-700" : "bg-white text-ink/70"}`}>
          {parsed.error ?? "เลือกวันเช็คอิน–เช็คเอาท์ แล้วกด “ค้นหาห้องว่าง” เพื่อดูห้องพักและราคา"}
        </div>
      )}
    </>
  );
}

async function RoomList({ tenantId, propertyId, s }: { tenantId: string; propertyId: string; s: NonNullable<ReturnType<typeof parseStay> & { ok: true }>["search"] }) {
  let results;
  try {
    results = await searchAvailability(tenantId, { propertyId, checkIn: s.checkIn, checkOut: s.checkOut, adults: s.guests, children: s.children, rooms: s.rooms });
  } catch (e) {
    if (e instanceof DomainError) return <div className="rounded-2xl bg-red-50 p-8 text-center text-red-700">{e.message}</div>;
    throw e;
  }
  const types = await getPublicRoomTypes();

  return (
    <section className="space-y-5">
      <p className="text-ink/70">
        <span className="font-semibold text-ink">{formatThaiDate(s.checkIn)} – {formatThaiDate(s.checkOut)}</span>{" "}
        · {s.nights} คืน · {s.guests} ผู้ใหญ่{s.children ? ` · ${s.children} เด็ก` : ""} · {s.rooms} ห้อง
      </p>
      {results.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-ink/70">ยังไม่มีห้องพักเปิดขาย</div>}

      {results.map((r) => {
        const t = types.find((x) => x.id === r.roomTypeId)!;
        const enough = r.available >= s.rooms && !r.closed;
        const cover = t.images[0]?.url;
        return (
          <article key={r.roomTypeId} className="grid overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-15px_rgba(18,60,70,0.35)] ring-1 ring-cream-200 md:grid-cols-[280px_1fr]">
            <div className="relative h-48 bg-ivory md:h-auto">
              {cover && <Image src={cover} alt={t.name_th} fill sizes="(min-width:768px) 280px, 100vw" className="object-cover" />}
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_300px]">
              <div className="min-w-0">
                <h3 className="text-xl font-bold">{t.name_th}</h3>
                <p className="mt-1 text-sm text-ink/70">{t.description_th}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink/70">
                  <span className="flex items-center gap-1.5"><User className="size-4" /> ผู้ใหญ่ {t.max_adults} · รวม {t.max_occupancy} คน/ห้อง</span>
                  {t.bed_info && <span className="flex items-center gap-1.5"><BedDouble className="size-4" /> {t.bed_info}</span>}
                  {t.view_type && <span className="flex items-center gap-1.5"><Eye className="size-4" /> {t.view_type}</span>}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/70">
                  {t.amenities.map((a) => <li key={a} className="flex items-center gap-1"><Check className="size-3 text-gold-500" /> {a}</li>)}
                </ul>
                <p className={`mt-3 text-sm font-medium ${!enough ? "text-red-600" : r.available <= 2 ? "text-orange-600" : "text-emerald-700"}`}>
                  {r.closed ? "ปิดรับจองบางคืนในช่วงนี้" : r.available === 0 ? "ห้องเต็ม" : r.available < s.rooms ? `เหลือเพียง ${r.available} ห้อง` : `ว่าง ${r.available} ห้อง`}
                </p>
              </div>
              <div className="space-y-3">
                {r.plans.map((p) => (
                  <div key={p.ratePlanId} className="rounded-xl bg-ivory p-4">
                    <p className="text-sm font-semibold">{p.name}</p>
                    {p.error ? (
                      <p className="mt-1 text-xs text-ink/60">{p.error}</p>
                    ) : (
                      <>
                        <p className="mt-1 text-2xl font-bold tabular-nums">{formatSatang(p.total)}</p>
                        <p className="text-xs text-ink/60">
                          รวม {s.nights} คืน × {s.rooms} ห้อง · {p.tax.inclusive ? "รวมภาษีแล้ว" : `รวม VAT ${formatSatang(p.tax.vat)}${p.tax.serviceCharge ? ` และค่าบริการ ${formatSatang(p.tax.serviceCharge)}` : ""}`}
                        </p>
                        {enough ? (
                          <Link href={`/booking/details?${stayQuery(s, { room: r.roomTypeId, plan: p.ratePlanId })}`} className="bg-gold mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold text-white shadow transition hover:brightness-110">
                            เลือก <ArrowRight className="size-4" />
                          </Link>
                        ) : null}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
