import { query, type Db } from "../db/pool.js";

export async function audit(
  db: Db,
  actor: string,
  action: string,
  target: string | null,
  details: Record<string, unknown> = {},
  ip?: string,
): Promise<void> {
  await query(db, "INSERT INTO audit_events (actor, action, target, details, ip) VALUES ($1, $2, $3, $4, $5)", [
    actor,
    action,
    target,
    JSON.stringify(details),
    ip ?? null,
  ]);
}
