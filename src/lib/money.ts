// Money is stored in satang (integer). These helpers are safe on both server and client.

export function formatSatang(satang: number, opts: { symbol?: boolean } = { symbol: true }) {
  const baht = satang / 100;
  const s = baht.toLocaleString("th-TH", { minimumFractionDigits: Number.isInteger(baht) ? 0 : 2, maximumFractionDigits: 2 });
  return opts.symbol === false ? s : `฿${s}`;
}

/** Parse a baht amount typed by a user ("3,500" / "3500.50") into satang. Returns null when invalid. */
export function parseBaht(input: string | null | undefined) {
  if (input == null) return null;
  const s = String(input).replace(/[,\s฿]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const satangToBahtInput = (satang: number) => (satang / 100).toString();
