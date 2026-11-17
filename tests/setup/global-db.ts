// Starts a throw-away PostgreSQL 18 for the test run, applies migrations, creates the
// least-privileged app role and seeds two tenants. Nothing is shared with the dev database.
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";
import { createDatabaseIfMissing, ensureAppLogin, migrateDown, migrateUp, urlFor } from "../../db/tooling";
import { runSeed } from "../../db/seed";

const PORT = 54339;

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
    ownerPassword: string;
  }
}

export default async function setup(project: TestProject) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fahtalay-pg-"));
  const adminPw = randomBytes(12).toString("hex");
  const appPw = randomBytes(12).toString("hex");
  const server = new EmbeddedPostgres({
    // persistent: we delete the directory ourselves with retries (Windows file locks)
    databaseDir: dir, port: PORT, user: "postgres", password: adminPw, persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
  });
  await server.initialise();
  await server.start();
  const base = { host: "localhost", port: PORT, user: "postgres", password: adminPw };
  await createDatabaseIfMissing(urlFor(base, "postgres"), "fahtalay_test");
  const adminUrl = urlFor(base, "fahtalay_test");

  // prove every down migration works (newest first), then migrate up for real
  await migrateUp(adminUrl);
  while (await migrateDown(adminUrl));
  await migrateUp(adminUrl);
  await ensureAppLogin(adminUrl, "fahtalay_app", appPw);
  if (process.env.MUTATION_DROP_OVERBOOKING_GUARD) {
    const pg = (await import("pg")).default;
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    await c.query("ALTER TABLE inventory_nights DROP CONSTRAINT inventory_no_overbooking");
    await c.end();
  }

  const ownerPassword = "Owner-test-123";
  await runSeed(adminUrl, { ownerEmail: "owner@fahtalay.test", ownerPassword, hosts: ["fahtalay.test"], importLegacy: false });

  project.provide("adminUrl", adminUrl);
  project.provide("appUrl", urlFor({ ...base, user: "fahtalay_app", password: appPw }, "fahtalay_test"));
  project.provide("ownerPassword", ownerPassword);

  return async () => {
    await server.stop();
    // Windows keeps file handles briefly after the server exits
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
  };
}
