import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2, Clock, Phone, XCircle } from "lucide-react";
import Steps from "@/components/steps";
import Skeleton from "@/components/skeleton";
import { CancelForm, PrintButton } from "@/components/booking-forms";
import { formatDate, formatDateTime, getDict, localePath, tr, type Locale } from "@/i18n";
import { currentLang } from "@/i18n/page";
import { hasBookingAccess } from "@/lib/booking-access";
import { formatSatang } from "@/lib/money";
import { getBooking } from "@/server/booking";
import type { BookingStatus } from "@/server/booking-status";
import { listRatePlans } from "@/server/catalog";
import { getStaff } from "@/server/context";
import { getPublicRoomTypes, getSite } from "@/server/site";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await currentLang();
  return { title: getDict(lang).meta.status, robots: { index: false, follow: false } };
}

export default async function BookingStatusPage({ params, searchParams }: PageProps<"/[lang]/booking/[code]">) {
  const lang = await currentLang();
  return (
    <div className="space-y-8">
      <div className="print:hidden"><Steps current={3} lang={lang} /></div>
      <Suspense fallback={<Skeleton rows={2} />}>
        <BookingView lang={lang} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BookingView({ lang, params, searchParams }: { lang: Locale } & PageProps<"/[lang]/booking/[code]">) {
  const d = getDict(lang);
  const t = d.booking;
  const { code } = await params;
  const { new: isNew, cancelled } = await searchParams;
  const { tenant, property } = await getSite();
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) notFound();
  const b = await getBooking(tenant.id, code);
  if (!b) notFound();

  // ข้อมูลส่วนบุคคลแสดงเฉพาะผู้ที่ยืนยันเบอร์โทรแล้ว หรือเจ้าหน้าที่ที่ล็อกอิน
  const canSeePersonal = (await hasBookingAccess(b.code)) || !!(await getStaff());
  const tel = (property.phone ?? "").replace(/[^\d+]/g, "");
  const tm = (time: string) => time.slice(0, 5);
  const status = d.status[b.status];

  // room / rate names are stored in Thai on the booking; show the current translation when there is one
  const [types, plans] = lang === "th" ? [[], []] : await Promise.all([getPublicRoomTypes(), listRatePlans(tenant.id, b.property_id)]);
  const roomName = (r: (typeof b.rooms)[number]) => {
    const rt = types.find((x) => x.id === r.room_type_id);
    return rt ? tr(rt, "name", lang, r.room_type_name) : r.room_type_name;
  };
  const planName = (r: (typeof b.rooms)[number]) => {
    const p = plans.find((x) => x.id === r.rate_plan_id);
    return p ? tr(p, "name", lang, r.rate_plan_name) : r.rate_plan_name;
  };
  const groups = new Map<string, number>();
  for (const r of b.rooms) groups.set(`${roomName(r)} (${planName(r)})`, (groups.get(`${roomName(r)} (${planName(r)})`) ?? 0) + 1);
  const roomsText = [...groups].map(([k, n]) => `${k} ${d.stay.roomsTimes(n)}`).join(", ");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {cancelled === "1" && b.status === "cancelled" && (
        <div role="status" className="rounded-2xl bg-emerald-50 p-5 text-emerald-800 ring-1 ring-emerald-200">{t.cancelledOk}</div>
      )}
      {isNew === "1" && b.status === "pending_payment" && (
        <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-800 ring-1 ring-emerald-200">
          <p className="text-lg font-bold">{t.newTitle}</p>
          <p className="text-sm">{t.newText(b.code)}</p>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-cream-200">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-teal-deep px-6 py-5 text-white">
          <div>
            <p className="text-xs text-white/70">{t.code}</p>
            <p className="font-display text-2xl font-semibold tracking-widest text-gold-300">{b.code}</p>
          </div>
          <StatusBadge status={b.status} label={status} />
        </div>

        <dl className="grid gap-x-8 gap-y-4 p-6 text-sm sm:grid-cols-2">
          {canSeePersonal ? (
            <>
              <Item label={t.guest} value={b.guest_name} />
              <Item label={t.phone} value={b.guest_phone} />
            </>
          ) : (
            <div className="rounded-lg bg-cream px-4 py-3 sm:col-span-2 print:hidden">
              {t.hiddenPre}{" "}
              <Link href={localePath(lang, "/booking/lookup")} className="font-semibold text-gold-600 underline">{t.hiddenLink}</Link> {t.hiddenPost}
            </div>
          )}
          <Item label={t.rooms} value={roomsText} />
          <Item label={t.guests} value={`${d.stay.adults(b.adults)}${b.children ? ` · ${d.stay.children(b.children)}` : ""}`} />
          <Item label={t.checkIn} value={t.after(formatDate(b.check_in, lang, { weekday: "long" }), tm(property.check_in_time))} />
          <Item label={t.checkOut} value={t.before(formatDate(b.check_out, lang, { weekday: "long" }), tm(property.check_out_time))} />
          <Item label={t.nights} value={d.stay.nights(b.nights)} />
          <Item label={t.created} value={formatDateTime(b.created_at.toISOString(), lang, property.timezone)} />
          {canSeePersonal && b.special_request && <Item label={t.request} value={b.special_request} wide />}
        </dl>

        <div className="space-y-1 border-t border-cream-200 px-6 py-4 text-sm">
          {!b.tax_inclusive && (
            <>
              <Line k={t.room} v={formatSatang(b.subtotal_satang - b.discount_satang)} />
              {b.service_charge_satang > 0 && <Line k={t.service} v={formatSatang(b.service_charge_satang)} />}
              <Line k="VAT" v={formatSatang(b.vat_satang)} />
            </>
          )}
          <div className="flex items-end justify-between pt-1">
            <span className="text-ink/60">{b.tax_inclusive ? t.totalInclTax : t.total}</span>
            <span className="text-2xl font-bold tabular-nums">{formatSatang(b.total_satang)}</span>
          </div>
        </div>
      </section>

      {b.status === "pending_payment" && b.hold_expires_at && (
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gold-300">
          <h2 className="text-lg font-bold">{t.payTitle}</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink/80">
            <li>
              {t.payStep1(formatSatang(b.total_satang))}
              {property.phone && <> {t.byPhone} <a href={`tel:${tel}`} className="font-semibold text-gold-600 underline">{property.phone}</a></>}
              {property.facebook_url && <> {t.or} <a href={property.facebook_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-600 underline">Facebook</a></>}
            </li>
            <li>{t.payStep2(b.code)}</li>
            <li>{t.payStep3}</li>
          </ol>
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-orange-50 px-4 py-2 text-sm text-orange-800">
            <Clock className="size-4 shrink-0" /> {t.payBy(formatDateTime(b.hold_expires_at.toISOString(), lang, property.timezone))}
          </p>
        </section>
      )}

      {b.status === "payment_review" && (
        <section className="rounded-2xl bg-amber-50 p-6 text-sm text-amber-900 ring-1 ring-amber-200">{t.reviewing}</section>
      )}

      {(b.status === "confirmed" || b.status === "checked_in") && (
        <section className="rounded-2xl bg-emerald-50 p-6 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <p className="font-bold">{t.confirmedTitle}</p>
          <p className="mt-1">
            {t.confirmedText}
            {property.damage_deposit_satang > 0 && ` · ${t.depositNote(formatSatang(property.damage_deposit_satang))}`}
          </p>
        </section>
      )}

      {(b.status === "cancelled" || b.status === "expired" || b.status === "no_show") && (
        <section className="rounded-2xl bg-white p-6 text-sm ring-1 ring-cream-200">
          <p>
            {b.status === "expired" ? t.expired : t.ended(status)} ·{" "}
            <Link href={localePath(lang, "/booking")} className="font-semibold text-gold-600 underline">{t.bookAgain}</Link>
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div className="flex flex-wrap gap-3">
          <PrintButton lang={lang} />
          {property.phone && (
            <a href={`tel:${tel}`} className="inline-flex items-center gap-2 rounded-full border border-ink/20 px-5 py-2 text-sm font-semibold transition hover:bg-white">
              <Phone className="size-4" /> {t.call(property.phone)}
            </a>
          )}
        </div>
        {b.status === "pending_payment" && (
          <div className="w-full sm:w-80"><CancelForm code={b.code} lang={lang} /></div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: BookingStatus; label: string }) {
  const base = "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold";
  if (status === "confirmed" || status === "checked_in" || status === "checked_out")
    return <span className={`${base} bg-emerald-500 text-white`}><CheckCircle2 className="size-4" /> {label}</span>;
  if (status === "cancelled" || status === "expired" || status === "no_show")
    return <span className={`${base} bg-white/15 text-white`}><XCircle className="size-4" /> {label}</span>;
  return <span className={`${base} bg-gold text-white`}><Clock className="size-4" /> {label}</span>;
}

function Item({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-ink/60">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-ink/60">{k}</span><span className="tabular-nums">{v}</span></div>;
}
