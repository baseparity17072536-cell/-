import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { OWNER_STATE } from "./paths";

// The owner edits a room type's Chinese name in the admin and the Chinese website shows it.

async function login(page: Page) {
  test.skip(!process.env.E2E_OWNER_PASSWORD, "set E2E_OWNER_PASSWORD to run admin flows");
  const state = JSON.parse(await readFile(OWNER_STATE, "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
  await page.context().addCookies(state.cookies);
}

test("owner translates a room name and the Chinese site shows it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only (same form on mobile)");
  await login(page);
  await page.goto("/admin/rooms");
  await page.getByRole("link", { name: /Family Suite/ }).first().click();
  await page.waitForURL(/\/admin\/rooms\/[0-9a-f-]{36}$/);

  const zhName = page.locator("input[name=tr_zh_name]");
  const original = await zhName.inputValue();
  const renamed = `家庭套房 E2E ${Date.now() % 10000}`;
  // the section starts open when the room already has translations
  if (!(await zhName.isVisible())) await page.getByText(/ภาษาอื่นบนหน้าเว็บลูกค้า/).click();
  await zhName.fill(renamed);
  await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
  await expect(page.getByText("บันทึกเรียบร้อย")).toBeVisible();

  try {
    await page.goto("/zh");
    await expect(page.getByText(renamed).first()).toBeVisible();
  } finally {
    // put the original name back
    await page.goBack();
    await page.reload();
    await page.locator("input[name=tr_zh_name]").fill(original);
    await page.getByRole("button", { name: "บันทึกการแก้ไข" }).click();
    await expect(page.getByText("บันทึกเรียบร้อย")).toBeVisible();
  }
});
