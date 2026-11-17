import { existsSync } from "node:fs";
import pg from "pg";

// E2E runs repeat many bookings/logins from 127.0.0.1, which the real limiters (correctly) block.
// Reset the counters in the *development* database before each run. Refuses to touch anything else.
export default async function globalSetup() {
  if (existsSync(".env.development.local")) process.loadEnvFile(".env.development.local");
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !/@(localhost|127\.0\.0\.1):54329\/fahtalay_dev$/.test(url)) {
    console.warn("[e2e] skipping limiter reset: not the local dev database");
    return;
  }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DELETE FROM rate_limits WHERE key ~ '^(login|book|lookup|cancel|reset):'");
  await c.query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE locked_until IS NOT NULL OR failed_logins > 0");
  await c.end();
}
