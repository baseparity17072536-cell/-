// QA for the installer: apply a generated setup SQL to an empty PostgreSQL that imitates Supabase
// (anon/authenticated roles with default grants), then log in as the app role and check what it sees.
//   npx tsx scripts/verify-setup-sql.ts <setup.sql> <app-password> <host>
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { createDatabaseIfMissing, urlFor } from "../db/tooling";

const [file, appPassword, host] = process.argv.slice(2);

function freePort() {
  return new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fahtalay-verify-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({ databaseDir: dir, port, user: "postgres", password: "verify", persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  try {
    const base = { host: "localhost", port, user: "postgres", password: "verify" };
    await createDatabaseIfMissing(urlFor(base, "postgres"), "postgres_like");
    const admin = new pg.Client({ connectionString: urlFor(base, "postgres_like") });
    await admin.connect();
    await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`);
    const res = await admin.query(await readFile(file, "utf8"));
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    console.log("install result:", JSON.stringify(last.rows[0]));
    await admin.end();

    const app = new pg.Client({ connectionString: urlFor({ ...base, user: "fahtalay_app", password: appPassword }, "postgres_like") });
    await app.connect();
    const t = (await app.query("SELECT t.id, t.name FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id WHERE d.host = $1", [host])).rows[0];
    console.log("app role resolves domain:", t ? t.name : "NOT FOUND");
    const blind = (await app.query("SELECT count(*)::int AS n FROM rooms")).rows[0].n;
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
    const rooms = (await app.query("SELECT count(*)::int AS n FROM rooms")).rows[0].n;
    const types = (await app.query("SELECT string_agg(name_th || ' ' || base_price_satang/100, ', ' ORDER BY sort_order) AS s FROM room_types")).rows[0].s;
    await app.query("COMMIT");
    console.log(`rooms without tenant context: ${blind} (must be 0) · with tenant: ${rooms} · ${types}`);
    let anonBlocked = false;
    const a = new pg.Client({ connectionString: urlFor(base, "postgres_like") });
    await a.connect();
    await a.query("SET ROLE anon");
    await a.query("SELECT * FROM users").catch(() => (anonBlocked = true));
    await a.end();
    console.log("anon blocked from users:", anonBlocked);
    await app.end();
  } finally {
    await server.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
  }
}

main().then(() => process.exit(0), (e) => { console.error("VERIFY FAILED:", e.message); process.exit(1); });
