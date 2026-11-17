import { expect, test as setup } from "@playwright/test";
import { OWNER_STATE } from "./paths";

// Log in once and reuse the session for every admin test
// (the real login limiter allows 10 attempts per account per 15 minutes).

setup("owner login", async ({ page }) => {
  const password = process.env.E2E_OWNER_PASSWORD;
  setup.skip(!password, "set E2E_OWNER_PASSWORD to run admin flows");
  await page.goto("/admin/login");
  await page.getByLabel("อีเมล").fill(process.env.E2E_OWNER_EMAIL ?? "owner@fahtalay.local");
  await page.getByLabel("รหัสผ่าน").fill(password!);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL("**/admin");
  await expect(page.getByText(/สวัสดี/)).toBeVisible();
  await page.context().storageState({ path: OWNER_STATE });
});
