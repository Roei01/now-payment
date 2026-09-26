import { query, type Db } from "../db/pool.js";

export interface NotificationInput {
  dedupeKey: string;
  kind: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  subject: string;
  body: string;
}

/** Idempotent enqueue: the same dedupe key is only ever sent once. */
export async function enqueueNotification(db: Db, n: NotificationInput): Promise<boolean> {
  const rows = await query(
    db,
    `INSERT INTO notifications (dedupe_key, kind, severity, subject, body)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [n.dedupeKey, n.kind, n.severity ?? "INFO", n.subject, n.body],
  );
  return rows.length > 0;
}
