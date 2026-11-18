import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the dev server + dev database (npm run db:start must be running).
// Owner credentials come from the environment, never from source code:
//   $env:E2E_OWNER_EMAIL="owner@fahtalay.local"; $env:E2E_OWNER_PASSWORD="..."; npm run test:e2e
// E2E_BASE_URL: test a dev server on another port (e.g. when 3000 is used by something else)
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", locale: "th-TH" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "mobile", use: { ...devices["Pixel 7"] }, dependencies: ["setup"] },
  ],
  webServer: { command: "npm run dev", url: BASE_URL, reuseExistingServer: true, timeout: 120_000 },
});
