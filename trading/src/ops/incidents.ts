import { query, type Db } from "../db/pool.js";
import { enqueueNotification } from "../notify/outbox.js";

export type Severity = "INFO" | "WARNING" | "CRITICAL";

/**
 * Opens an incident (deduplicated while open) and queues an e-mail alert for
 * WARNING/CRITICAL. Returns true if a new incident was opened.
 */
export async function openIncident(
  db: Db,
  args: { severity: Severity; kind: string; message: string; details?: Record<string, unknown>; portfolioId?: string; dedupeKey?: string },
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    db,
    `INSERT INTO incidents (severity, kind, message, details, portfolio_id, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [args.severity, args.kind, args.message, JSON.stringify(args.details ?? {}), args.portfolioId ?? null, args.dedupeKey ?? null],
  );
  const created = rows.length > 0;
  if (created && args.severity !== "INFO") {
    await enqueueNotification(db, {
      dedupeKey: `incident:${rows[0]!.id}`,
      kind: `incident.${args.kind}`,
      severity: args.severity,
      subject: `[${args.severity}] ${args.kind}`,
      body: `${args.message}\n\n${JSON.stringify(args.details ?? {}, null, 2)}`,
    });
  }
  return created;
}

export async function resolveIncidents(db: Db, dedupeKey: string, by: string): Promise<void> {
  await query(db, "UPDATE incidents SET resolved_at = now(), resolved_by = $2 WHERE dedupe_key = $1 AND resolved_at IS NULL", [
    dedupeKey,
    by,
  ]);
}
