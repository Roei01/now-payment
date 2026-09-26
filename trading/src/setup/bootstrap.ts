import { query, maybeOne, type Db } from "../db/pool.js";
import { seedAssets } from "../assets/universe.js";
import { latestVersion, seedStrategies, assignStrategy } from "../strategies/registry.js";
import type { FxProvider } from "../market/types.js";
import { fundPortfolio } from "../portfolio/runs.js";
import type { FxQuote } from "../market/types.js";
import { openIncident, resolveIncidents } from "../ops/incidents.js";
import { errMsg, log as logger } from "../lib/logger.js";

export interface PortfolioSeed {
  code: string;
  name: string;
  kind: "PAPER" | "BENCHMARK" | "LIVE";
  strategy: string | null;
  venue: "INTERNAL_SIM" | "ALPACA_PAPER" | "ALPACA_LIVE";
}

export const PORTFOLIO_SEEDS: PortfolioSeed[] = [
  { code: "PAPER-1", name: "תיק דמה 1 — מומנטום", kind: "PAPER", strategy: "TREND_ROTATION", venue: "INTERNAL_SIM" },
  { code: "PAPER-2", name: "תיק דמה 2 — הגנתי", kind: "PAPER", strategy: "DEFENSIVE_REBALANCE", venue: "INTERNAL_SIM" },
  { code: "PAPER-3", name: "תיק דמה 3 — שווי (AI)", kind: "PAPER", strategy: "VALUE_DISCOUNT_AI", venue: "INTERNAL_SIM" },
  { code: "BENCH", name: "מדד ייחוס — SPY", kind: "BENCHMARK", strategy: "BENCHMARK_HOLD", venue: "INTERNAL_SIM" },
  { code: "LIVE", name: "תיק חי", kind: "LIVE", strategy: null, venue: "ALPACA_LIVE" },
];

export const PAPER_CAPITAL_ILS = 200;

/**
 * Idempotent: seeds assets, strategies and portfolios, and funds each paper/benchmark
 * portfolio with 200 ₪ converted at a documented USD/ILS rate (conversion cost booked).
 */
export async function bootstrap(db: Db, fx: FxProvider, dataSource: string, now = new Date()): Promise<string[]> {
  const log: string[] = [];
  await seedAssets(db);
  await seedStrategies(db);
  // Starting capital is only ever converted at a real, documented rate. If the FX source is
  // unreachable, portfolios are created unfunded and funded on a later retry — never at a guess.
  let rate: FxQuote | undefined;
  try {
    rate = await fx.getUsdIls();
    await resolveIncidents(db, "fx-bootstrap", "system");
  } catch (err) {
    logger.warn("fx unavailable during bootstrap; funding deferred", { error: errMsg(err) });
    await openIncident(db, {
      severity: "WARNING",
      kind: "DATA_FEED",
      message: `USD/ILS rate unavailable — starting capital will be booked once a real rate is available (${errMsg(err)})`,
      dedupeKey: "fx-bootstrap",
    });
  }
  for (const s of PORTFOLIO_SEEDS) {
    let p = await maybeOne<{ id: string }>(db, "SELECT id FROM portfolios WHERE code = $1 AND status <> 'ARCHIVED'", [s.code]);
    if (!p) {
      p = await maybeOne<{ id: string }>(
        db,
        `INSERT INTO portfolios (code, name, kind, execution_venue, status) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [s.code, s.name, s.kind, s.venue, s.kind === "LIVE" ? "DORMANT" : "ACTIVE"],
      );
      log.push(`created portfolio ${s.code}`);
      if (s.kind === "LIVE")
        await query(db, "INSERT INTO broker_connections (portfolio_id, provider, environment, key_env_var, secret_env_var) VALUES ($1, 'alpaca', 'live', 'BROKER_LIVE_KEY', 'BROKER_LIVE_SECRET')", [p!.id]);
    }
    // Paper/benchmark start with 200 ₪ at a documented rate; the live portfolio is funded from the real account at pilot start.
    if (s.kind !== "LIVE" && rate) {
      const funded = await maybeOne(db, "SELECT 1 FROM ledger_entries WHERE portfolio_id = $1 AND reference = 'initial-deposit'", [p!.id]);
      if (!funded) {
        await fundPortfolio(db, p!.id, PAPER_CAPITAL_ILS, rate, dataSource, now);
        log.push(`funded ${s.code}`);
      }
    }
    if (s.strategy) {
      const active = await maybeOne(db, "SELECT 1 FROM strategy_assignments WHERE portfolio_id = $1 AND unassigned_at IS NULL", [p!.id]);
      if (!active) {
        const v = await latestVersion(db, s.strategy);
        await assignStrategy(db, p!.id, v!.id, "initial assignment", "bootstrap");
        log.push(`assigned ${s.strategy} v${v!.version} to ${s.code}`);
      }
    }
  }
  const ks = await maybeOne(db, "SELECT 1 FROM system_state WHERE key = 'kill_switch'");
  if (!ks) await query(db, "INSERT INTO system_state (key, value, updated_by) VALUES ('kill_switch', '{\"active\": false}', 'bootstrap')");
  return log;
}

/** True while any paper/benchmark portfolio is still waiting for its starting capital. */
export async function hasUnfundedPortfolios(db: Db): Promise<boolean> {
  return !!(await maybeOne(
    db,
    `SELECT 1 FROM portfolios p WHERE p.kind IN ('PAPER','BENCHMARK') AND p.status <> 'ARCHIVED'
       AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.portfolio_id = p.id AND l.reference = 'initial-deposit')`,
  ));
}
