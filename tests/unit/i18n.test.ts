import { describe, expect, it } from "vitest";
import { errorText, fromAcceptLanguage, getDict, LOCALES, localePath, splitLocale, stayErrorText, tr, trList } from "@/i18n";
import { routeLocale } from "@/i18n/routing";

describe("language routing (src/proxy.ts)", () => {
  it("Thai keeps the old unprefixed URLs; other languages are prefixed", () => {
    expect(routeLocale("/booking")).toEqual({ type: "rewrite", to: "/th/booking" });
    expect(routeLocale("/", { search: "?a=1" })).toEqual({ type: "rewrite", to: "/th?a=1" });
    expect(routeLocale("/en/booking")).toEqual({ type: "next" });
    expect(routeLocale("/zh")).toEqual({ type: "next" });
  });

  it("/th/... is redirected to the one canonical Thai URL", () => {
    expect(routeLocale("/th/booking/lookup", { search: "?x=1" })).toEqual({ type: "redirect", to: "/booking/lookup?x=1", status: 308 });
    expect(routeLocale("/th")).toEqual({ type: "redirect", to: "/", status: 308 });
  });

  it("unknown prefixes are Thai paths (and end up as a 404 page), not languages", () => {
    expect(routeLocale("/fr/booking")).toEqual({ type: "rewrite", to: "/th/fr/booking" });
    expect(routeLocale("/english")).toEqual({ type: "rewrite", to: "/th/english" });
  });

  it("Thai is the primary language: no URL is redirected by browser language", () => {
    expect(routeLocale("/")).toEqual({ type: "rewrite", to: "/th" });
    expect(routeLocale("/booking/lookup")).toEqual({ type: "rewrite", to: "/th/booking/lookup" });
  });

  it("Accept-Language respects q-values and order", () => {
    expect(fromAcceptLanguage("en;q=0.5, zh-TW;q=0.8")).toBe("zh");
    expect(fromAcceptLanguage("ja, en-GB")).toBe("en");
    expect(fromAcceptLanguage("zh;q=0, en")).toBe("en");
    expect(fromAcceptLanguage("")).toBeNull();
  });

  it("paths", () => {
    expect(localePath("th", "/booking")).toBe("/booking");
    expect(localePath("en", "/")).toBe("/en");
    expect(localePath("zh", "/booking/FT123")).toBe("/zh/booking/FT123");
    expect(splitLocale("/zh/booking")).toEqual({ lang: "zh", path: "/booking" });
    expect(splitLocale("/en")).toEqual({ lang: "en", path: "/" });
    expect(splitLocale("/booking")).toEqual({ lang: "th", path: "/booking" });
    expect(splitLocale("/enx/booking")).toEqual({ lang: "th", path: "/enx/booking" });
  });
});

describe("dictionaries", () => {
  /** every leaf: strings non-empty, arrays the same length as Thai, functions return text */
  function leaves(v: unknown, path = ""): [string, unknown][] {
    if (v && typeof v === "object" && !Array.isArray(v)) return Object.entries(v).flatMap(([k, x]) => leaves(x, `${path}.${k}`));
    if (Array.isArray(v)) return [[`${path}[]`, v.length], ...v.flatMap((x, i) => leaves(x, `${path}[${i}]`))];
    return [[path, v]];
  }

  it("English and Chinese have every Thai entry, nothing empty", () => {
    const ref = leaves(getDict("th"));
    for (const lang of LOCALES) {
      const got = new Map(leaves(getDict(lang)));
      for (const [path, thai] of ref) {
        expect(got.has(path), `${lang}${path}`).toBe(true);
        const v = got.get(path);
        if (typeof thai === "number") expect(v, `${lang}${path} length`).toBe(thai);
        if (typeof v === "string") expect(v.trim(), `${lang}${path}`).not.toBe("");
        if (typeof v === "function") {
          // some take counts, some take formatted text
          let out: unknown;
          try {
            out = v(2, 3, "x");
          } catch {
            out = v("2", "3", "x");
          }
          expect(String(out).trim(), `${lang}${path}()`).not.toBe("");
        }
      }
    }
  });

  it("each language is actually translated (not Thai left in place)", () => {
    const thai = /[฀-๿]/;
    for (const lang of ["en", "zh"] as const) {
      const bad = leaves(getDict(lang)).filter(([, v]) => typeof v === "string" && thai.test(v));
      expect(bad.map(([p]) => p), lang).toEqual([]);
    }
    expect(getDict("zh").nav.book).toMatch(/[一-鿿]/);
  });

  it("English plurals", () => {
    const d = getDict("en");
    expect(d.stay.nights(1)).toBe("1 night");
    expect(d.stay.nights(3)).toBe("3 nights");
    expect(d.results.onlyLeft(1)).toBe("Only 1 room left");
  });

  it("booking-system errors: Thai keeps the specific message, others map the code", () => {
    const e = { code: "SOLD_OUT", message: "ขออภัย ห้องเต็ม (ข้อความจากระบบ)" };
    expect(errorText("th", e)).toBe(e.message);
    expect(errorText("en", e)).toBe(getDict("en").errors.SOLD_OUT);
    expect(errorText("zh", { code: "SOMETHING_NEW", message: "x" })).toBe(getDict("zh").errors.VALIDATION);
    expect(stayErrorText("en", "maxNights", 30)).toBe("Bookings are limited to 30 nights");
    expect(stayErrorText("zh", null, 30)).toBeNull();
  });
});

describe("content from the database", () => {
  const row = { translations: { en: { name: "Sea View", amenities: ["Wi-Fi"] }, zh: { name: "海景房", description: "  " } } };
  it("uses the language, then English, then Thai", () => {
    expect(tr(row, "name", "zh", "วิวทะเล")).toBe("海景房");
    expect(tr(row, "name", "th", "วิวทะเล")).toBe("วิวทะเล");
    expect(tr(row, "description", "zh", "คำอธิบาย")).toBe("คำอธิบาย"); // blank Chinese, no English → Thai
    expect(tr({ translations: {} }, "name", "en", "ไทย")).toBe("ไทย");
    expect(tr({ translations: null }, "address", "en", null)).toBeNull();
    expect(trList(row, "amenities", "zh", ["ไวไฟ"])).toEqual(["Wi-Fi"]); // no Chinese list → English
    expect(trList(row, "amenities", "th", ["ไวไฟ"])).toEqual(["ไวไฟ"]);
  });
});
