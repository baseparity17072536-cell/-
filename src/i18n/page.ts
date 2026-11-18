import "server-only";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { lang as rootLang } from "next/root-params";
import { HTML_LANG, isLocale, LOCALES, localePath, type Locale } from "./config";

/**
 * The language of the current page under app/[lang] (a root param: known at build time, so reading it
 * does not make a page dynamic the way awaiting all of `params` would). Unknown values are a 404.
 */
export async function currentLang(): Promise<Locale> {
  const lang = await rootLang();
  if (!isLocale(lang)) notFound();
  return lang;
}

/** canonical + hreflang links so search engines show each guest the page in their language. */
export function alternates(lang: Locale, path: string): Metadata["alternates"] {
  return {
    canonical: localePath(lang, path),
    languages: Object.fromEntries([...LOCALES.map((l) => [HTML_LANG[l], localePath(l, path)]), ["x-default", path]]),
  };
}
