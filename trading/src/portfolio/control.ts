import { query, maybeOne, type Db } from "../db/pool.js";
import { audit } from "../ops/audit.js";
import { openIncident } from "../ops/incidents.js";

/** Stops new orders for a portfolio. Existing holdings are kept (no automatic liquidation). */
export async function pausePortfolio(db: Db, portfolioId: string, reason: string, actor: string, dedupeKey?: string): Promise<boolean> {
  const row = await maybeOne<{ kind: string; status: string }>(
    db,
    `UPDATE portfolios SET status_before_pause = CASE WHEN status = 'PAUSED' THEN status_before_pause ELSE status END, status = 'PAUSED'
      WHERE id = $1 RETURNING kind, status_before_pause AS status`,
    [portfolioId],
  );
  if (!row) return false;
  if (row.kind === "LIVE" && row.status !== "PAUSED") {
    await query(
      db,
      "INSERT INTO live_state_transitions (portfolio_id, from_status, to_status, reason, actor) VALUES ($1, $2, 'PAUSED', $3, $4)",
      [portfolioId, row.status, reason, actor],
    );
  }
  await audit(db, actor, "portfolio.pause", portfolioId, { reason });
  await openIncident(db, {
    severity: row.kind === "LIVE" ? "CRITICAL" : "WARNING",
    kind: "PORTFOLIO_PAUSED",
    message: `Portfolio paused: ${reason}`,
    portfolioId,
    dedupeKey: dedupeKey ?? `pause:${portfolioId}`,
  });
  return true;
}

export async function resumePortfolio(db: Db, portfolioId: string, actor: string, reason: string, mfaVerified: boolean): Promise<string> {
  const row = await maybeOne<{ kind: string; status: string; status_before_pause: string | null }>(
    db,
    "SELECT kind, status, status_before_pause FROM portfolios WHERE id = $1",
    [portfolioId],
  );
  if (!row) throw new Error("portfolio not found");
  if (row.status !== "PAUSED") return row.status;
  // Recovery policy: live returns to DORMANT-side safe state (ARMED at most) unless it was DORMANT/ELIGIBLE.
  let target = row.status_before_pause ?? (row.kind === "LIVE" ? "DORMANT" : "ACTIVE");
  if (row.kind === "LIVE") {
    if (!mfaVerified) throw new Error("resuming the live portfolio requires 2FA");
    if (target === "PILOT" || target === "ACTIVE") target = "ARMED";
  }
  await query(db, "UPDATE portfolios SET status = $2, status_before_pause = NULL WHERE id = $1", [portfolioId, target]);
  if (row.kind === "LIVE")
    await query(
      db,
      "INSERT INTO live_state_transitions (portfolio_id, from_status, to_status, reason, actor, mfa_verified) VALUES ($1, 'PAUSED', $2, $3, $4, $5)",
      [portfolioId, target, reason, actor, mfaVerified],
    );
  await query(db, "UPDATE incidents SET resolved_at = now(), resolved_by = $2 WHERE portfolio_id = $1 AND resolved_at IS NULL AND kind = 'PORTFOLIO_PAUSED'", [
    portfolioId,
    actor,
  ]);
  await audit(db, actor, "portfolio.resume", portfolioId, { reason, to: target, mfaVerified });
  return target;
}
