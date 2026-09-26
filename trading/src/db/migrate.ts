import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

export function migrationsDir(): string {
  // Works from src/db (tsx) and dist/db (compiled).
  return path.resolve(here, "../../migrations");
}

/**
 * Applies pending migrations under an advisory lock. While migrating, the
 * `maintenance` system flag blocks new orders (checked by the risk engine).
 */
export async function migrate(pool: pg.Pool, log: (m: string) => void = console.log): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(7100001)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = fs.readdirSync(migrationsDir()).filter((f) => f.endsWith(".sql")).sort();
    const pending = files.filter((f) => !done.has(f));
    if (pending.length === 0) return applied;

    const hasState = (await client.query("SELECT to_regclass('system_state') AS t")).rows[0]?.t;
    if (hasState) {
      await client.query(
        `INSERT INTO system_state (key, value, updated_by) VALUES ('maintenance', '{"active": true, "reason": "schema migration"}', 'migrator')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      );
    }
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir(), file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
        log(`applied migration ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
    await client.query(
      `INSERT INTO system_state (key, value, updated_by) VALUES ('maintenance', '{"active": false}', 'migrator')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    );
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(7100001)").catch(() => undefined);
    client.release();
  }
}
