import { query, maybeOne, type Db } from "../db/pool.js";
import { D } from "../lib/money.js";
import type { FxQuote } from "../market/types.js";
import { audit } from "../ops/audit.js";
import { enqueueNotification } from "../notify/outbox.js";
import { resolveIncidents } from "../ops/incidents.js";

export const FX_CONVERSION_COST_BPS = 25; // assumption, recorded per portfolio

/** Books the starting capital (ILS converted at a documented rate, conversion cost charged). */
export async function fundPortfolio(db: Db, portfolioId: string, capitalIls: number, fx: FxQuote, dataSource: string, at: Date): Promise<void> {
  const usd = D(capitalIls).div(fx.rate);
  await query(
    db,
    `UPDATE portfolios SET initial_capital_ils = $2, initial_fx_rate = $3, fx_rate_source = $4, fx_rate_as_of = $5,
        fx_conversion_cost_bps = $6, initial_capital_usd = $7, started_at = $8, data_source = $9 WHERE id = $1`,
    [portfolioId, capitalIls, fx.rate, fx.source, fx.asOf, FX_CONVERSION_COST_BPS, usd.toFixed(6), at, dataSource],
  );
  await query(
    db,
    `INSERT INTO ledger_entries (portfolio_id, entry_type, cash_delta, currency, reference, occurred_at, memo)
     VALUES ($1, 'INITIAL_DEPOSIT', $2, 'USD', 'initial-deposit', $3, $4)`,
    [portfolioId, usd.toFixed(6), at, `${capitalIls} ILS @ ${fx.rate} (${fx.source})`],
  );
  await query(
    db,
    `INSERT INTO ledger_entries (portfolio_id, entry_type, cash_delta, currency, reference, occurred_at, memo)
     VALUES ($1, 'FX_COST', $2, 'USD', 'initial-fx-cost', $3, $4)`,
    [portfolioId, usd.times(FX_CONVERSION_COST_BPS).div(10_000).neg().toFixed(6), at, `assumed conversion cost ${FX_CONVERSION_COST_BPS} bps`],
  );
}

/**
 * Owner decision only: archives the current run (history, ledger and decisions are kept)
 * and opens a fresh run with new starting capital on the current data source.
 * Nothing in the system ever calls this automatically.
 */
export async function startNewRun(
  db: Db,
  args: { portfolioId: string; capitalIls?: number; fx: FxQuote; dataSource: string; actor: string; reason: string; at?: Date },
): Promise<string> {
  const at = args.at ?? new Date();
  const old = await maybeOne<{ id: string; code: string; name: string; kind: string; execution_venue: string; initial_capital_ils: string | null; run_number: number; risk_budget_pct: string }>(
    db,
    "SELECT id, code, name, kind, execution_venue, initial_capital_ils, run_number, risk_budget_pct FROM portfolios WHERE id = $1 AND status <> 'ARCHIVED'",
    [args.portfolioId],
  );
  if (!old) throw new Error("portfolio not found or already archived");
  if (old.kind === "LIVE") throw new Error("the live portfolio mirrors a real account and cannot be reset");
  const capital = args.capitalIls ?? Number(old.initial_capital_ils ?? 200);
  if (!(capital > 0)) throw new Error("capital must be positive");
  const assignment = await maybeOne<{ strategy_version_id: string }>(
    db,
    "SELECT strategy_version_id FROM strategy_assignments WHERE portfolio_id = $1 AND unassigned_at IS NULL",
    [old.id],
  );
  // Close the old run: cancel resting orders, release the code, keep all history.
  const open = await query<{ id: string; client_order_id: string }>(
    db,
    "SELECT id, client_order_id FROM orders WHERE portfolio_id = $1 AND status IN ('PENDING_SUBMIT','SUBMITTED','ACCEPTED','PARTIALLY_FILLED','UNKNOWN')",
    [old.id],
  );
  for (const o of open) {
    await query(db, "UPDATE orders SET status = 'CANCELED', updated_at = now() WHERE id = $1", [o.id]);
    await query(db, "INSERT INTO order_events (order_id, event_type, payload) VALUES ($1, 'CANCELED_RUN_ARCHIVED', '{}')", [o.id]);
    await query(db, "UPDATE sim_broker_orders SET status = 'CANCELED' WHERE client_order_id = $1 AND status IN ('ACCEPTED','PARTIALLY_FILLED')", [o.client_order_id]);
  }
  await query(db, "UPDATE strategy_assignments SET unassigned_at = $2 WHERE portfolio_id = $1 AND unassigned_at IS NULL", [old.id, at]);
  await query(db, "UPDATE portfolios SET status = 'ARCHIVED', archived_at = $2, code = code || '#run' || run_number WHERE id = $1", [old.id, at]);
  const created = await maybeOne<{ id: string }>(
    db,
    `INSERT INTO portfolios (code, name, kind, execution_venue, status, run_number, risk_budget_pct)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6) RETURNING id`,
    [old.code, old.name, old.kind, old.execution_venue, old.run_number + 1, old.risk_budget_pct],
  );
  await query(db, "UPDATE portfolios SET replaced_by = $2 WHERE id = $1", [old.id, created!.id]);
  await fundPortfolio(db, created!.id, capital, args.fx, args.dataSource, at);
  if (assignment)
    await query(db, "INSERT INTO strategy_assignments (portfolio_id, strategy_version_id, reason, assigned_by, assigned_at) VALUES ($1, $2, $3, $4, $5)", [
      created!.id,
      assignment.strategy_version_id,
      `new run ${old.run_number + 1}: ${args.reason}`,
      args.actor,
      at,
    ]);
  await resolveIncidents(db, `data-source:${old.id}`, args.actor);
  await audit(db, args.actor, "portfolio.new_run", created!.id, { previous: old.id, run: old.run_number + 1, capitalIls: capital, dataSource: args.dataSource, reason: args.reason });
  await enqueueNotification(db, {
    dedupeKey: `new-run:${created!.id}`,
    kind: "portfolio.new_run",
    severity: "WARNING",
    subject: `ריצה חדשה: ${old.name} (ריצה ${old.run_number + 1})`,
    body: `הון התחלתי ₪${capital} @ ${args.fx.rate} (${args.fx.source}), נתונים: ${args.dataSource}.\nהריצה הקודמת נשמרה בארכיון.\nסיבה: ${args.reason}\nעל ידי: ${args.actor}`,
  });
  return created!.id;
}
