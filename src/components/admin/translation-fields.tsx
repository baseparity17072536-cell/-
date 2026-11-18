import { LOCALE_NAME, LOCALES, type Translations } from "@/i18n";
import { Field, inputCls } from "./ui";

export type TranslationField = { key: string; label: string; rows?: number; list?: boolean; placeholder?: Partial<Record<string, string>> };

/** Languages other than Thai, edited in the admin (Thai stays in the main fields). */
export const OTHER_LOCALES = LOCALES.filter((l) => l !== "th");

/**
 * Text for the guest website in other languages. Inputs are named tr_<lang>_<field> and read back by
 * translationsFrom() in the admin actions. An empty field falls back to English, then to Thai.
 */
export function TranslationFields({ fields, value }: { fields: TranslationField[]; value?: Translations | null }) {
  return (
    <details className="rounded-xl bg-ivory p-4 ring-1 ring-cream-200" open={!value || Object.keys(value).length === 0 ? undefined : true}>
      <summary className="cursor-pointer text-sm font-semibold">
        ภาษาอื่นบนหน้าเว็บลูกค้า ({OTHER_LOCALES.map((l) => LOCALE_NAME[l]).join(" · ")})
        <span className="ml-2 font-normal text-ink/50">ช่องที่เว้นว่างจะแสดงภาษาอังกฤษ หรือภาษาไทยแทน</span>
      </summary>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {OTHER_LOCALES.map((lang) => (
          <fieldset key={lang} className="space-y-3" lang={lang}>
            <legend className="mb-1 text-sm font-semibold">{LOCALE_NAME[lang]}</legend>
            {fields.map((f) => {
              const v = value?.[lang]?.[f.key];
              const text = Array.isArray(v) ? v.join("\n") : (v ?? "");
              const name = `tr_${lang}_${f.key}`;
              const label = `${f.label} (${LOCALE_NAME[lang]})`;
              return (
                <Field key={f.key} label={label} hint={f.list ? "บรรทัดละ 1 รายการ" : undefined}>
                  {f.rows || f.list
                    ? <textarea name={name} rows={f.rows ?? 4} defaultValue={text} placeholder={f.placeholder?.[lang]} className={inputCls} />
                    : <input name={name} defaultValue={text} placeholder={f.placeholder?.[lang]} className={inputCls} />}
                </Field>
              );
            })}
          </fieldset>
        ))}
      </div>
    </details>
  );
}
