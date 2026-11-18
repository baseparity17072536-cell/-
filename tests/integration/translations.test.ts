import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tr, trList } from "@/i18n";
import { searchAvailability } from "@/server/booking";
import { getProperty, getRoomType, listRatePlans, saveRatePlan, saveRoomType, updateProperty } from "@/server/catalog";
import { closePools, fahtalay, staff, stay, useAppPool, useDateBase } from "../setup/helpers";

// Content in other languages (migration 0006): seeded for FahTalay, edited in the admin, used by the guest website.

let ctx: Awaited<ReturnType<typeof fahtalay>>;
beforeAll(async () => {
  useAppPool();
  useDateBase(350); // guests can book up to 365 days ahead
  ctx = await fahtalay();
});
afterAll(closePools);

describe("translations", () => {
  it("the seed gives every room type, rate plan and the property English and Chinese text", async () => {
    const deluxe = (await getRoomType(ctx.tenantId, ctx.types["deluxe-sea-view"]))!;
    expect(tr(deluxe, "name", "zh", deluxe.name_th)).toBe("豪华海景房");
    expect(tr(deluxe, "bed_info", "en", deluxe.bed_info)).toBe("1 large bed");
    expect(trList(deluxe, "amenities", "zh", deluxe.amenities)).toContain("免费 Wi-Fi");
    const plan = (await listRatePlans(ctx.tenantId, ctx.propertyId)).find((p) => p.code === "ROOM_ONLY")!;
    expect(tr(plan, "name", "zh", plan.name_th)).toBe("仅客房");
    const p = (await getProperty(ctx.tenantId, ctx.propertyId))!;
    expect(tr(p, "address", "en", p.address)).toMatch(/Rayong/);
  });

  it("saving from the admin replaces translations; saving without them keeps what is stored", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const rt = (await getRoomType(ctx.tenantId, ctx.types["family-suite"]))!;
    const { id, translations: before, ...rest } = rt;
    const base = { ...rest, id, property_id: rt.property_id };

    await saveRoomType(ctx.tenantId, { ...base, translations: { ...before, zh: { ...before.zh, name: "豪华家庭套房" } } }, owner);
    expect((await getRoomType(ctx.tenantId, id))!.translations.zh?.name).toBe("豪华家庭套房");

    await saveRoomType(ctx.tenantId, base, owner); // e.g. an older caller that does not know about translations
    expect((await getRoomType(ctx.tenantId, id))!.translations.zh?.name).toBe("豪华家庭套房");

    await saveRoomType(ctx.tenantId, { ...base, translations: before }, owner);
    expect((await getRoomType(ctx.tenantId, id))!.translations).toEqual(before);
  });

  it("rate plans and property keep translations through save, and admins' property edits wait for approval", async () => {
    const owner = await staff(ctx.tenantId, "owner");
    const plan = (await listRatePlans(ctx.tenantId, ctx.propertyId)).find((p) => p.code === "ROOM_ONLY")!;
    await saveRatePlan(ctx.tenantId, { ...plan, translations: { ...plan.translations, en: { name: "Room only (test)" } } }, owner);
    expect((await listRatePlans(ctx.tenantId, ctx.propertyId)).find((p) => p.code === "ROOM_ONLY")!.translations.en?.name).toBe("Room only (test)");
    await saveRatePlan(ctx.tenantId, plan, owner);
    expect((await listRatePlans(ctx.tenantId, ctx.propertyId)).find((p) => p.code === "ROOM_ONLY")!.translations).toEqual(plan.translations);

    const adminUser = await staff(ctx.tenantId, "admin");
    const p = (await getProperty(ctx.tenantId, ctx.propertyId))!;
    const r = await updateProperty(ctx.tenantId, { ...p, translations: { zh: { name: "改名" } } }, adminUser);
    expect(r.pendingApproval).toBe(true);
    expect((await getProperty(ctx.tenantId, ctx.propertyId))!.translations).toEqual(p.translations);
  });

  it("search results carry rate plan translations, error codes and the kind of each night's price", async () => {
    const s = stay(2);
    const res = await searchAvailability(ctx.tenantId, { propertyId: ctx.propertyId, ...s, adults: 2, children: 0, rooms: 1 });
    const plan = res.find((r) => r.roomTypeId === ctx.types["deluxe-sea-view"])!.plans[0];
    expect(tr(plan, "name", "zh", plan.name)).toBe("仅客房");
    expect(plan.nightly.every((n) => ["base", "daily", "rule"].includes(n.kind))).toBe(true);

    const crowded = await searchAvailability(ctx.tenantId, { propertyId: ctx.propertyId, ...s, adults: 9, children: 0, rooms: 1 });
    const err = crowded.find((r) => r.roomTypeId === ctx.types["deluxe-sea-view"])!.plans[0];
    expect(err.errorCode).toBe("OCCUPANCY");
  });
});
