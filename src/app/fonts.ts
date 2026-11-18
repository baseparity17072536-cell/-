import { Cinzel, Great_Vibes, Noto_Sans_Thai } from "next/font/google";

// Shared by both root layouts (guest website and admin). Chinese text uses the system CJK font
// (PingFang / Microsoft YaHei / Noto Sans CJK) through the fallback list in globals.css.
const notoSansThai = Noto_Sans_Thai({ variable: "--font-noto-sans-thai", subsets: ["thai", "latin"] });
const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"] });
const greatVibes = Great_Vibes({ variable: "--font-great-vibes", subsets: ["latin"], weight: "400" });

export const fontVars = `${notoSansThai.variable} ${cinzel.variable} ${greatVibes.variable}`;
