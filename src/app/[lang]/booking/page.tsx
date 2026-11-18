import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BedDouble, Check, Eye, User } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import StaySearchForm from "@/components/stay-search-form";
import { errorText, formatDate, getDict, localePath, stayErrorText, tr, trList, type Locale } from "@/i18n";
import { alternates, currentLang } from "@/i18n/page";
import { todayIn } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { parseStay, stayQuery, type StaySearch } from "@/lib/search";
import { searchAvailability } from "@/server/booking";
import { DomainError } from "@/server/errors";
import { getPublicRoomTypes, getSite } from "@/server/site";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await currentLang();
  return { title: getDict(lang).meta.booking, alternates: alternates(lang, "/booking") };
}

export default async function BookingPage({ searchParams }: PageProps<"/[lang]/booking">) {
  const lang = await currentLang();
  return (
    <div className="space-y-8">
      <Steps current={1} lang={lang} />
      <Suspense fallback={<Skeleton />}>
        <Results lang={lang} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ lang, searchParams }: { lang: Locale } & Pick<PageProps<"/[lang]/booking">, "searchParams">) {
  const d = getDict(lang);
  const raw = await searchParams;
  const { tenant, property } = await getSite();
  const parsed = parseStay(raw, { today: todayIn(property.timezone), maxNights: property.max_nights });
  const defaults = parsed.ok ? parsed.search : parsed.partial;
  const error = parsed.ok ? null : stayErrorText(lang, parsed.code, parsed.maxNights);

  return (
    <>
      <StaySearchForm lang={lang} defaults={defaults} title={d.search.titleSearch} />
      {parsed.ok ? (
        <RoomList lang={lang} tenantId={tenant.id} propertyId={tenant.propertyId!} s={parsed.search} />
      ) : (
        <div className={`rounded-2xl p-8 text-center ${error ? "bg-red-50 text-red-700" : "bg-white text-ink/70"}`}>
          {error ?? d.results.pickDates}
        </div>
      )}
    </>
  );
}

async function RoomList({ lang, tenantId, propertyId, s }: { lang: Locale; tenantId: string; propertyId: string; s: StaySearch }) {
  const d = getDict(lang);
  const t = d.results;
  let results;
  try {
    results = await searchAvailability(tenantId, { propertyId, checkIn: s.checkIn, checkOut: s.checkOut, adults: s.guests, children: s.children, rooms: s.rooms });
  } catch (e) {
    if (e instanceof DomainError) return <div className="rounded-2xl bg-red-50 p-8 text-center text-red-700">{errorText(lang, e)}</div>;
    throw e;
  }
  const types = await getPublicRoomTypes();

  return (
    <section className="space-y-5">
      <p className="text-ink/70">
        <span className="font-semibold text-ink">{formatDate(s.checkIn, lang)} – {formatDate(s.checkOut, lang)}</span>{" "}
        · {d.stay.nights(s.nights)} · {d.stay.adults(s.guests)}{s.children ? ` · ${d.stay.children(s.children)}` : ""} · {d.stay.rooms(s.rooms)}
      </p>
      {results.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-ink/70">{d.home.noRooms}</div>}

      {results.map((r) => {
        const rt = types.find((x) => x.id === r.roomTypeId)!;
        const name = tr(rt, "name", lang, rt.name_th);
        const bed = tr(rt, "bed_info", lang, rt.bed_info);
        const view = tr(rt, "view_type", lang, rt.view_type);
        const enough = r.available >= s.rooms && !r.closed;
        const cover = rt.images[0]?.url;
        return (
          <article key={r.roomTypeId} className="grid overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-15px_rgba(18,60,70,0.35)] ring-1 ring-cream-200 md:grid-cols-[280px_1fr]">
            <div className="relative h-48 bg-ivory md:h-auto">
              {cover && <Image src={cover} alt={name} fill sizes="(min-width:768px) 280px, 100vw" className="object-cover" />}
            </div>
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_300px]">
              <div className="min-w-0">
                <h3 className="text-xl font-bold">{name}</h3>
                <p className="mt-1 text-sm text-ink/70">{tr(rt, "description", lang, rt.description_th)}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink/70">
                  <span className="flex items-center gap-1.5"><User className="size-4" /> {t.capacity(rt.max_adults, rt.max_occupancy)}</span>
                  {bed && <span className="flex items-center gap-1.5"><BedDouble className="size-4" /> {bed}</span>}
                  {view && <span className="flex items-center gap-1.5"><Eye className="size-4" /> {view}</span>}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/70">
                  {trList(rt, "amenities", lang, rt.amenities).map((a) => <li key={a} className="flex items-center gap-1"><Check className="size-3 text-gold-500" /> {a}</li>)}
                </ul>
                <p className={`mt-3 text-sm font-medium ${!enough ? "text-red-600" : r.available <= 2 ? "text-orange-600" : "text-emerald-700"}`}>
                  {r.closed ? t.closed : r.available === 0 ? t.full : r.available < s.rooms ? t.onlyLeft(r.available) : t.available(r.available)}
                </p>
              </div>
              <div className="space-y-3">
                {r.plans.map((p) => (
                  <div key={p.ratePlanId} className="rounded-xl bg-ivory p-4">
                    <p className="text-sm font-semibold">{tr(p, "name", lang, p.name)}</p>
                    {p.error ? (
                      <p className="mt-1 text-xs text-ink/60">{errorText(lang, { code: p.errorCode, message: p.error })}</p>
                    ) : (
                      <>
                        <p className="mt-1 text-2xl font-bold tabular-nums">{formatSatang(p.total)}</p>
                        <p className="text-xs text-ink/60">
                          {t.totalFor(s.nights, s.rooms)} · {p.tax.inclusive ? t.taxIncluded : t.taxAdded(formatSatang(p.tax.vat), p.tax.serviceCharge ? formatSatang(p.tax.serviceCharge) : null)}
                        </p>
                        {enough ? (
                          <Link href={`${localePath(lang, "/booking/details")}?${stayQuery(s, { room: r.roomTypeId, plan: p.ratePlanId })}`} className="bg-gold mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold text-white shadow transition hover:brightness-110">
                            {t.select} <ArrowRight className="size-4" />
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
