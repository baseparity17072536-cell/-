import SiteHeader from "@/components/site-header";
import { RESORT } from "@/lib/rooms";

export default function BookingLayout({ children }: LayoutProps<"/booking">) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="bg-teal-deep py-6 text-center text-xs text-white/70 print:hidden">
        {RESORT.name} · โทร {RESORT.phone} · © 2026 {RESORT.nameEn}
      </footer>
    </div>
  );
}
