import { headers } from "next/headers";

// Rate limit แบบ fixed window ในหน่วยความจำของ process
// ใช้ได้กับเซิร์ฟเวอร์เดียว ระบบ production จะย้ายไปเก็บในฐานข้อมูล (Phase 1)

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** คืนค่า true ถ้ายังไม่เกินจำนวนครั้งที่อนุญาต */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function reset(key: string) {
  buckets.delete(key);
}
