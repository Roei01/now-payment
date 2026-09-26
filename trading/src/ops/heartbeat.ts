import { query, type Db } from "../db/pool.js";

export async function beat(db: Db, component: string, details: Record<string, unknown> = {}): Promise<void> {
  await query(
    db,
    `INSERT INTO heartbeats (component, last_beat_at, details) VALUES ($1, now(), $2)
     ON CONFLICT (component) DO UPDATE SET last_beat_at = now(), details = EXCLUDED.details`,
    [component, JSON.stringify(details)],
  );
}

export async function startJob(db: Db, job: string): Promise<number> {
  const rows = await query<{ id: number }>(db, "INSERT INTO job_runs (job) VALUES ($1) RETURNING id", [job]);
  return rows[0]!.id;
}

export async function finishJob(db: Db, id: number, status: "OK" | "FAILED" | "SKIPPED", details: Record<string, unknown> = {}) {
  await query(db, "UPDATE job_runs SET finished_at = now(), status = $2, details = $3 WHERE id = $1", [
    id,
    status,
    JSON.stringify(details),
  ]);
}
