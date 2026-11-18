import type { Metadata } from "next";
import { LookupForm } from "@/components/booking-forms";
import { getDict } from "@/i18n";
import { alternates, currentLang } from "@/i18n/page";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await currentLang();
  const t = getDict(lang).meta;
  return { title: `${t.lookup} | ${t.title}`, alternates: alternates(lang, "/booking/lookup") };
}

export default async function LookupPage() {
  const lang = await currentLang();
  const t = getDict(lang).lookup;
  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-cream-200">
      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="mb-6 mt-1 text-sm text-ink/60">{t.sub}</p>
      <LookupForm lang={lang} />
    </div>
  );
}
