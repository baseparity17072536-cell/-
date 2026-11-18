import { NextResponse, type NextRequest } from "next/server";
import { routeLocale } from "@/i18n/routing";

// Language routing for the guest website (see src/i18n/routing.ts): Thai at the unprefixed URLs,
// English and Chinese under /en and /zh. The admin, uploaded media, Next internals and files with
// an extension are not touched.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const d = routeLocale(pathname, { search });
  if (d.type === "next") return NextResponse.next();
  const url = new URL(d.to, request.url);
  if (d.type === "redirect") return NextResponse.redirect(url, d.status);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!admin|media|_next|api|.*\\..*).*)"],
};
