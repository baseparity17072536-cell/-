"use client";

import Form from "next/form";
import { useState } from "react";
import { BedDouble, CalendarDays, ChevronDown, Search, User } from "lucide-react";

type Props = {
  defaults?: { checkIn?: string; checkOut?: string; guests?: number; rooms?: number };
  title?: string;
};

function plusOneDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** ฟอร์มค้นหาห้องว่าง ส่งแบบ GET ไปที่ /booking */
export default function StaySearchForm({ defaults = {}, title = "จองห้องพัก" }: Props) {
  const [checkIn, setCheckIn] = useState(defaults.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(defaults.checkOut ?? "");

  const cell = "flex items-center gap-3 rounded-xl bg-cream px-4 py-2.5 ring-1 ring-cream-200";
  const label = "block text-[11px] text-ink/60";
  const input = "w-full bg-transparent text-sm font-medium outline-none";

  return (
    <div className="rounded-2xl bg-white/95 p-4 shadow-[0_20px_50px_-20px_rgba(12,63,77,0.45)] backdrop-blur sm:p-5">
      <Form action="/booking" className="grid items-center gap-3 lg:grid-cols-[auto_1fr_1fr_1fr_1fr_auto]">
        <h2 className="px-2 text-2xl font-bold text-ink lg:pr-4">{title}</h2>

        <label className={cell}>
          <CalendarDays className="size-5 shrink-0 text-ink/70" />
          <span className="flex-1">
            <span className={label}>วันที่เช็คอิน</span>
            <input
              name="checkin"
              type="date"
              required
              value={checkIn}
              onChange={(e) => {
                const v = e.target.value;
                setCheckIn(v);
                if (v && (!checkOut || checkOut <= v)) setCheckOut(plusOneDay(v));
              }}
              className={input}
            />
          </span>
        </label>

        <label className={cell}>
          <CalendarDays className="size-5 shrink-0 text-ink/70" />
          <span className="flex-1">
            <span className={label}>วันที่เช็คเอาท์</span>
            <input
              name="checkout"
              type="date"
              required
              value={checkOut}
              min={checkIn ? plusOneDay(checkIn) : undefined}
              onChange={(e) => setCheckOut(e.target.value)}
              className={input}
            />
          </span>
        </label>

        <label className={cell}>
          <User className="size-5 shrink-0 text-ink/70" />
          <span className="flex-1">
            <span className={label}>ผู้เข้าพัก</span>
            <select name="guests" defaultValue={String(defaults.guests ?? 2)} className={`${input} appearance-none`}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} ผู้ใหญ่
                </option>
              ))}
            </select>
          </span>
          <ChevronDown className="pointer-events-none size-4 text-ink/60" />
        </label>

        <label className={cell}>
          <BedDouble className="size-5 shrink-0 text-ink/70" />
          <span className="flex-1">
            <span className={label}>จำนวนห้อง</span>
            <select name="rooms" defaultValue={String(defaults.rooms ?? 1)} className={`${input} appearance-none`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} ห้อง
                </option>
              ))}
            </select>
          </span>
          <ChevronDown className="pointer-events-none size-4 text-ink/60" />
        </label>

        <button
          type="submit"
          className="bg-gold flex items-center justify-center gap-2 rounded-xl px-7 py-4 font-semibold text-white shadow-md transition hover:brightness-110"
        >
          <Search className="size-5" />
          ค้นหาห้องว่าง
        </button>
      </Form>
    </div>
  );
}
