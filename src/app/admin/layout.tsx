import "../globals.css";
import { fontVars } from "../fonts";

// Root layout of the admin (staff work in Thai). The guest website has its own root layout in app/[lang].
export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    <html lang="th" className={`${fontVars} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
