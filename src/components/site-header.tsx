import Link from "next/link";
import { Suspense } from "react";
import { getDict, localePath, type Locale } from "@/i18n";
import LanguageSwitcher from "./language-switcher";
import Logo from "./logo";

export default function SiteHeader({ lang }: { lang: Locale }) {
  const d = getDict(lang);
  const links = [
    { href: localePath(lang, "/"), label: d.nav.home, desktopOnly: true },
    { href: localePath(lang, "/booking"), label: d.nav.book },
    { href: localePath(lang, "/booking/lookup"), label: d.nav.lookup },
  ];
  return (
    <header className="border-b-2 border-gold-400 bg-teal-deep text-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href={localePath(lang, "/")} aria-label={d.nav.backHome} className="shrink-0 origin-left scale-90 sm:scale-100">
          <Logo />
        </Link>
        <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-6">
          <ul className="flex gap-3 whitespace-nowrap text-xs sm:gap-7 sm:text-sm">
            {links.map((l) => (
              <li key={l.href} className={l.desktopOnly ? "hidden sm:block" : ""}>
                <Link href={l.href} className="rounded-full px-2 py-1 transition hover:text-gold-300 sm:px-0">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <Suspense>
            <LanguageSwitcher lang={lang} label={d.lang.label} />
          </Suspense>
        </div>
      </nav>
    </header>
  );
}
