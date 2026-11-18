import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addRoomTypeImage, deleteRoomTypeImage, getRoomType, moveRoomTypeImage } from "@/server/catalog";
import { admin, closePools, fahtalay, staff, useAppPool } from "../setup/helpers";

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
    await storage.deleteStoredFile(url);
    expect(existsSync(diskPath(url))).toBe(false);
    // must not throw or touch anything
    await storage.deleteStoredFile("/images/rooms/deluxe-1.jpg");
    await storage.deleteStoredFile(`/media/${a.tenantId}/../../../package.json`);
    expect(existsSync(path.resolve(import.meta.dirname, "..", "..", "package.json"))).toBe(true);
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
