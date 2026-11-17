import "server-only";
import { cache } from "react";
import { getProperty, getRoomType, listRoomTypes, type PropertyRecord } from "./catalog";
import { getTenant } from "./context";
import { many, withTenant } from "./db";

/** Hotel info for public pages, from the database of the tenant that owns this domain. */
export const getSite = cache(async () => {
  const tenant = await getTenant();
  const property = (await getProperty(tenant.id, tenant.propertyId!)) as PropertyRecord;
  return { tenant, property, holdHours: Math.round(property.hold_minutes / 60) };
});

export const getPublicRoomTypes = cache(async () => {
  const { tenant } = await getSite();
  const types = await listRoomTypes(tenant.id, tenant.propertyId!);
  const images = await withTenant(tenant.id, (tx) =>
    many<{ room_type_id: string; url: string; alt: string }>(
      tx, "SELECT room_type_id, url, alt FROM room_type_images ORDER BY room_type_id, sort_order, created_at"),
  );
  return types.map((t) => ({ ...t, images: images.filter((i) => i.room_type_id === t.id) }));
});

export async function getPublicRoomType(id: string) {
  const { tenant } = await getSite();
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const t = await getRoomType(tenant.id, id);
  return t && t.is_active ? t : null;
}
