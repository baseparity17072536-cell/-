"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, BedDouble, ChevronLeft, ChevronRight, User } from "lucide-react";

export type Room = {
  name: string;
  image: string;
  guests: string;
  beds: string;
  price: string;
};

export default function RoomsCarousel({ rooms }: { rooms: Room[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function scroll(dir: number) {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.firstElementChild as HTMLElement).offsetWidth, behavior: "smooth" });
  }

  function onScroll() {
    const el = track.current;
    if (!el) return;
    const w = (el.firstElementChild as HTMLElement).offsetWidth;
    setActive(Math.round(el.scrollLeft / w));
  }

  const arrow =
    "absolute top-[38%] z-10 hidden size-10 place-items-center rounded-full bg-white text-ink shadow-md ring-1 ring-cream-200 transition hover:bg-cream md:grid";

  return (
    <div className="relative">
      <button aria-label="ก่อนหน้า" onClick={() => scroll(-1)} className={`${arrow} -left-5 lg:-left-12`}>
        <ChevronLeft className="size-5" />
      </button>

      <div
        ref={track}
        onScroll={onScroll}
        className="no-scrollbar -mx-2 flex snap-x snap-mandatory overflow-x-auto pb-4"
      >
        {rooms.map((r) => (
          <div key={r.name} className="w-[85%] shrink-0 snap-start px-2 sm:w-1/2 lg:w-1/3">
            <article className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-15px_rgba(12,63,77,0.35)] ring-1 ring-cream-200">
              <div className="relative h-52">
                <Image src={r.image} alt={r.name} fill sizes="(min-width:1024px) 33vw, 85vw" className="object-cover" />
                <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1 text-sm font-semibold">
                  {r.name}
                </span>
              </div>
              <div className="p-5">
                <div className="flex gap-5 text-sm text-ink/70">
                  <span className="flex items-center gap-1.5">
                    <User className="size-4" /> {r.guests}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <BedDouble className="size-4" /> {r.beds}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <p className="text-sm">
                    เริ่มต้น <span className="text-2xl font-bold">{r.price}</span> บาท / คืน
                  </p>
                  <Link
                    href="/booking"
                    className="bg-gold flex shrink-0 items-center gap-1 rounded-full px-4 py-2 text-xs font-semibold text-white shadow transition hover:brightness-110"
                  >
                    ดูรายละเอียด <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </div>
            </article>
          </div>
        ))}
      </div>

      <button aria-label="ถัดไป" onClick={() => scroll(1)} className={`${arrow} -right-5 lg:-right-12`}>
        <ChevronRight className="size-5" />
      </button>

      <div className="mt-2 flex justify-center gap-2">
        {rooms.map((r, i) => (
          <span
            key={r.name}
            className={`size-2 rounded-full transition ${i === active ? "bg-teal-deep" : "bg-gold-300"}`}
          />
        ))}
      </div>
    </div>
  );
}
