import { query, maybeOne, type Db } from "../db/pool.js";

export interface KillSwitchState {
  active: boolean;
  reason?: string;
  by?: string;
  at?: string;
}

export async function getState<T>(db: Db, key: string, fallback: T): Promise<T> {
  const row = await maybeOne<{ value: T }>(db, "SELECT value FROM system_state WHERE key = $1", [key]);
  return row ? row.value : fallback;
}

export async function setState(db: Db, key: string, value: unknown, by: string): Promise<void> {
  await query(
    db,
    `INSERT INTO system_state (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), by],
  );
}

export const getKillSwitch = (db: Db) => getState<KillSwitchState>(db, "kill_switch", { active: false });
export const getMaintenance = (db: Db) => getState<{ active: boolean; reason?: string }>(db, "maintenance", { active: false });

/** Operational blockers that stop *new* orders (never liquidate). */
export async function tradingBlockers(db: Db): Promise<string[]> {
  const out: string[] = [];
  const ks = await getKillSwitch(db);
  if (ks.active) out.push(`KILL_SWITCH: ${ks.reason ?? "active"}`);
  const m = await getMaintenance(db);
  if (m.active) out.push(`MAINTENANCE: ${m.reason ?? "active"}`);
  return out;
}
