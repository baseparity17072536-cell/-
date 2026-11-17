// Database tooling shared by scripts/db.ts and the test harness. Runs with an admin/owner connection.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "migrations");

async function listMigrations() {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.replace(/\.up\.sql$/, ""))
    .sort();
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureTable(c: pg.Client) {
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
}

/** Apply all pending migrations, each in its own transaction. Returns applied versions. */
export function migrateUp(adminUrl: string, log: (m: string) => void = () => {}) {
  return withClient(adminUrl, async (c) => {
    await ensureTable(c);
    const done = new Set((await c.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    const applied: string[] = [];
    for (const v of await listMigrations()) {
      if (done.has(v)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, `${v}.up.sql`), "utf8");
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [v]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw new Error(`Migration ${v} failed: ${(e as Error).message}`, { cause: e });
      }
      applied.push(v);
      log(`applied ${v}`);
    }
    return applied;
  });
}

/** Roll back the most recent migration. */
export function migrateDown(adminUrl: string, log: (m: string) => void = () => {}) {
  return withClient(adminUrl, async (c) => {
    await ensureTable(c);
    const last = (await c.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")).rows[0];
    if (!last) return null;
    const sql = await readFile(path.join(MIGRATIONS_DIR, `${last.version}.down.sql`), "utf8");
    await c.query("BEGIN");
    try {
      await c.query(sql);
      await c.query("DELETE FROM schema_migrations WHERE version = $1", [last.version]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    log(`rolled back ${last.version}`);
    return last.version;
  });
}

/** Create (or update the password of) the runtime LOGIN role used by the web app. */
export function ensureAppLogin(adminUrl: string, user: string, password: string) {
  if (!/^[a-z_][a-z0-9_]{2,40}$/.test(user)) throw new Error("invalid app role name");
  return withClient(adminUrl, async (c) => {
    const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [user])).rowCount;
    const pw = (await c.query<{ q: string }>("SELECT quote_literal($1) AS q", [password])).rows[0].q;
    await c.query(
      exists
        ? `ALTER ROLE ${user} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${pw}`
        : `CREATE ROLE ${user} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${pw}`,
    );
    await c.query(`GRANT app_runtime TO ${user}`);
  });
}

export async function createDatabaseIfMissing(serverAdminUrl: string, name: string) {
  if (!/^[a-z_][a-z0-9_]{2,40}$/.test(name)) throw new Error("invalid database name");
  await withClient(serverAdminUrl, async (c) => {
    const exists = (await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount;
    if (!exists) await c.query(`CREATE DATABASE ${name}`);
  });
}

export function urlFor(base: { host: string; port: number; user: string; password: string }, db: string) {
  return `postgres://${encodeURIComponent(base.user)}:${encodeURIComponent(base.password)}@${base.host}:${base.port}/${db}`;
}
