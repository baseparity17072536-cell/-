import { Suspense } from "react";
import SiteHeader from "@/components/site-header";
import { getDict, tr, type Locale } from "@/i18n";
import { currentLang } from "@/i18n/page";
import { getSite } from "@/server/site";

export default async function BookingLayout({ children }: LayoutProps<"/[lang]/booking">) {
  const lang = await currentLang();
  return (
    <div className="flex flex-1 flex-col">
      <div className="print:hidden">
        <SiteHeader lang={lang} />
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="bg-teal-deep py-6 text-center text-xs text-white/70 print:hidden">
        <Suspense>
          <FooterText lang={lang} />
        </Suspense>
      </footer>
    </div>
  );
}

async function FooterText({ lang }: { lang: Locale }) {
  const { property } = await getSite();
  const name = tr(property, "name", lang, property.name_th);
  return (
    <>
      {name}
      {property.phone && ` · ${getDict(lang).home.phone} ${property.phone}`} · © {new Date().getFullYear()} {property.name_en ?? property.name_th}
    </>
  );
}
