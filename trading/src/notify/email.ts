import { query, type Db } from "../db/pool.js";
import { config } from "../config.js";
import { errMsg, log } from "../lib/logger.js";

export interface EmailSender {
  readonly name: string;
  /** idempotencyKey makes a retried send of the same notification a no-op at the provider. */
  send(msg: { to: string; from: string; subject: string; text: string; idempotencyKey?: string }): Promise<void>;
}

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendSender implements EmailSender {
  readonly name = "resend";
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {}
  async send(msg: { to: string; from: string; subject: string; text: string; idempotencyKey?: string }): Promise<void> {
    // ALERT_EMAIL_TO may list several recipients separated by commas (Resend accepts up to 50).
    const to = msg.to.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 50);
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Resend de-duplicates requests with the same key for 24h (max 256 chars).
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from: msg.from, to, subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export function senderFromConfig(): EmailSender | undefined {
  const c = config();
  if (c.NOTIFICATIONS_PROVIDER === "resend" && c.NOTIFICATIONS_API_KEY) return new ResendSender(c.NOTIFICATIONS_API_KEY);
  return undefined;
}

const MAX_ATTEMPTS = 5;

/**
 * Delivers due notifications. Without a configured provider or recipient the
 * rows are marked SUPPRESSED (visible on the Operations screen), never silently dropped.
 */
export async function dispatchNotifications(db: Db, sender: EmailSender | undefined = senderFromConfig()): Promise<{ sent: number; failed: number; suppressed: number }> {
  const c = config();
  const due = await query<{ id: string; subject: string; body: string; attempts: number }>(
    db,
    // Claim the batch (lease for 5 minutes) so concurrent dispatchers never send the same row twice.
    `UPDATE notifications SET next_attempt_at = now() + interval '5 minutes'
      WHERE id IN (SELECT id FROM notifications WHERE status = 'PENDING' AND next_attempt_at <= now()
                    ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING id, subject, body, attempts`,
  );
  const stats = { sent: 0, failed: 0, suppressed: 0 };
  for (const n of due) {
    if (!sender || !c.ALERT_EMAIL_TO || !c.ALERT_EMAIL_FROM) {
      await query(db, "UPDATE notifications SET status = 'SUPPRESSED', last_error = $2 WHERE id = $1", [
        n.id,
        "email provider/recipient not configured",
      ]);
      stats.suppressed++;
      continue;
    }
    try {
      await sender.send({ to: c.ALERT_EMAIL_TO, from: c.ALERT_EMAIL_FROM, subject: n.subject, text: n.body, idempotencyKey: `notification-${n.id}` });
      await query(db, "UPDATE notifications SET status = 'SENT', sent_at = now(), attempts = attempts + 1, recipient = $2 WHERE id = $1", [
        n.id,
        c.ALERT_EMAIL_TO,
      ]);
      stats.sent++;
    } catch (err) {
      const attempts = n.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await query(
        db,
        `UPDATE notifications SET attempts = $2, last_error = $3, status = $4,
           next_attempt_at = now() + ($5 || ' seconds')::interval WHERE id = $1`,
        [n.id, attempts, errMsg(err), final ? "FAILED" : "PENDING", String(60 * 2 ** attempts)],
      );
      stats.failed++;
      log.warn("notification delivery failed", { id: n.id, attempts, error: errMsg(err) });
    }
  }
  return stats;
}
