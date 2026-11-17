import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { OWNER_STATE } from "./paths";

const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD;

function future(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// each run uses dates far apart so repeated runs do not fill the hotel
const base = 60 + Math.floor(Math.random() * 200);
const phone = `08${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function guestBooks(page: Page, offset: number) {
  await page.goto(`/booking?checkin=${future(base + offset)}&checkout=${future(base + offset + 2)}&guests=2&children=0&rooms=1`);
  await page.getByRole("link", { name: /^เลือก/ }).first().click();
  await expect(page.getByRole("heading", { name: "ข้อมูลผู้เข้าพัก" })).toBeVisible();
  await page.getByLabel(/ชื่อ-นามสกุล/).fill("ทดสอบ อีทูอี");
  await page.getByLabel(/เบอร์โทรศัพท์/).fill(phone);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "ยืนยันการจอง" }).click();
  await page.waitForURL(/\/booking\/FT[A-Z0-9]{8}\?new=1/);
  return page.url().match(/FT[A-Z0-9]{8}/)![0];
}

/** Use the owner session saved by auth.setup.ts (no repeated logins). */
async function login(page: Page) {
  test.skip(!OWNER_PASSWORD, "set E2E_OWNER_PASSWORD to run admin flows");
  const state = JSON.parse(await readFile(OWNER_STATE, "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
  await page.context().addCookies(state.cookies);
}

test("guest books a room, sees own details; a stranger does not", async ({ page, browser }) => {
  const code = await guestBooks(page, 0);
  await expect(page.getByText("ส่งคำขอจองสำเร็จ")).toBeVisible();
  await expect(page.getByText(phone)).toBeVisible();

  const stranger = await browser.newPage();
  await stranger.goto(`/booking/${code}`);
  await expect(stranger.getByText("ข้อมูลผู้เข้าพักถูกซ่อนไว้")).toBeVisible();
  await expect(stranger.getByText(phone)).toHaveCount(0);
  // stranger proves ownership with the phone number
  await stranger.goto("/booking/lookup");
  await stranger.getByLabel("รหัสการจอง").fill(code);
  await stranger.getByLabel(/เบอร์โทรศัพท์/).fill(phone);
  await stranger.getByRole("button", { name: "ค้นหาการจอง" }).click();
  await stranger.waitForURL(`**/booking/${code}`);
  await expect(stranger.getByText(phone)).toBeVisible();
  await stranger.close();
});

test("guest cancels an unpaid booking with phone confirmation", async ({ page }) => {
  await guestBooks(page, 5);
  page.on("dialog", (d) => d.accept());
  await page.getByText("ต้องการยกเลิกการจอง?").click();
  await page.getByLabel(/กรอกเบอร์โทรศัพท์ที่ใช้จอง/).fill(phone);
  await page.getByRole("button", { name: "ยกเลิกการจอง" }).click();
  await expect(page.getByRole("status")).toContainText("ยกเลิกการจองเรียบร้อยแล้ว");
  await expect(page.getByText("ต้องการยกเลิกการจอง?")).toHaveCount(0);
});

test("owner confirms a web booking and checks the guest in", async ({ page, browser }) => {
  const guest = await browser.newPage();
  const code = await guestBooks(guest, 10);
  await guest.close();

  await login(page);
  await page.goto(`/admin/bookings/${code}`);
  await expect(page.getByText("รอชำระเงิน").first()).toBeVisible();
  await page.getByRole("button", { name: /ยืนยันการจอง \/ ชำระแล้ว/ }).click();
  await expect(page.getByRole("status")).toContainText("ยืนยันแล้ว");

  // assign the first free room, then check in
  const select = page.getByLabel("เลือกห้อง").first();
  const free = await select.locator("option:not([disabled])").nth(1).getAttribute("value");
  await select.selectOption(free!);
  await page.getByRole("button", { name: "บันทึก" }).first().click();
  await expect(page.getByText("จัดห้องเรียบร้อย")).toBeVisible();
  await page.reload();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "เช็คอิน" }).click();
  await expect(page.getByRole("status")).toContainText("เข้าพักอยู่");
});

test("front desk style walk-in booking from the admin", async ({ page }) => {
  await login(page);
  await page.goto(`/admin/bookings/new?check_in=${future(base + 15)}&check_out=${future(base + 16)}&adults=2`);
  await page.getByLabel("ชื่อ-นามสกุล").fill("ลูกค้า วอล์คอิน");
  await page.getByLabel("เบอร์โทรศัพท์").fill(phone);
  await page.getByLabel(/ช่องทางการจอง/).selectOption("walk_in");
  await page.getByRole("checkbox", { name: /ยืนยันการจองทันที/ }).check();
  await page.getByRole("button", { name: "บันทึกการจอง" }).click();
  await page.waitForURL(/\/admin\/bookings\/FT[A-Z0-9]{8}\?created=1/);
  await expect(page.getByText("สร้างการจองเรียบร้อย")).toBeVisible();
  await expect(page.getByText(/ช่องทาง Walk-in/)).toBeVisible();
  await expect(page.getByText("ยืนยันแล้ว").first()).toBeVisible();
});

test("calendar edit: owner closes a date and the website stops selling it", async ({ page }) => {
  await login(page);
  const day = future(base + 25);
  await page.goto(`/admin/calendar?month=${day.slice(0, 7)}`);
  await page.getByLabel("ตั้งแต่วันที่").fill(day);
  await page.getByLabel("ถึงวันที่ (รวมวันนี้)").fill(day);
  await page.getByRole("radio", { name: "ปิดขาย (Stop sell)" }).check();
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("อัปเดตปฏิทินราคาเรียบร้อย")).toBeVisible();

  await page.goto(`/booking?checkin=${day}&checkout=${future(base + 26)}&guests=2&rooms=1`);
  await expect(page.getByText("ปิดรับจองบางคืนในช่วงนี้").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^เลือก/ })).toHaveCount(0);

  // reopen so the hotel is left as it was
  await page.goto(`/admin/calendar?month=${day.slice(0, 7)}`);
  await page.getByLabel("ตั้งแต่วันที่").fill(day);
  await page.getByLabel("ถึงวันที่ (รวมวันนี้)").fill(day);
  await page.getByRole("radio", { name: "เปิดขาย", exact: true }).check();
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("อัปเดตปฏิทินราคาเรียบร้อย")).toBeVisible();
});
