import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { totpAt } from "../../src/server/totp";
import { OWNER_STATE, OWNER_TOTP } from "./paths";

// Log in once and reuse the session for every admin test
// (the real login limiter allows 10 attempts per account per 15 minutes).
//
// Owners must use two-factor sign-in. The TOTP secret comes from E2E_OWNER_TOTP_SECRET, or from
// playwright/.auth/owner-totp.txt (git-ignored), which this setup writes the first time it
// enrolls the dev owner. Delete that file and reset MFA in the admin to start over.

function savedSecret() {
  return process.env.E2E_OWNER_TOTP_SECRET ?? (existsSync(OWNER_TOTP) ? readFileSync(OWNER_TOTP, "utf8").trim() : null);
}

// one step ahead: the current step may have just been used (codes are single-use)
const nextCode = (secret: string) => totpAt(secret, Date.now() + 30_000);

setup("owner login", async ({ page }) => {
  const password = process.env.E2E_OWNER_PASSWORD;
  setup.skip(!password, "set E2E_OWNER_PASSWORD to run admin flows");
  await page.goto("/admin/login");
  await page.getByLabel("อีเมล").fill(process.env.E2E_OWNER_EMAIL ?? "owner@fahtalay.local");
  await page.getByLabel("รหัสผ่าน").fill(password!);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL(/\/admin(\/login\/verify|\/mfa-setup)?$/);

  if (page.url().endsWith("/admin/mfa-setup")) {
    await page.getByText("สแกนไม่ได้? ใส่รหัสเอง").click();
    const secret = (await page.locator("details p").innerText()).replace(/\s/g, "");
    await page.getByLabel("รหัสจากแอป").fill(totpAt(secret, Date.now()));
    await page.getByRole("button", { name: "ยืนยันและเปิดใช้" }).click();
    await expect(page.getByText("เปิดการยืนยันตัวตน 2 ขั้นตอนแล้ว")).toBeVisible();
    mkdirSync(path.dirname(OWNER_TOTP), { recursive: true });
    writeFileSync(OWNER_TOTP, secret);
    await page.getByRole("link", { name: /ไปหน้าหลังบ้าน/ }).click();
  } else if (page.url().endsWith("/admin/login/verify")) {
    const secret = savedSecret();
    if (!secret) throw new Error(`owner has MFA on: set E2E_OWNER_TOTP_SECRET or put the secret in ${OWNER_TOTP}`);
    await page.getByLabel("รหัสจากแอป").fill(nextCode(secret));
    await page.getByRole("button", { name: "ยืนยัน" }).click();
  }

  await page.waitForURL("**/admin");
  await expect(page.getByText(/สวัสดี/)).toBeVisible();
  await page.context().storageState({ path: OWNER_STATE });
});
