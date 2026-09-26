import { query, type Db } from "../db/pool.js";
import { config } from "../config.js";
import { errMsg, log } from "../lib/logger.js";

export interface EmailSender {
  readonly name: string;
  send(msg: { to: string; from: string; subject: string; text: string }): Promise<void>;
}

/** Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendSender implements EmailSender {
  readonly name = "resend";
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {}
  async send(msg: { to: string; from: string; subject: string; text: string }): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, text: msg.text }),
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
    `SELECT id, subject, body, attempts FROM notifications
     WHERE status = 'PENDING' AND next_attempt_at <= now() ORDER BY created_at LIMIT 20`,
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
      await sender.send({ to: c.ALERT_EMAIL_TO, from: c.ALERT_EMAIL_FROM, subject: n.subject, text: n.body });
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
