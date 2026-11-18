import { expect, test } from "@playwright/test";

// Guest website in Thai / English / Chinese: full booking in English, switching language, and the
// remembered choice on the home page.

function future(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const base = 30 + Math.floor(Math.random() * 300);
const phone = `08${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

test("an English-speaking guest books a room from start to finish", async ({ page }, info) => {
  const offset = base + (info.project.name === "mobile" ? 3 : 0);
  await page.goto(`/en/booking?checkin=${future(offset)}&checkout=${future(offset + 2)}&guests=2&children=0&rooms=1`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText(/2 nights · 2 adults · 1 room/)).toBeVisible();
  await expect(page.getByText("1 large bed").first()).toBeVisible(); // room content from the database, translated

  await page.getByRole("link", { name: /^Select/ }).first().click();
  await page.waitForURL("**/en/booking/details?**"); // the first visit compiles the page on the dev server
  await expect(page.getByRole("heading", { name: "Guest details" })).toBeVisible();
  await page.getByLabel(/Full name/).fill("E2E English Guest");
  await page.getByLabel(/Phone number/).fill(phone);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  // the browser's own "required" check stops it first; accept the conditions and send
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await page.waitForURL(/\/en\/booking\/FT[A-Z0-9]{8}\?new=1/);
  await expect(page.getByText("Booking request sent!")).toBeVisible();
  await expect(page.getByText("Awaiting payment").first()).toBeVisible();
  await expect(page.getByText("E2E English Guest")).toBeVisible(); // the booker may see their own details
  await expect(page.getByRole("heading", { name: "How to pay" })).toBeVisible();
});

test("Chinese pages, errors in Chinese, and the switcher keeps the page", async ({ page }) => {
  await page.goto("/zh");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.getByRole("heading", { name: "我们的客房" })).toBeVisible();

  await page.goto("/zh/booking/lookup");
  await page.getByLabel("预订编号").fill("FTNOTREAL1");
  await page.getByLabel("预订时使用的电话号码").fill("0800000000");
  await page.getByRole("button", { name: "查询预订" }).click();
  await expect(page.getByText("未找到预订，请核对预订编号和电话号码。")).toBeVisible();

  await page.goto("/zh/booking/policy");
  await page.getByRole("navigation", { name: "语言" }).getByRole("link", { name: "EN" }).click();
  await page.waitForURL("**/en/booking/policy");
  await expect(page.getByRole("heading", { name: "Booking and stay policy" })).toBeVisible();
  await page.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "TH" }).click();
  await page.waitForURL(/\/booking\/policy$/);
  await expect(page.getByRole("heading", { name: "เงื่อนไขการจองและการเข้าพัก" })).toBeVisible();
});

test.describe("first visit with an English browser", () => {
  test.use({ locale: "en-US" });

  test("lands on English, and a guest who picks Thai stays on Thai", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/en$/);
    await expect(page.getByRole("heading", { name: "Our rooms" })).toBeVisible();

    await page.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "TH" }).click();
    await expect(page.getByRole("heading", { name: "ห้องพักของเรา" })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/); // remembered: no redirect to /en any more
    await expect(page.getByRole("heading", { name: "ห้องพักของเรา" })).toBeVisible();
  });
});
