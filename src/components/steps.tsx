import { Check } from "lucide-react";

const STEPS = ["เลือกห้องพัก", "กรอกข้อมูลผู้เข้าพัก", "ยืนยันและชำระเงิน"];

export default function Steps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="mx-auto flex max-w-2xl items-center gap-2 text-sm">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-full font-semibold ${
                done ? "bg-teal-deep text-white" : active ? "bg-gold text-white" : "bg-cream-200 text-ink/50"
              }`}
            >
              {done ? <Check className="size-4" /> : n}
            </span>
            <span className={`hidden whitespace-nowrap sm:inline ${active ? "font-semibold" : "text-ink/60"}`}>
              {label}
            </span>
            {n < STEPS.length && <span className={`h-0.5 flex-1 ${done ? "bg-teal-deep" : "bg-cream-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
