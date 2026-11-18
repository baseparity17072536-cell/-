// Languages of the guest website. Thai is the default and keeps the unprefixed URLs (/, /booking …);
// other languages live under /en/…, /zh/…  To add a language: add it here, add a dictionary
// (src/i18n/dictionaries/<lang>.ts typed as Dict) and its translations in the admin.

export const LOCALES = ["th", "en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "th";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Native names, shown in the language switcher. */
export const LOCALE_NAME: Record<Locale, string> = { th: "ไทย", en: "English", zh: "中文" };

/** BCP-47 tags for <html lang>, hreflang and Intl formatting. */
export const HTML_LANG: Record<Locale, string> = { th: "th", en: "en", zh: "zh-Hans" };
const INTL_LOCALE: Record<Locale, string> = { th: "th-TH", en: "en-GB", zh: "zh-CN" };

/** Cookie that remembers the language a guest picked (read by src/proxy.ts on "/"). */
export const LANG_COOKIE = "ft_lang";

/** Path for a page in a language: Thai unprefixed, others prefixed. `path` starts with "/". */
export function localePath(lang: Locale, path: string) {
  if (lang === DEFAULT_LOCALE) return path;
  return path === "/" ? `/${lang}` : `/${lang}${path}`;
}

/** Split a public URL path into its language and the path without the language prefix. */
export function splitLocale(pathname: string): { lang: Locale; path: string } {
  const m = /^\/([a-z]{2})(?=\/|$)(.*)$/.exec(pathname);
  if (m && isLocale(m[1]) && m[1] !== DEFAULT_LOCALE) return { lang: m[1], path: m[2] || "/" };
  return { lang: DEFAULT_LOCALE, path: pathname || "/" };
}

/** Best supported language from an Accept-Language header (q-values respected), or null. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())?.[1]).find(Boolean);
      return { base: tag.split("-")[0], q: q === undefined ? 1 : Number(q), i };
    })
    .filter((x) => x.base && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.base).find(isLocale) ?? null;
}

// ---------------------------------------------------------------- formatting --
/** Date "YYYY-MM-DD" (a calendar day, no time zone) in the guest's language. Thai uses the Buddhist year. */
export function formatDate(date: string, lang: Locale, opts: Intl.DateTimeFormatOptions = {}) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(INTL_LOCALE[lang], {
    timeZone: "UTC", day: "numeric", month: "short", year: "numeric", ...opts,
  });
}

/** A moment in time shown in the hotel's time zone. */
export function formatDateTime(iso: string, lang: Locale, timeZone = "Asia/Bangkok") {
  return new Date(iso).toLocaleString(INTL_LOCALE[lang], {
    timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
