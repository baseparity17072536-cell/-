import type { StayError } from "@/lib/search";
import type { Locale } from "./config";
import { en } from "./dictionaries/en";
import { th, type Dict } from "./dictionaries/th";
import { zh } from "./dictionaries/zh";

export * from "./config";
export type { Dict };

const DICTS: Record<Locale, Dict> = { th, en, zh };

/** Dictionary for a language. Plain objects: safe on the server and in client components. */
export const getDict = (lang: Locale): Dict => DICTS[lang];

/**
 * A guest-facing message for an error from the booking system. Thai shows the service's own,
 * more specific message; other languages map the error code.
 */
export function errorText(lang: Locale, e: { code?: string; message: string }) {
  if (lang === "th") return e.message;
  const errors = DICTS[lang].errors as Record<string, unknown>;
  const m = e.code ? errors[e.code] : undefined;
  return typeof m === "string" ? m : DICTS[lang].errors.VALIDATION;
}

/** Message for an invalid stay search (see parseStay), or null when there is nothing to report. */
export function stayErrorText(lang: Locale, code: StayError | null, maxNights: number) {
  if (!code) return null;
  const e = DICTS[lang].errors;
  return code === "maxNights" ? e.maxNights(maxNights) : e[code];
}

// ------------------------------------------------------------- DB content --
/** translations column: { "<lang>": { "<field>": text | text[] } } */
export type Translations = Partial<Record<string, Record<string, string | string[] | undefined>>>;

function pick(t: Translations | null | undefined, lang: string, field: string) {
  const v = t?.[lang]?.[field];
  return (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "") ? v : undefined;
}

/**
 * Text of a DB field in the guest's language: the translation, else English, else the Thai column.
 * `thai` is the value of the Thai column (e.g. name_th).
 */
export function tr(row: { translations?: Translations | null }, field: string, lang: Locale, thai: string): string;
export function tr(row: { translations?: Translations | null }, field: string, lang: Locale, thai: string | null): string | null;
export function tr(row: { translations?: Translations | null }, field: string, lang: Locale, thai: string | null) {
  if (lang === "th") return thai;
  const v = pick(row.translations, lang, field) ?? pick(row.translations, "en", field);
  return typeof v === "string" ? v : thai;
}

/** List field (e.g. amenities) in the guest's language, with the same fallback. */
export function trList(row: { translations?: Translations | null }, field: string, lang: Locale, thai: string[]) {
  if (lang === "th") return thai;
  const v = pick(row.translations, lang, field) ?? pick(row.translations, "en", field);
  return Array.isArray(v) ? v : thai;
}
