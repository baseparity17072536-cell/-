import type { Metadata } from "next";
import { Cinzel, Great_Vibes, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai", "latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
});

const greatVibes = Great_Vibes({
  variable: "--font-great-vibes",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "ฟ้าทะเลรีสอร์ท | FahTalay Resort บ้านเพ ระยอง",
  description:
    "ฟ้าทะเลรีสอร์ท บ้านเพ ระยอง พักผ่อนอย่างมีระดับ ใกล้ทะเล ห้องพักหลากหลาย สระว่ายน้ำ ร้านอาหาร ใกล้หาดแม่รำพึง",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${notoSansThai.variable} ${cinzel.variable} ${greatVibes.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
