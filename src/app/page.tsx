import Image from "next/image";
import {
  ArrowRight,
  BedDouble,
  Car,
  ConciergeBell,
  Flower2,
  MapPin,
  Phone,
  Play,
  TreePalm,
  Utensils,
  WavesLadder,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import Logo from "@/components/logo";
import StaySearchForm from "@/components/stay-search-form";
import { RESORT, ROOM_TYPES } from "@/lib/rooms";
import { formatBaht } from "@/lib/dates";
import RoomsCarousel, { type Room } from "./rooms-carousel";

const PHONE = RESORT.phone;
const FACEBOOK_URL = RESORT.facebook;
const MAP_URL = "https://www.google.com/maps/search/?api=1&query=Fah+Talay+Resort+Ban+Phe+Rayong";

const nav = [
  { href: "#", label: "หน้าแรก" },
  { href: "#rooms", label: "ห้องพัก" },
  { href: "#promotions", label: "โปรโมชั่น" },
  { href: "#facilities", label: "สิ่งอำนวยความสะดวก" },
  { href: "#gallery", label: "แกลเลอรี" },
  { href: "#about", label: "เกี่ยวกับเรา" },
  { href: "#contact", label: "ติดต่อเรา" },
];

const highlights = [
  { Icon: BedDouble, title: "ห้องพักหลากหลาย", text: "ตอบโจทย์ทุกการพักผ่อน" },
  { Icon: WavesLadder, title: "สระว่ายน้ำ", text: "บรรยากาศร่มรื่น" },
  { Icon: TreePalm, title: "ติดทะเล", text: "ใกล้หาดแม่รำพึง" },
  { Icon: ConciergeBell, title: "ร้านอาหาร", text: "พร้อมเมนูหลากหลาย" },
  { Icon: Wifi, title: "Wi-Fi ฟรี", text: "ทั่วบริเวณรีสอร์ท" },
  { Icon: Car, title: "ที่จอดรถ", text: "สะดวก ปลอดภัย" },
];

const rooms: Room[] = ROOM_TYPES.map((r) => ({
  name: r.name,
  image: r.image,
  guests: `${r.capacity} คน`,
  beds: r.beds,
  price: formatBaht(r.price),
}));

const promos = [
  { image: "/images/promo-1.jpg", title: "Early Bird", sub: "จองล่วงหน้า", value: "15%" },
  { image: "/images/promo-2.jpg", title: "Stay & Dine", sub: "แพ็กเกจห้องพัก + อาหารเช้า", value: "สุดคุ้ม" },
  { image: "/images/promo-3.jpg", title: "Family Getaway", sub: "พักผ่อนทั้งครอบครัว", value: "รับสิทธิ์พิเศษ" },
];

const facilities = [
  { image: "/images/fac-pool.jpg", Icon: WavesLadder, label: "สระว่ายน้ำ" },
  { image: "/images/fac-food.jpg", Icon: Utensils, label: "ร้านอาหาร" },
  { image: "/images/fac-beach.jpg", Icon: TreePalm, label: "ชายหาดใกล้รีสอร์ท" },
  { image: "/images/fac-garden.jpg", Icon: Flower2, label: "สวนพักผ่อน" },
];

const gallery = ["/images/gal-1.jpg", "/images/gal-2.jpg", "/images/gal-3.jpg", "/images/gal-4.jpg"];

function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className={`font-display text-xs font-semibold tracking-[0.25em] ${light ? "text-gold-300" : "text-gold-600"}`}>
      {children}
    </p>
  );
}

function OutlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex items-center gap-2 rounded-full border border-gold-500 px-5 py-2 text-sm font-semibold text-ink transition hover:bg-gold-500 hover:text-white"
    >
      {children} <ArrowRight className="size-4" />
    </a>
  );
}

const social = {
  facebook:
    "M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z",
  line: "M12 3C6.48 3 2 6.62 2 11.08c0 4 3.55 7.35 8.35 7.98.33.07.77.22.88.5.1.25.07.65.03.9l-.14.85c-.04.25-.2.98.86.53 1.06-.45 5.73-3.37 7.81-5.77C21.3 14.47 22 12.86 22 11.08 22 6.62 17.52 3 12 3Zm-3.6 10.2H6.4a.5.5 0 0 1-.5-.5V8.9a.5.5 0 0 1 1 0v3.3h1.5a.5.5 0 0 1 0 1Zm2.1-.5a.5.5 0 0 1-1 0V8.9a.5.5 0 0 1 1 0v3.8Zm4.8 0a.5.5 0 0 1-.9.3l-2.05-2.8v2.5a.5.5 0 0 1-1 0V8.9a.5.5 0 0 1 .9-.3l2.05 2.8V8.9a.5.5 0 0 1 1 0v3.8Zm3.3-2.4a.5.5 0 0 1 0 1h-1.5v.9h1.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5V8.9a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-1.5v.9h1.5Z",
  instagram:
    "M12 2.2c3.2 0 3.58 0 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s0-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16Zm0 4.86a4.94 4.94 0 1 0 0 9.88 4.94 4.94 0 0 0 0-9.88Zm0 8.15a3.21 3.21 0 1 1 0-6.42 3.21 3.21 0 0 1 0 6.42Zm5.14-9.5a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z",
  youtube:
    "M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 4 12 4 12 4s-7.5 0-9.4.4A3 3 0 0 0 .5 6.5 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.5 3 3 0 0 0 2.1 2.1c1.9.4 9.4.4 9.4.4s7.5 0 9.4-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.5ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z",
};

const SOCIAL_LINKS: { key: keyof typeof social; href: string }[] = [{ key: "facebook", href: FACEBOOK_URL }];

export default function Home() {
  return (
    <div className="flex-1 overflow-x-clip">
      {/* ===== Hero ===== */}
      <section className="relative min-h-[640px] lg:min-h-[700px]">
        <Image src="/images/hero.jpg" alt="ฟ้าทะเลรีสอร์ท สระว่ายน้ำและวิลล่า" fill preload sizes="100vw" className="object-cover object-[70%_center]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1b2f4f] via-[#2c3f63]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c2238]/60 via-transparent to-transparent" />

        <header className="relative z-20">
          <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-5 text-white sm:px-6">
            <a href="#" aria-label="ฟ้าทะเลรีสอร์ท">
              <Logo />
            </a>
            <ul className="hidden gap-7 text-sm xl:flex">
              {nav.map((n, i) => (
                <li key={n.label}>
                  <a
                    href={n.href}
                    className={`pb-1.5 transition hover:text-gold-300 ${i === 0 ? "border-b-2 border-gold-400 font-semibold" : ""}`}
                  >
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
            <Link
              href="/booking/lookup"
              className="rounded-full border border-white/60 px-4 py-1.5 text-xs font-semibold transition hover:bg-white/10"
            >
              ตรวจสอบการจอง
            </Link>
          </nav>
        </header>

        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-44 pt-8 sm:px-6 lg:pt-12">
          <div className="max-w-md text-center text-white">
            <p className="font-script text-4xl text-gold-300 sm:text-5xl">Escape to the Sea</p>
            <h1 className="mt-1">
              <span className="text-gold block font-display text-6xl font-semibold tracking-[0.06em] sm:text-7xl">
                FAHTALAY
              </span>
              <span className="text-gold block font-display text-2xl tracking-[0.6em] sm:text-3xl">RESORT</span>
              <span className="mt-2 block text-3xl font-semibold">ฟ้าทะเลรีสอร์ท</span>
            </h1>
            <p className="mt-6 text-lg">พักผ่อน...อย่างมีระดับ ใกล้ทะเล</p>
            <a
              href="#gallery"
              className="mt-5 inline-flex items-center gap-3 rounded-full border border-white/70 py-1.5 pl-1.5 pr-5 text-sm transition hover:bg-white/10"
            >
              <span className="grid size-8 place-items-center rounded-full bg-white text-ink">
                <Play className="size-4 fill-current" />
              </span>
              ชมบรรยากาศรีสอร์ท
            </a>
          </div>
        </div>
      </section>

      {/* ===== Booking bar ===== */}
      <section id="booking" className="relative z-20 mx-auto -mt-28 max-w-6xl scroll-mt-6 px-4 sm:px-6">
        <StaySearchForm />
        <p className="mt-2 text-right text-sm text-ink/60">
          จองไว้แล้ว?{" "}
          <Link href="/booking/lookup" className="font-semibold text-gold-600 underline">
            ตรวจสอบการจอง
          </Link>
        </p>
      </section>

      {/* ===== Highlights ===== */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <ul className="grid grid-cols-2 gap-y-8 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-gold-300/60">
          {highlights.map(({ Icon, title, text }) => (
            <li key={title} className="flex flex-col items-center px-2 text-center">
              <Icon className="size-9 text-gold-500" strokeWidth={1.5} />
              <p className="mt-3 font-semibold">{title}</p>
              <p className="text-sm text-ink/70">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ===== Rooms ===== */}
      <section id="rooms" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>OUR ROOMS</Eyebrow>
            <h2 className="mt-1 text-3xl font-bold sm:text-4xl">ห้องพักของเรา</h2>
            <p className="mt-1 text-ink/70">เลือกห้องพักที่ใช่ สำหรับการพักผ่อนของคุณ</p>
          </div>
          <OutlineLink href="/booking">ดูห้องว่างและราคา</OutlineLink>
        </div>
        <RoomsCarousel rooms={rooms} />
      </section>

      {/* ===== Promotions ===== */}
      <section id="promotions" className="relative mt-8 scroll-mt-6 bg-gradient-to-r from-teal-deep via-teal-mid to-teal-deep">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_2.2fr] lg:items-center">
          <div className="text-white">
            <Eyebrow light>SPECIAL OFFER</Eyebrow>
            <h2 className="mt-1 text-3xl font-bold sm:text-4xl">โปรโมชั่นพิเศษ</h2>
            <p className="mt-2 text-white/80">จองตรงกับรีสอร์ท รับสิทธิ์พิเศษมากมาย</p>
            <p className="mt-2 text-xs text-white/70">
              * ส่วนลดยังไม่ถูกคำนวณในระบบจองออนไลน์ กรุณาสอบถามเงื่อนไขที่ {PHONE} ก่อนชำระเงิน
            </p>
            <a
              href={`tel:${PHONE.replaceAll("-", "")}`}
              className="bg-gold mt-6 inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-ink shadow transition hover:brightness-110"
            >
              สอบถามโปรโมชั่น <Phone className="size-4" />
            </a>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {promos.map((p) => (
              <article key={p.title} className="overflow-hidden rounded-xl bg-white text-center shadow-lg">
                <div className="relative h-28">
                  <Image src={p.image} alt={p.title} fill sizes="(min-width:640px) 25vw, 100vw" className="object-cover" />
                </div>
                <div className="px-3 py-4">
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <p className="text-xs text-ink/70">{p.sub}</p>
                  <p className="mt-1 text-2xl font-bold">{p.value}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Facilities ===== */}
      <section id="facilities" className="mx-auto grid max-w-6xl scroll-mt-6 gap-6 px-4 pt-14 sm:px-6 lg:grid-cols-[1fr_4fr]">
        <div>
          <Eyebrow>FACILITIES</Eyebrow>
          <h2 className="mt-1 text-2xl font-bold">สิ่งอำนวยความสะดวก</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {facilities.map(({ image, Icon, label }) => (
            <figure key={label} className="overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-cream-200">
              <div className="relative h-32">
                <Image src={image} alt={label} fill sizes="(min-width:768px) 20vw, 50vw" className="object-cover" />
                <span className="absolute -bottom-4 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full bg-white text-gold-500 shadow">
                  <Icon className="size-5" />
                </span>
              </div>
              <figcaption className="pb-3 pt-6 text-center text-sm font-semibold">{label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ===== Gallery ===== */}
      <section id="gallery" className="mx-auto grid max-w-6xl scroll-mt-6 gap-6 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_4fr]">
        <div>
          <Eyebrow>GALLERY</Eyebrow>
          <h2 className="mt-1 text-2xl font-bold">แกลเลอรี</h2>
          <p className="mt-2 text-sm text-ink/70">บรรยากาศรีสอร์ทที่จะทำให้คุณอยากมาสัมผัสด้วยตัวเอง</p>
          <div className="mt-4">
            <OutlineLink href={FACEBOOK_URL}>ดูภาพทั้งหมด</OutlineLink>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {gallery.map((src, i) => (
            <div key={src} className="relative h-40 overflow-hidden rounded-xl shadow-md">
              <Image
                src={src}
                alt={`บรรยากาศฟ้าทะเลรีสอร์ท ${i + 1}`}
                fill
                sizes="(min-width:768px) 20vw, 50vw"
                className="object-cover transition duration-500 hover:scale-105"
              />
            </div>
          ))}
        </div>
      </section>

      {/* ===== About ===== */}
      <section id="about" className="relative scroll-mt-6">
        <div className="grid items-center lg:grid-cols-2">
          <div className="relative h-64 sm:h-80 lg:[clip-path:ellipse(100%_100%_at_0%_50%)]">
            <Image src="/images/about.jpg" alt="ป้ายฟ้าทะเลรีสอร์ท" fill sizes="(min-width:1024px) 50vw, 100vw" className="object-cover" />
          </div>
          <div className="px-4 py-12 sm:px-10 lg:max-w-xl">
            <Eyebrow>ABOUT US</Eyebrow>
            <h2 className="mt-1 text-2xl font-bold sm:text-3xl">เกี่ยวกับ ฟ้าทะเลรีสอร์ท</h2>
            <p className="mt-3 leading-7 text-ink/75">
              รีสอร์ทริมทะเลแม่รำพึง จังหวัดระยอง ที่พร้อมมอบประสบการณ์การพักผ่อนอย่างมีระดับ
              ด้วยบรรยากาศธรรมชาติริมทะเล ห้องพักสะอาดสบาย และการบริการที่อบอุ่นเป็นกันเอง
              ใกล้อุทยานแห่งชาติเขาแหลมหญ้า–หมู่เกาะเสม็ด และท่าเรือบ้านเพ
            </p>
            <div className="mt-5">
              <OutlineLink href={MAP_URL}>ดูแผนที่</OutlineLink>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer id="contact" className="border-t-2 border-gold-400 bg-teal-deep text-white/85">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-[1fr_1.6fr_1fr_1fr_1fr] lg:divide-x lg:divide-white/15">
          <div className="flex flex-col items-center">
            <Logo className="scale-110" />
            <p className="mt-3 font-script text-3xl text-gold-300">Escape to the Sea</p>
          </div>

          <div className="space-y-3 text-sm lg:pl-8">
            <p className="font-semibold text-white">ติดต่อเรา</p>
            <a href={`tel:${PHONE.replaceAll("-", "")}`} className="flex items-center gap-3 hover:text-gold-300">
              <Phone className="size-4 shrink-0" /> {PHONE}
            </a>
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:text-gold-300">
              <svg viewBox="0 0 24 24" className="size-4 shrink-0 fill-current" aria-hidden>
                <path d={social.facebook} />
              </svg>
              FahTalay Resort ฟ้าทะเลรีสอร์ท
            </a>
            <a href={MAP_URL} target="_blank" rel="noopener noreferrer" className="flex gap-3 hover:text-gold-300">
              <MapPin className="mt-0.5 size-4 shrink-0" />
              78/12 หมู่ 1 ถนนเลียบหาดแม่รำพึง ต.บ้านเพ อ.เมืองระยอง จ.ระยอง 21160
            </a>
          </div>

          <div className="text-sm lg:pl-8">
            <p className="font-semibold text-white">เมนูหลัก</p>
            <ul className="mt-3 space-y-1.5">
              {nav.slice(0, 6).map((n) => (
                <li key={n.label}>
                  <a href={n.href} className="hover:text-gold-300">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-sm lg:pl-8">
            <p className="font-semibold text-white">บริการลูกค้า</p>
            <ul className="mt-3 space-y-1.5">
              {[
                { href: "/booking", label: "จองห้องพัก" },
                { href: "/booking/lookup", label: "ตรวจสอบ / ยกเลิกการจอง" },
                { href: "/booking/policy", label: "เงื่อนไขการจองและการเข้าพัก" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-gold-300">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="text-sm lg:pl-8">
            <p className="font-semibold text-white">ติดตามเรา</p>
            <div className="mt-3 flex gap-3">
              {/* แสดงเฉพาะช่องทางที่มีลิงก์จริง — เพิ่ม URL ของ LINE / Instagram / YouTube ใน SOCIAL_LINKS เมื่อได้รับจากรีสอร์ท */}
              {SOCIAL_LINKS.map(({ key: k, href }) => (
                <a
                  key={k}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={k}
                  className="grid size-9 place-items-center rounded-full bg-white text-teal-deep transition hover:bg-gold-300"
                >
                  <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden>
                    <path d={social[k]} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>
        <p className="border-t border-white/10 py-5 text-center text-xs text-white/60">
          © 2026 FahTalay Resort. All Rights Reserved.
        </p>
      </footer>
    </div>
  );
}
