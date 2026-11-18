import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { OWNER_STATE } from "./paths";

// Phase 3: housekeeping board and maintenance tickets in a real browser.

async function login(page: Page) {
  test.skip(!process.env.E2E_OWNER_PASSWORD, "set E2E_OWNER_PASSWORD to run admin flows");
  const state = JSON.parse(await readFile(OWNER_STATE, "utf8")) as { cookies: Parameters<BrowserContext["addCookies"]>[0] };
  await page.context().addCookies(state.cookies);
}

test("housekeeper marks a room for cleaning and then clean", async ({ page }) => {
  await login(page);
  await page.goto("/admin/housekeeping");
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "รอทำความสะอาด" }) }).first();
  const label = await card.getAttribute("aria-label");
  const room = page.getByRole("listitem", { name: label!, exact: true });

  await room.getByRole("button", { name: "รอทำความสะอาด" }).click();
  await expect(room.getByRole("button", { name: "ทำความสะอาดเสร็จ" })).toBeVisible();
  await expect(room.getByText("รอทำความสะอาด", { exact: true })).toBeVisible();

  await page.goto("/admin/housekeeping?f=dirty");
  await expect(room).toBeVisible();
  await room.getByRole("button", { name: "ทำความสะอาดเสร็จ" }).click();
  await expect(room).toBeHidden(); // no longer in the "to clean" list
});

test("staff report a repair, start it and close it with what was fixed", async ({ page }, info) => {
  await login(page);
  const title = `ก๊อกน้ำรั่ว E2E ${info.project.name} ${Date.now()}`;
  await page.goto("/admin/maintenance");
  await page.locator("select[name=room_id]").selectOption({ index: 1 });
  await page.getByLabel("เสียอะไร").fill(title);
  await page.locator("select[name=priority]").selectOption("urgent");
  await page.getByRole("button", { name: "บันทึกแจ้งซ่อม" }).click();
  await expect(page.getByText("บันทึกงานซ่อมแล้ว")).toBeVisible();

  const ticket = page.getByRole("listitem", { name: `งานซ่อม ${title}` });
  await expect(ticket.getByText("ด่วน", { exact: true })).toBeVisible();
  await ticket.getByRole("button", { name: "เริ่มซ่อม" }).click();
  await expect(ticket.getByText("กำลังซ่อม", { exact: true })).toBeVisible();

  page.once("dialog", (d) => d.accept("เปลี่ยนซีลยาง"));
  await ticket.getByRole("button", { name: "ซ่อมเสร็จ" }).click();
  await expect(ticket).toBeHidden();
  await page.goto("/admin/maintenance?show=closed");
  await expect(page.getByRole("listitem", { name: `งานซ่อม ${title}` }).getByText("ผลการซ่อม: เปลี่ยนซีลยาง")).toBeVisible();
});
