import "server-only";
import pg from "pg";

// date columns stay "YYYY-MM-DD" strings (no timezone shifting); bigint counts -> number
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

export type Tx = pg.PoolClient;

const globalForPool = globalThis as unknown as { __appPool?: pg.Pool };

function pool() {
  if (!globalForPool.__appPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Run `npm run db:start` and `npm run db:migrate` (see ENVIRONMENT_SETUP.md).");
    globalForPool.__appPool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  }
  return globalForPool.__appPool;
}

/** Use a specific pool (tests). */
export function setPool(p: pg.Pool) {
  globalForPool.__appPool = p;
}

async function run<T>(tenantId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    // transaction-local: never leaks to the next request using this pooled connection
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId ?? ""]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Run inside a transaction scoped to one tenant. RLS hides every other tenant's rows. */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>) {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error("invalid tenant id");
  return run(tenantId, fn);
}

/** Transaction without tenant context: only platform tables (tenants, users, sessions...) are visible. */
export function withoutTenant<T>(fn: (tx: Tx) => Promise<T>) {
  return run(null, fn);
}

export async function one<T extends pg.QueryResultRow>(tx: Tx, sql: string, params: unknown[] = []) {
  return (await tx.query<T>(sql, params)).rows[0] as T | undefined;
}

export async function many<T extends pg.QueryResultRow>(tx: Tx, sql: string, params: unknown[] = []) {
  return (await tx.query<T>(sql, params)).rows;
}
