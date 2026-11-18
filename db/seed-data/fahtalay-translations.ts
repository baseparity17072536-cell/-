// English and Chinese content for the FahTalay seed data (guest website in other languages).
// Used by db/seed.ts for new installs and by scripts/translations-sql.ts for the production upgrade,
// which only fills fields that are still empty — text already edited in the admin is never overwritten.
// After installation, edit translations in the admin (room types, rate plans, property settings).

type Lang = "en" | "zh";
type Fields = Record<string, string | string[]>;

export const PROPERTY_TRANSLATIONS: Record<Lang, Fields> = {
  en: {
    name: "FahTalay Resort",
    address: "78/12 Moo 1, Mae Ramphueng Beach Road, Ban Phe, Mueang Rayong, Rayong 21160, Thailand",
  },
  zh: {
    name: "海天度假村 FahTalay Resort",
    address: "泰国罗勇府直辖县班佩镇湄兰蓬海滩路 1 村 78/12 号，邮编 21160",
  },
};

/** by rate plan code */
export const RATE_PLAN_TRANSLATIONS: Record<string, Record<Lang, Fields>> = {
  ROOM_ONLY: {
    en: { name: "Room only", description: "Room rate without meals" },
    zh: { name: "仅客房", description: "不含餐的房价" },
  },
};

const AMENITIES: Record<Lang, string[]> = {
  en: ["Air conditioning", "Private balcony", "Flat-screen TV", "Refrigerator", "Coffee maker", "Free Wi-Fi"],
  zh: ["空调", "私人阳台", "平板电视", "冰箱", "咖啡机", "免费 Wi-Fi"],
};

/** by room type slug */
export const ROOM_TYPE_TRANSLATIONS: Record<string, Record<Lang, Fields>> = {
  "deluxe-sea-view": {
    en: { name: "Deluxe Sea View", description: "A sea-view room in a peaceful setting, perfect for couples", bed_info: "1 large bed", amenities: AMENITIES.en },
    zh: { name: "豪华海景房", description: "海景客房，环境宁静，适合情侣入住", bed_info: "1 张大床", amenities: AMENITIES.zh },
  },
  "villa-garden-view": {
    en: { name: "Villa Garden View", description: "A spacious garden-view villa, ideal for friends or small families", bed_info: "2 large beds", amenities: AMENITIES.en },
    zh: { name: "花园景观别墅", description: "宽敞的花园景观别墅，适合朋友结伴或小家庭入住", bed_info: "2 张大床", amenities: AMENITIES.zh },
  },
  "family-suite": {
    en: { name: "Family Suite", description: "A large suite for families with a separate living area", bed_info: "2 large beds", amenities: AMENITIES.en },
    zh: { name: "家庭套房", description: "宽敞的家庭套房，设有独立客厅", bed_info: "2 张大床", amenities: AMENITIES.zh },
  },
};

/** Room type code given by db/seed.ts: initials of the slug ("deluxe-sea-view" → "DSV"). */
export const seedCode = (slug: string) => slug.split("-").map((w) => w[0]).join("").toUpperCase().padEnd(2, "X");

/**
 * SQL that fills missing translations (existing text wins: defaults || current), matched by tenant slug.
 * Sets app.tenant_id first so the tenant row-level-security policy lets the admin role update the rows
 * (run it inside a transaction).
 */
export function translationsSql(tenantSlug = "fahtalay") {
  const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  const merge = (t: Record<Lang, Fields>) =>
    `jsonb_build_object('en', ${lit(t.en)} || COALESCE(translations->'en', '{}'::jsonb), 'zh', ${lit(t.zh)} || COALESCE(translations->'zh', '{}'::jsonb))`;
  const tenant = `(SELECT id FROM tenants WHERE slug = '${tenantSlug}')`;
  return [
    `SELECT set_config('app.tenant_id', ${tenant}::text, true);`,
    `UPDATE properties SET translations = translations || ${merge(PROPERTY_TRANSLATIONS)} WHERE tenant_id = ${tenant};`,
    ...Object.entries(RATE_PLAN_TRANSLATIONS).map(([code, t]) =>
      `UPDATE rate_plans SET translations = translations || ${merge(t)} WHERE tenant_id = ${tenant} AND code = '${code}';`),
    // saving a room type in the admin changes its slug to the code, so match either (codes as created by db/seed.ts)
    ...Object.entries(ROOM_TYPE_TRANSLATIONS).map(([slug, t]) =>
      `UPDATE room_types SET translations = translations || ${merge(t)} WHERE tenant_id = ${tenant} AND (slug = '${slug}' OR code = '${seedCode(slug)}');`),
  ].join("\n");
}
