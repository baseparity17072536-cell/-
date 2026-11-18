import { existsSync } from "node:fs";
import { hash } from "@node-rs/argon2";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { totpAt } from "../../src/server/totp";

// Full two-factor flow in a real browser with a throw-away owner account, created directly in
// the LOCAL dev database (same guard as global-setup.ts: refuses any other database).
// Needs no E2E_OWNER_PASSWORD. Desktop project only (the flow is the same on mobile).

if (existsSync(".env.development.local")) process.loadEnvFile(".env.development.local");
const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? "";
const LOCAL_DEV = /@(localhost|127\.0\.0\.1):54329\/fahtalay_dev$/.test(ADMIN_URL);

const email = `e2e-mfa-${Date.now()}@test.local`;
const password = "E2e-mfa-pass-1";
let userId = "";

test.beforeAll(async () => {
  if (!LOCAL_DEV) return;
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    const pw = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    userId = (await c.query("INSERT INTO users (email, name, password_hash) VALUES ($1, 'E2E MFA owner', $2) RETURNING id", [email, pw])).rows[0].id;
    await c.query("INSERT INTO memberships (tenant_id, user_id, role) SELECT id, $1, 'owner' FROM tenants WHERE slug = 'fahtalay'", [userId]);
  } finally {
    await c.end();
  }
});

test.afterAll(async () => {
  if (!LOCAL_DEV || !userId) return;
  // audit_logs keep a reference to the user, so deactivate instead of deleting
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    await c.query("UPDATE memberships SET is_active = false WHERE user_id = $1", [userId]);
    await c.query("UPDATE users SET is_active = false WHERE id = $1", [userId]);
    await c.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  } finally {
    await c.end();
  }
});

async function passwordStep(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.getByLabel("รหัสผ่าน").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "ออกจากระบบ" }).first().click();
  await page.waitForURL("**/admin/login");
}

test("owner must set up two-factor sign-in, then signs in with an app code or a recovery code", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  test.skip(!LOCAL_DEV, "needs the local dev database (npm run db:start)");

  // 1. first sign-in: forced to setup, nothing else reachable
  await passwordStep(page);
  await page.waitForURL("**/admin/mfa-setup");
  await page.goto("/admin/bookings");
  await page.waitForURL("**/admin/mfa-setup");
  await expect(page.locator("svg").first()).toBeVisible(); // QR code

  await page.getByText("สแกนไม่ได้? ใส่รหัสเอง").click();
  const secret = (await page.locator("details p").innerText()).replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel("รหัสจากแอป").fill("000000");
  await page.getByRole("button", { name: "ยืนยันและเปิดใช้" }).click();
  await expect(page.getByText(/^รหัสไม่ถูกต้อง/)).toBeVisible();

  await page.getByLabel("รหัสจากแอป").fill(totpAt(secret, Date.now()));
  await page.getByRole("button", { name: "ยืนยันและเปิดใช้" }).click();
  await expect(page.getByText("เปิดการยืนยันตัวตน 2 ขั้นตอนแล้ว")).toBeVisible();
  const codes = await page.getByRole("status").locator("li").allInnerTexts();
  expect(codes).toHaveLength(10);

  await page.getByRole("link", { name: /ไปหน้าหลังบ้าน/ }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByText(/สวัสดี/)).toBeVisible();
  await logout(page);

  // 2. password alone is not enough any more; the app code completes sign-in
  await passwordStep(page);
  await page.waitForURL("**/admin/login/verify");
  await page.goto("/admin");
  await page.waitForURL("**/admin/login"); // no session yet
  await passwordStep(page);
  await page.waitForURL("**/admin/login/verify");
  await page.getByLabel("รหัสจากแอป").fill(totpAt(secret, Date.now() + 30_000));
  await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
  await page.waitForURL(/\/admin$/);
  await logout(page);

  // 3. lost phone: a recovery code works and the account page warns about it
  await passwordStep(page);
  await page.waitForURL("**/admin/login/verify");
  await page.getByLabel("รหัสจากแอป").fill(codes[0]);
  await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
  await page.waitForURL("**/admin/account?recovery_left=9");
  await expect(page.getByText(/เข้าสู่ระบบด้วยรหัสกู้คืน \(เหลือ 9 รหัส\)/)).toBeVisible();
  await expect(page.getByText("เปิดใช้งานอยู่")).toBeVisible();
});
