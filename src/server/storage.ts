import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { DomainError } from "./errors";

// Two drivers, picked by environment:
// * Vercel Blob — when the project has a Blob store connected (Vercel sets BLOB_READ_WRITE_TOKEN,
//   or BLOB_STORE_ID with OIDC). Files are public at https://<store>.public.blob.vercel-storage.com/rooms/<tenant>/…
//   (room photos are public on the website anyway; names are random UUIDs).
// * Local disk — development, tests and single-server installs, served by /media/[tenant]/[file].
const ROOT = path.join(process.cwd(), "storage", "uploads");
const MAX_BYTES = 5 * 1024 * 1024;
const CACHE_SECONDS = 365 * 24 * 3600; // file names never change: cache for a year

export const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const BLOB_HOST = /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i;
const FILE = "[0-9a-f-]{36}\\.(?:jpg|png|webp)";

const SIGNATURES: { ext: string; type: string; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", type: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", type: "image/webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

/** Validate by content (magic bytes), not by file name or browser-supplied type. Returns the public URL. */
export async function saveImage(tenantId: string, file: File) {
  if (!file || file.size === 0) throw new DomainError("VALIDATION", "กรุณาเลือกไฟล์รูปภาพ");
  if (file.size > MAX_BYTES) throw new DomainError("VALIDATION", "ไฟล์ใหญ่เกิน 5 MB");
  const buf = Buffer.from(await file.arrayBuffer());
  const sig = SIGNATURES.find((s) => s.test(buf));
  if (!sig) throw new DomainError("VALIDATION", "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
  const name = `${randomUUID()}.${sig.ext}`;

  if (blobEnabled()) {
    const blob = await put(`rooms/${tenantId}/${name}`, buf, {
      access: "public", contentType: sig.type, addRandomSuffix: false, cacheControlMaxAge: CACHE_SECONDS,
    });
    return blob.url;
  }
  // serverless file systems are read-only: say what is missing instead of failing with EROFS
  if (process.env.VERCEL) throw new DomainError("VALIDATION", "ยังไม่ได้ตั้งค่าที่เก็บรูปบนเซิร์ฟเวอร์ (Vercel Blob) กรุณาแจ้งผู้ดูแลระบบ");
  const dir = path.join(ROOT, tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buf);
  return `/media/${tenantId}/${name}`;
}

/**
 * Delete an uploaded file of this hotel. Anything else — seeded images in /public, another
 * hotel's files, foreign hosts, crafted paths — is ignored. Never throws: the database row is
 * already gone and an orphaned file is harmless.
 */
export async function deleteStoredFile(tenantId: string, url: string) {
  const local = new RegExp(`^/media/${tenantId}/(${FILE})$`).exec(url);
  if (local) {
    await unlink(path.join(ROOT, tenantId, local[1])).catch(() => {});
    return;
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== "https:" || !BLOB_HOST.test(u.hostname) || u.search) return;
  if (!new RegExp(`^/rooms/${tenantId}/${FILE}$`).test(u.pathname)) return;
  await del(url).catch((e) => console.error("[storage] blob delete failed", url, e));
}

export async function readStoredFile(tenantId: string, name: string) {
  if (!new RegExp(`^${FILE}$`).test(name)) return null;
  const type = SIGNATURES.find((s) => name.endsWith(`.${s.ext}`))!.type;
  try {
    return { body: await readFile(path.join(ROOT, tenantId, name)), type };
  } catch {
    return null;
  }
}
