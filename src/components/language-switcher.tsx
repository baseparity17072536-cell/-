"use client";

import { usePathname } from "next/navigation";
import { Globe } from "lucide-react";
import { LOCALE_NAME, LOCALES, localePath, splitLocale, type Locale } from "@/i18n/config";

/** TH · EN · 中文 — keeps the guest on the same page (and search) in the other language. */
export default function LanguageSwitcher({ lang, label, tone = "light" }: { lang: Locale; label: string; tone?: "light" | "dark" }) {
  const { path } = splitLocale(usePathname() ?? "/");
  const off = tone === "light" ? "text-white/75 hover:text-white" : "text-ink/60 hover:text-ink";
  const on = tone === "light" ? "bg-white/15 text-white" : "bg-teal-deep text-white";
  return (
    <nav aria-label={label} className="flex items-center gap-1 text-xs">
      <Globe className={`size-3.5 ${tone === "light" ? "text-white/70" : "text-ink/50"}`} aria-hidden />
      {LOCALES.map((l) => (
        <a
          key={l}
          href={localePath(l, path)}
          hrefLang={l}
          lang={l}
          aria-current={l === lang ? "true" : undefined}
          onClick={(e) => {
            // keep the current search (dates, guests) when switching language
            e.currentTarget.href = localePath(l, path) + window.location.search;
          }}
          className={`rounded-full px-2 py-0.5 font-semibold transition ${l === lang ? on : off}`}
        >
          {l === "zh" ? LOCALE_NAME.zh : l.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
