"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDict, isLocale, localePath } from "@/i18n";

export default function NotFound() {
  const p = useParams<{ lang: string }>();
  const lang = isLocale(p?.lang) ? p.lang : "th";
  const t = getDict(lang).error;
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-cream-200">
        <h1 className="text-xl font-bold text-ink">{t.notFound}</h1>
        <Link href={localePath(lang, "/")} className="bg-gold mt-6 inline-block rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow">
          {t.home}
        </Link>
      </div>
    </div>
  );
}
