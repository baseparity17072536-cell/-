import { DEFAULT_LOCALE, fromAcceptLanguage, isLocale, splitLocale } from "./config";

export type RouteDecision =
  | { type: "redirect"; to: string; status: 307 | 308 }
  | { type: "rewrite"; to: string }
  | { type: "next" };

/**
 * How a public URL maps to the app/[lang] routes (pure; used by src/proxy.ts and unit tested).
 * - /en/…, /zh/…           → served as is
 * - /th/…                  → permanent redirect to the unprefixed URL (one URL per page)
 * - anything else          → Thai, rewritten internally to /th/…
 * - "/" only               → a guest who picked a language before (cookie), or whose browser does not
 *                            list Thai at all, is sent to that language's home page
 */
export function routeLocale(
  pathname: string,
  opts: { cookie?: string | null; acceptLanguage?: string | null; search?: string } = {},
): RouteDecision {
  const search = opts.search ?? "";
  if (pathname === `/${DEFAULT_LOCALE}` || pathname.startsWith(`/${DEFAULT_LOCALE}/`))
    return { type: "redirect", to: (pathname.slice(DEFAULT_LOCALE.length + 1) || "/") + search, status: 308 };

  const { lang } = splitLocale(pathname);
  if (lang !== DEFAULT_LOCALE) return { type: "next" };

  if (pathname === "/") {
    const chosen = isLocale(opts.cookie) ? opts.cookie : null;
    const browser = /(^|[,\s])th(-|;|,|$)/i.test(opts.acceptLanguage ?? "") ? null : fromAcceptLanguage(opts.acceptLanguage);
    const want = chosen ?? browser;
    if (want && want !== DEFAULT_LOCALE) return { type: "redirect", to: `/${want}${search}`, status: 307 };
  }
  return { type: "rewrite", to: `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}${search}` };
}
