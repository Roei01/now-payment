import pg from "pg";
import { config } from "../config.js";

// NUMERIC -> string (keep precision; convert with Decimal), INT8 -> number, DATE -> 'YYYY-MM-DD' string.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool | pg.PoolClient;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const c = config();
    pool = new pg.Pool({
      connectionString: c.DATABASE_URL,
      ssl: c.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function query<T extends pg.QueryResultRow = any>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db.query<T>(text, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(db: Db, text: string, params: unknown[] = []): Promise<T> {
  const rows = await query<T>(db, text, params);
  if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
  return rows[0]!;
}

export async function maybeOne<T extends pg.QueryResultRow = any>(
  db: Db,
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(db, text, params);
  return rows[0];
}

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Session-level advisory lock held for the duration of fn; returns undefined if already held elsewhere. */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T | undefined> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [key]);
    if (!rows[0]?.locked) return undefined;
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

export const LOCKS = {
  MIGRATION: 7_100_001,
  DECISION_CYCLE: 7_100_002,
  RECONCILE: 7_100_003,
  NOTIFY: 7_100_004,
  DAILY: 7_100_005,
} as const;
