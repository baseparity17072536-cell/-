import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "./errors";

// Local-disk storage for development / single-server installs. Production on serverless
// needs an object-storage driver (pending configuration: Vercel Blob / S3 credentials).
const ROOT = path.join(process.cwd(), "storage", "uploads");
const MAX_BYTES = 5 * 1024 * 1024;

const SIGNATURES: { ext: string; type: string; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", type: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", type: "image/webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

/** Validate by content (magic bytes), not by file name or browser-supplied type. */
export async function saveImage(tenantId: string, file: File) {
  if (!file || file.size === 0) throw new DomainError("VALIDATION", "กรุณาเลือกไฟล์รูปภาพ");
  if (file.size > MAX_BYTES) throw new DomainError("VALIDATION", "ไฟล์ใหญ่เกิน 5 MB");
  const buf = Buffer.from(await file.arrayBuffer());
  const sig = SIGNATURES.find((s) => s.test(buf));
  if (!sig) throw new DomainError("VALIDATION", "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
  const name = `${randomUUID()}.${sig.ext}`;
  const dir = path.join(ROOT, tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buf);
  return `/media/${tenantId}/${name}`;
}

export async function deleteStoredFile(url: string) {
  const m = /^\/media\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(url);
  if (!m) return; // seeded images live in /public and are not deleted
  await unlink(path.join(ROOT, m[1], m[2])).catch(() => {});
}

export async function readStoredFile(tenantId: string, name: string) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) return null;
  const type = SIGNATURES.find((s) => name.endsWith(`.${s.ext}`))!.type;
  try {
    return { body: await readFile(path.join(ROOT, tenantId, name)), type };
  } catch {
    return null;
  }
}
