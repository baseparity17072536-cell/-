import { DEFAULT_LOCALE, splitLocale } from "./config";

export type RouteDecision =
  | { type: "redirect"; to: string; status: 307 | 308 }
  | { type: "rewrite"; to: string }
  | { type: "next" };

/**
 * How a public URL maps to the app/[lang] routes (pure; used by src/proxy.ts and unit tested).
 * Thai is the primary language: a URL without a language prefix is always Thai, whatever the
 * browser's language — guests switch with the TH · EN · 中文 links.
 * - /en/…, /zh/…           → served as is
 * - /th/…                  → permanent redirect to the unprefixed URL (one URL per page)
 * - anything else          → Thai, rewritten internally to /th/…
 */
export function routeLocale(pathname: string, opts: { search?: string } = {}): RouteDecision {
  const search = opts.search ?? "";
  if (pathname === `/${DEFAULT_LOCALE}` || pathname.startsWith(`/${DEFAULT_LOCALE}/`))
    return { type: "redirect", to: (pathname.slice(DEFAULT_LOCALE.length + 1) || "/") + search, status: 308 };

  const { lang } = splitLocale(pathname);
  if (lang !== DEFAULT_LOCALE) return { type: "next" };
  return { type: "rewrite", to: `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}${search}` };
}
