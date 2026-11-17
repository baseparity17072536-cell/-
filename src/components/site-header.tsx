import Link from "next/link";
import Logo from "./logo";

const links = [
  { href: "/", label: "หน้าแรก", desktopOnly: true },
  { href: "/booking", label: "จองห้องพัก" },
  { href: "/booking/lookup", label: "ตรวจสอบการจอง" },
];

export default function SiteHeader() {
  return (
    <header className="border-b-2 border-gold-400 bg-teal-deep text-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" aria-label="กลับหน้าแรก" className="shrink-0 origin-left scale-90 sm:scale-100">
          <Logo />
        </Link>
        <ul className="flex gap-3 whitespace-nowrap text-xs sm:gap-7 sm:text-sm">
          {links.map((l) => (
            <li key={l.href} className={l.desktopOnly ? "hidden sm:block" : ""}>
              <Link href={l.href} className="rounded-full px-2 py-1 transition hover:text-gold-300 sm:px-0">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
