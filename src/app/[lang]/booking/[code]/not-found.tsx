"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDict, isLocale, localePath } from "@/i18n";

export default function BookingNotFound() {
  const p = useParams<{ lang: string }>();
  const lang = isLocale(p?.lang) ? p.lang : "th";
  const t = getDict(lang).booking;
  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-cream-200">
      <h1 className="text-xl font-bold">{t.notFound}</h1>
      <p className="mt-2 text-sm text-ink/60">{t.notFoundText}</p>
      <Link href={localePath(lang, "/booking/lookup")} className="mt-4 inline-block font-semibold text-gold-600 underline">
        {t.search}
      </Link>
    </div>
  );
}
