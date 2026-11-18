import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Skeleton from "@/components/skeleton";
import { getDict, localePath, tr, type Locale } from "@/i18n";
import { alternates, currentLang } from "@/i18n/page";
import { formatSatang } from "@/lib/money";
import { getSite } from "@/server/site";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await currentLang();
  return { title: getDict(lang).meta.policy, alternates: alternates(lang, "/booking/policy") };
}

export default async function PolicyPage() {
  const lang = await currentLang();
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <Policy lang={lang} />
    </Suspense>
  );
}

// ทุกข้ออ้างอิงค่าที่ระบบใช้งานจริงจากการตั้งค่าที่พัก (หลังบ้าน → ตั้งค่าที่พัก)
async function Policy({ lang }: { lang: Locale }) {
  const t = getDict(lang).policy;
  const { property: p, holdHours } = await getSite();
  const tm = (time: string) => time.slice(0, 5);
  const rules: { title: string; items: string[] }[] = [
    {
      title: t.payment,
      items: [
        t.hold(holdHours),
        t.expire,
        t.complete,
        t.limits(p.max_nights, p.booking_window_days),
        p.prices_include_tax ? t.taxIncluded : t.taxExcluded(p.service_charge_bp / 100, p.vat_bp / 100),
      ],
    },
    {
      title: t.stay,
      items: [
        t.times(tm(p.check_in_time), tm(p.check_out_time)),
        t.showCode,
        t.child(p.child_max_age),
        ...(p.damage_deposit_satang > 0 ? [t.deposit(formatSatang(p.damage_deposit_satang))] : []),
      ],
    },
    { title: t.cancel, items: [t.cancelUnpaid, t.cancelPaid(p.phone)] },
    { title: t.privacy, items: [t.privacyUse, t.privacyView] },
  ];

  return (
    <article className="mx-auto max-w-3xl space-y-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-cream-200 sm:p-10">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">{t.title}</h1>
        <p className="mt-1 text-sm text-ink/60">{tr(p, "name", lang, p.name_th)}</p>
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
        <Link href={localePath(lang, "/booking")} className="bg-gold rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow">{t.book}</Link>
        <Link href={localePath(lang, "/booking/lookup")} className="rounded-full border border-ink/20 px-6 py-2.5 text-sm font-semibold">{t.lookup}</Link>
      </div>
    </article>
  );
}
