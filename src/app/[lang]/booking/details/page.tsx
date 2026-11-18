import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import { GuestForm } from "@/components/booking-forms";
import { errorText, formatDate, getDict, localePath, stayErrorText, tr, type Locale } from "@/i18n";
import { currentLang } from "@/i18n/page";
import { todayIn } from "@/lib/dates";
import { formatSatang } from "@/lib/money";
import { parseStay, stayQuery } from "@/lib/search";
import { searchAvailability } from "@/server/booking";
import { DomainError } from "@/server/errors";
import { getPublicRoomType, getSite } from "@/server/site";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await currentLang();
  return { title: getDict(lang).meta.details, robots: { index: false, follow: false } };
}

export default async function DetailsPage({ searchParams }: PageProps<"/[lang]/booking/details">) {
  const lang = await currentLang();
  return (
    <div className="space-y-8">
      <Steps current={2} lang={lang} />
      <Suspense fallback={<Skeleton rows={2} />}>
        <Details lang={lang} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Problem({ message, back, label }: { message: string; back: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center">
      <p className="text-red-700">{message}</p>
      <Link href={back} className="mt-4 inline-flex items-center gap-2 font-semibold text-gold-600 underline">
        <ArrowLeft className="size-4" /> {label}
      </Link>
    </div>
  );
}

async function Details({ lang, searchParams }: { lang: Locale } & Pick<PageProps<"/[lang]/booking/details">, "searchParams">) {
  const d = getDict(lang);
  const t = d.details;
  const raw = await searchParams;
  const { tenant, property, holdHours } = await getSite();
  const bookingPath = localePath(lang, "/booking");
  const parsed = parseStay(raw, { today: todayIn(property.timezone), maxNights: property.max_nights });
  if (!parsed.ok)
    return <Problem message={stayErrorText(lang, parsed.code, parsed.maxNights) ?? d.errors.datesRequired} back={bookingPath} label={t.back} />;
  const s = parsed.search;
  const back = `${bookingPath}?${stayQuery(s)}`;
  const problem = (message: string) => <Problem message={message} back={back} label={t.back} />;
  const roomId = typeof raw.room === "string" ? raw.room : "";
  const planId = typeof raw.plan === "string" ? raw.plan : "";
  const room = await getPublicRoomType(roomId);
  if (!room) return problem(t.notFoundRoom);

  let result;
  try {
    result = (await searchAvailability(tenant.id, { propertyId: tenant.propertyId!, checkIn: s.checkIn, checkOut: s.checkOut, adults: s.guests, children: s.children, rooms: s.rooms }))
      .find((r) => r.roomTypeId === room.id);
  } catch (e) {
    if (e instanceof DomainError) return problem(errorText(lang, e));
    throw e;
  }
  const plan = result?.plans.find((p) => p.ratePlanId === planId) ?? result?.plans[0];
  if (!result || !plan) return problem(t.notFoundPlan);
  if (plan.error) return problem(errorText(lang, { code: plan.errorCode, message: plan.error }));
  if (result.closed || result.available < s.rooms) return problem(t.noLonger);

  const name = tr(room, "name", lang, room.name_th);
  const tm = (time: string) => t.time(time.slice(0, 5));
  const source = (n: (typeof plan.nightly)[number]) => (lang === "th" ? n.source : t.priceSource[n.kind]);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-cream-200 sm:p-8">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink"><ArrowLeft className="size-4" /> {t.change}</Link>
        <h1 className="mt-2 text-2xl font-bold">{t.title}</h1>
        <p className="mb-6 mt-1 text-sm text-ink/60">{t.sub}</p>
        <GuestForm
          lang={lang}
          holdHours={holdHours}
          hidden={{ room: room.id, plan: plan.ratePlanId, checkin: s.checkIn, checkout: s.checkOut, guests: String(s.guests), children: String(s.children), rooms: String(s.rooms) }}
        />
      </section>

      <aside className="h-fit overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-cream-200 lg:sticky lg:top-6">
        <div className="relative h-40 bg-ivory">
          {room.images[0] && <Image src={room.images[0].url} alt={name} fill sizes="380px" className="object-cover" />}
        </div>
        <div className="space-y-3 p-6 text-sm">
          <h2 className="text-lg font-bold">{name}</h2>
          <Row label={t.plan} value={tr(plan, "name", lang, plan.name)} />
          <Row label={t.checkIn} value={`${formatDate(s.checkIn, lang, { weekday: "short" })} · ${tm(property.check_in_time)}`} />
          <Row label={t.checkOut} value={`${formatDate(s.checkOut, lang, { weekday: "short" })} · ${tm(property.check_out_time)}`} />
          <Row label={t.amount} value={`${d.stay.nights(s.nights)} · ${d.stay.rooms(s.rooms)} · ${d.stay.adults(s.guests)}${s.children ? ` · ${d.stay.children(s.children)}` : ""}`} />
          <details className="rounded-lg bg-ivory px-3 py-2 text-xs">
            <summary className="cursor-pointer">{t.nightly}</summary>
            <ul className="mt-2 space-y-1">
              {plan.nightly.map((n) => (
                <li key={n.date} className="flex justify-between gap-2"><span>{formatDate(n.date, lang, { weekday: "short" })} <span className="text-ink/50">({source(n)})</span></span><span className="tabular-nums">{formatSatang(n.amount)}</span></li>
              ))}
            </ul>
          </details>
          {!plan.tax.inclusive && (
            <>
              <Row label={t.room} value={formatSatang(plan.tax.net)} />
              {plan.tax.serviceCharge > 0 && <Row label={t.service} value={formatSatang(plan.tax.serviceCharge)} />}
              <Row label="VAT" value={formatSatang(plan.tax.vat)} />
            </>
          )}
          <div className="flex items-end justify-between border-t border-cream-200 pt-3">
            <span className="font-semibold">{t.total}</span>
            <span className="text-2xl font-bold tabular-nums">{formatSatang(plan.total)}</span>
          </div>
          <p className="text-xs text-ink/60">
            {plan.tax.inclusive ? t.inclTax : t.inclTaxService}
            {property.damage_deposit_satang > 0 && ` · ${t.deposit(formatSatang(property.damage_deposit_satang))}`}
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
