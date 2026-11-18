import type { Metadata } from "next";
import "../globals.css";
import { fontVars } from "../fonts";
import { getDict, HTML_LANG, LOCALES } from "@/i18n";
import { alternates, currentLang } from "@/i18n/page";

// Root layout of the guest website, one per language (Thai is served at the unprefixed URLs, see src/proxy.ts).
// Unknown languages are a 404 (currentLang).
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = await currentLang();
  const t = getDict(lang).meta;
  return { title: t.title, description: t.description, alternates: alternates(lang, "/") };
}

export default async function SiteRootLayout({ children }: LayoutProps<"/[lang]">) {
  const lang = await currentLang();
  return (
    <html lang={HTML_LANG[lang]} className={`${fontVars} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
