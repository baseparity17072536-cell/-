import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { OWNER_STATE } from "./paths";

if (existsSync(".env.development.local")) process.loadEnvFile(".env.development.local");
const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? "";
const LOCAL_DEV = /@(localhost|127\.0\.0\.1):54329\/fahtalay_dev$/.test(ADMIN_URL);

/** Today's test booking would use up a room for today on every run: release it again (local dev DB only). */
async function releaseToday(code: string) {
  if (!LOCAL_DEV) return;
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `UPDATE inventory_nights i SET sold = i.sold - 1 FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
       WHERE b.code = $1 AND b.status IN ('confirmed','checked_in') AND i.room_type_id = br.room_type_id
         AND i.stay_date >= b.check_in AND i.stay_date < b.check_out`, [code]);
    await c.query(
      "UPDATE room_assignments SET active = false WHERE booking_room_id IN (SELECT br.id FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id WHERE b.code = $1)",
      [code]);
    await c.query("UPDATE bookings SET status = 'cancelled', cancelled_by = 'staff', cancel_reason = 'E2E cleanup' WHERE code = $1", [code]);
    await c.query("COMMIT");
  } finally {
    await c.end();
  }
}

// Phase 3 front desk: change a booking's dates and notes, and check a guest in from the dashboard.

function future(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const base = 400 + Math.floor(Math.random() * 300);
const phone = `08${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function login(page: Page) {
  test.skip(!process.env.E2E_OWNER_PASSWORD, "set E2E_OWNER_PASSWORD to run admin flows");
  const state = JSON.parse(await readFile(OWNER_STATE, "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
  await page.context().addCookies(state.cookies);
}

async function walkIn(page: Page, checkIn: string, checkOut: string) {
  await page.goto(`/admin/bookings/new?check_in=${checkIn}&check_out=${checkOut}&adults=2`);
  await page.getByLabel("ชื่อ-นามสกุล").fill("ลูกค้า แก้ไขการจอง");
  await page.getByLabel("เบอร์โทรศัพท์").fill(phone);
  await page.getByRole("checkbox", { name: /ยืนยันการจองทันที/ }).check();
  await page.getByRole("button", { name: "บันทึกการจอง" }).click();
  await page.waitForURL(/\/admin\/bookings\/FT[A-Z0-9]{8}\?created=1/);
  return page.url().match(/FT[A-Z0-9]{8}/)![0];
}

test("front desk extends a stay and updates the internal note", async ({ page }, info) => {
  await login(page);
  const offset = base + (info.project.name === "mobile" ? 10 : 0);
  const code = await walkIn(page, future(offset), future(offset + 2));

  await expect(page.getByRole("link", { name: "แก้ไขการจอง" })).toBeVisible();
  // open directly: the router keeps the previous page (with the same field names) hidden in the DOM
  await page.goto(`/admin/bookings/${code}/edit`);
  await page.waitForURL(`**/admin/bookings/${code}/edit`);
  const datesForm = page.locator("form", { has: page.getByRole("button", { name: "เปลี่ยนวันที่" }) });
  await datesForm.locator("input[name=check_out]").fill(future(offset + 3));
  await page.getByRole("button", { name: "เปลี่ยนวันที่" }).click();
  await expect(page.getByText(/เปลี่ยนวันที่เรียบร้อย · ยอดรวมใหม่/)).toBeVisible();
  await expect(page.getByText(/\(3 คืน\)/)).toBeVisible();

  await page.getByLabel(/บันทึกภายใน/).fill("ขอห้องชั้นล่าง");
  await page.getByRole("button", { name: "บันทึก", exact: true }).first().click();
  await expect(page.getByText("บันทึกข้อมูลเรียบร้อย")).toBeVisible();

  await page.goto(`/admin/bookings/${code}`);
  await expect(page.getByText("ขอห้องชั้นล่าง")).toBeVisible();
  await expect(page.getByText(/^เปลี่ยนวันที่ .* → /)).toBeVisible();
  await expect(page.getByText("แก้ไขข้อมูลผู้เข้าพัก")).toBeVisible();
});

test("front desk checks in today's arrival from the dashboard", async ({ page }) => {
  await login(page);
  const code = await walkIn(page, future(0), future(1));

  // before a room is assigned the dashboard asks for it
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row.getByRole("link", { name: "จัดห้องก่อน" })).toBeVisible();

  await page.goto(`/admin/bookings/${code}`);
  const select = page.getByLabel("เลือกห้อง").first();
  const free = await select.locator("option:not([disabled])").nth(1).getAttribute("value");
  await select.selectOption(free!);
  await page.getByRole("button", { name: "บันทึก" }).first().click();
  await expect(page.getByText("จัดห้องเรียบร้อย")).toBeVisible();

  await page.goto("/admin");
  await page.getByRole("row").filter({ hasText: code }).getByRole("button", { name: "เช็คอิน" }).click();
  await page.waitForURL(/\/admin\?done=checked_in/);
  await expect(page.getByRole("status").filter({ hasText: code })).toContainText("เข้าพักอยู่");
  await releaseToday(code);
});
