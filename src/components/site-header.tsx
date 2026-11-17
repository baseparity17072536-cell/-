import Link from "next/link";
import Logo from "./logo";

const links = [
  { href: "/", label: "หน้าแรก" },
  { href: "/booking", label: "จองห้องพัก" },
  { href: "/booking/lookup", label: "ตรวจสอบการจอง" },
];

export default function SiteHeader() {
  return (
    <header className="border-b-2 border-gold-400 bg-teal-deep text-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" aria-label="กลับหน้าแรก">
          <Logo />
        </Link>
        <ul className="flex gap-4 text-sm sm:gap-7">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="transition hover:text-gold-300">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
