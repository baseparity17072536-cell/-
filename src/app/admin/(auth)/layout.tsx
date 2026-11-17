import type { Metadata } from "next";
import Logo from "@/components/logo";

export const metadata: Metadata = { title: "เข้าสู่ระบบหลังบ้าน", robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-teal-deep px-4 py-12">
      <div className="mb-6">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl">{children}</div>
    </div>
  );
}
