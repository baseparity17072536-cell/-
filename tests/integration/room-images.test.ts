import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addRoomTypeImage, deleteRoomTypeImage, getRoomType, moveRoomTypeImage } from "@/server/catalog";
import { admin, closePools, fahtalay, staff, useAppPool } from "../setup/helpers";

// Vercel Blob SDK is mocked: the tests check what we send to it, never the network
const blob = vi.hoisted(() => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://abc123store.public.blob.vercel-storage.com/${pathname}` })),
  del: vi.fn(async () => {}),
}));
vi.mock("@vercel/blob", () => blob);

// storage.ts resolves its folder from process.cwd() at import time: point it at a temp dir
// so tests never touch real uploads.
let tmp: string;
let storage: typeof import("@/server/storage");
let a: Awaited<ReturnType<typeof fahtalay>>;
let otherTenantId: string;

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const file = (bytes: Buffer, name: string, type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });
const diskPath = (url: string) => path.join(tmp, "storage", "uploads", ...url.replace(/^\/media\//, "").split("/"));

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "room-images-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  storage = await import("@/server/storage");
  useAppPool();
  a = await fahtalay();
  otherTenantId = (await admin().query(
    "INSERT INTO tenants (slug, name) VALUES ('images-other', 'Other') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
  )).rows[0].id;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
  await closePools();
});

describe("image file validation (magic bytes)", () => {
  it("accepts JPG, PNG and WebP and names the file by its real content", async () => {
    for (const [bytes, ext] of [[JPG, "jpg"], [PNG, "png"], [WEBP, "webp"]] as const) {
      // misleading name and browser type on purpose: only the content counts
      const url = await storage.saveImage(a.tenantId, file(bytes, "photo.gif", "image/gif"));
      expect(url).toMatch(new RegExp(`^/media/${a.tenantId}/[0-9a-f-]{36}\\.${ext}$`));
      expect(existsSync(diskPath(url))).toBe(true);
    }
  });

  it("rejects empty, oversized and non-image files", async () => {
    await expect(storage.saveImage(a.tenantId, file(Buffer.alloc(0), "a.jpg"))).rejects.toThrow("กรุณาเลือกไฟล์รูปภาพ");
    const big = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]);
    await expect(storage.saveImage(a.tenantId, file(big, "big.jpg"))).rejects.toThrow("ไฟล์ใหญ่เกิน 5 MB");
    for (const fake of ["<svg onload=alert(1)>", "<html><script>x</script>", "GIF89a......", "MZ executable"]) {
      await expect(storage.saveImage(a.tenantId, file(Buffer.from(fake), "evil.jpg"))).rejects.toThrow("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
    }
  });

  it("reads a stored file back with the right type and refuses unsafe names", async () => {
    const url = await storage.saveImage(a.tenantId, file(PNG, "x.png", "image/png"));
    const name = url.split("/").pop()!;
    const f = await storage.readStoredFile(a.tenantId, name);
    expect(f?.type).toBe("image/png");
    expect(f?.body.equals(PNG)).toBe(true);
    for (const bad of ["../../package.json", "..%2f..%2fpackage.json", "x.svg", `${name}.html`, "not-a-uuid.png"]) {
      expect(await storage.readStoredFile(a.tenantId, bad)).toBeNull();
    }
    // another hotel's folder does not have this file
    expect(await storage.readStoredFile(otherTenantId, name)).toBeNull();
  });

  it("deletes only uploaded files, never seeded /public images or crafted paths", async () => {
    const url = await storage.saveImage(a.tenantId, file(JPG, "x.jpg"));
    // another hotel cannot delete it
    await storage.deleteStoredFile(otherTenantId, url);
    expect(existsSync(diskPath(url))).toBe(true);
    await storage.deleteStoredFile(a.tenantId, url);
    expect(existsSync(diskPath(url))).toBe(false);
    // must not throw or touch anything
    await storage.deleteStoredFile(a.tenantId, "/images/rooms/deluxe-1.jpg");
    await storage.deleteStoredFile(a.tenantId, `/media/${a.tenantId}/../../../package.json`);
    expect(existsSync(path.resolve(import.meta.dirname, "..", "..", "package.json"))).toBe(true);
  });
});

describe("Vercel Blob driver (production)", () => {
  const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };

  it("uploads to rooms/<hotel>/<uuid>.<ext> as public, typed by content, cached, never overwriting", async () => {
    await withEnv({ BLOB_READ_WRITE_TOKEN: "test-token" }, async () => {
      blob.put.mockClear();
      const url = await storage.saveImage(a.tenantId, file(PNG, "photo.jpg", "image/jpeg"));
      expect(url).toMatch(new RegExp(`^https://abc123store\\.public\\.blob\\.vercel-storage\\.com/rooms/${a.tenantId}/[0-9a-f-]{36}\\.png$`));
      const [pathname, body, opts] = blob.put.mock.calls[0] as unknown as [string, Buffer, Record<string, unknown>];
      expect(pathname).toMatch(new RegExp(`^rooms/${a.tenantId}/[0-9a-f-]{36}\\.png$`));
      expect(Buffer.from(body).equals(PNG)).toBe(true);
      expect(opts).toMatchObject({ access: "public", contentType: "image/png", addRandomSuffix: false, cacheControlMaxAge: 31536000 });
      expect(opts.allowOverwrite).toBeUndefined();
      // validation still happens before anything is uploaded
      blob.put.mockClear();
      await expect(storage.saveImage(a.tenantId, file(Buffer.from("<svg/>"), "x.png"))).rejects.toThrow("รองรับเฉพาะไฟล์");
      expect(blob.put).not.toHaveBeenCalled();
    });
  });

  it("deletes only this hotel's blobs on the Blob host", async () => {
    const mine = `https://abc123store.public.blob.vercel-storage.com/rooms/${a.tenantId}/0b4a6d0e-2f1c-4c1b-9a7e-1d2c3b4a5f60.jpg`;
    blob.del.mockClear();
    await storage.deleteStoredFile(a.tenantId, mine);
    expect(blob.del).toHaveBeenCalledWith(mine);

    blob.del.mockClear();
    for (const bad of [
      mine.replace(a.tenantId, otherTenantId), // another hotel
      mine.replace("abc123store.public.blob.vercel-storage.com", "evil.example.com"), // foreign host
      mine.replace("https:", "http:"),
      `${mine}?x=1`,
      `https://abc123store.public.blob.vercel-storage.com/rooms/${a.tenantId}/../other/x.jpg`,
      `https://abc123store.public.blob.vercel-storage.com/backups/${a.tenantId}/0b4a6d0e-2f1c-4c1b-9a7e-1d2c3b4a5f60.jpg`,
      "not a url",
    ]) await storage.deleteStoredFile(a.tenantId, bad);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("a failed blob delete does not throw (the database row is already gone)", async () => {
    blob.del.mockRejectedValueOnce(new Error("network down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(storage.deleteStoredFile(a.tenantId, `https://s.public.blob.vercel-storage.com/rooms/${a.tenantId}/0b4a6d0e-2f1c-4c1b-9a7e-1d2c3b4a5f60.webp`)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("on Vercel without a Blob store, says what is missing instead of crashing", async () => {
    await withEnv({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: undefined }, async () => {
      await expect(storage.saveImage(a.tenantId, file(JPG, "x.jpg"))).rejects.toThrow("ยังไม่ได้ตั้งค่าที่เก็บรูป");
    });
  });
});

describe("room type images (service)", () => {
  const typeId = () => a.types["deluxe-sea-view"];
  const urls = async () => (await getRoomType(a.tenantId, typeId()))!.images.map((i) => i.url);

  it("adds images at the end, reorders them and deletes them, with audit entries", async () => {
    const owner = await staff(a.tenantId, "owner");
    const before = await urls();
    const ids: string[] = [];
    for (const n of [1, 2, 3]) ids.push(await addRoomTypeImage(a.tenantId, typeId(), `/test/img-${n}.jpg`, `รูป ${n}`, owner));
    expect((await urls()).slice(-3)).toEqual(["/test/img-1.jpg", "/test/img-2.jpg", "/test/img-3.jpg"]);

    await moveRoomTypeImage(a.tenantId, ids[2], -1, owner);
    expect((await urls()).slice(-3)).toEqual(["/test/img-1.jpg", "/test/img-3.jpg", "/test/img-2.jpg"]);
    // moving past either end is a no-op
    await moveRoomTypeImage(a.tenantId, ids[1], 1, owner);
    expect((await urls()).slice(-1)).toEqual(["/test/img-2.jpg"]);

    for (const id of ids) expect((await deleteRoomTypeImage(a.tenantId, id, owner)).url).toMatch(/^\/test\/img-\d\.jpg$/);
    expect(await urls()).toEqual(before);

    const log = (await admin().query(
      "SELECT action, count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND user_id = $2 GROUP BY action ORDER BY action",
      [a.tenantId, owner.userId],
    )).rows;
    expect(log).toEqual([{ action: "room_type.image_add", n: 3 }, { action: "room_type.image_delete", n: 3 }]);
  });

  it("front desk and accountant cannot change images; admin can", async () => {
    for (const role of ["front_desk", "accountant"] as const) {
      const actor = await staff(a.tenantId, role);
      await expect(addRoomTypeImage(a.tenantId, typeId(), "/test/x.jpg", "", actor)).rejects.toThrow("คุณไม่มีสิทธิ์");
    }
    const adm = await staff(a.tenantId, "admin");
    const id = await addRoomTypeImage(a.tenantId, typeId(), "/test/admin.jpg", "", adm);
    await deleteRoomTypeImage(a.tenantId, id, adm);
  });

  it("another hotel cannot see, move or delete this hotel's image", async () => {
    const owner = await staff(a.tenantId, "owner");
    const id = await addRoomTypeImage(a.tenantId, typeId(), "/test/mine.jpg", "", owner);
    const intruder = await staff(otherTenantId, "owner");
    await expect(deleteRoomTypeImage(otherTenantId, id, intruder)).rejects.toThrow("ไม่พบรูปนี้");
    await expect(moveRoomTypeImage(otherTenantId, id, -1, intruder)).rejects.toThrow("ไม่พบรูปนี้");
    // still there for its owner
    expect(await urls()).toContain("/test/mine.jpg");
    await deleteRoomTypeImage(a.tenantId, id, owner);
  });

  it("cannot attach an image to another hotel's room type", async () => {
    const intruder = await staff(otherTenantId, "owner");
    await expect(addRoomTypeImage(otherTenantId, typeId(), "/test/x.jpg", "", intruder)).rejects.toThrow();
  });
});
