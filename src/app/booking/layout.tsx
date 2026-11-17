import { Suspense } from "react";
import SiteHeader from "@/components/site-header";
import { getSite } from "@/server/site";

export default function BookingLayout({ children }: LayoutProps<"/booking">) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="bg-teal-deep py-6 text-center text-xs text-white/70 print:hidden">
        <Suspense>
          <FooterText />
        </Suspense>
      </footer>
    </div>
  );
}

async function FooterText() {
  const { property } = await getSite();
  return (
    <>
      {property.name_th}
      {property.phone && ` · โทร ${property.phone}`} · © {new Date().getFullYear()} {property.name_en ?? property.name_th}
    </>
  );
}
