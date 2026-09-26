import { query, maybeOne, type Db } from "../db/pool.js";
import { seedAssets } from "../assets/universe.js";
import { latestVersion, seedStrategies, assignStrategy } from "../strategies/registry.js";
import type { FxProvider } from "../market/types.js";
import { D } from "../lib/money.js";

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
export const FX_CONVERSION_COST_BPS = 25; // assumption, recorded per portfolio

/**
 * Idempotent: seeds assets, strategies and portfolios, and funds each paper/benchmark
 * portfolio with 200 ₪ converted at a documented USD/ILS rate (conversion cost booked).
 */
export async function bootstrap(db: Db, fx: FxProvider, now = new Date()): Promise<string[]> {
  const log: string[] = [];
  await seedAssets(db);
  await seedStrategies(db);
  const rate = await fx.getUsdIls();
  for (const s of PORTFOLIO_SEEDS) {
    let p = await maybeOne<{ id: string }>(db, "SELECT id FROM portfolios WHERE code = $1", [s.code]);
    if (!p) {
      const funded = s.kind !== "LIVE";
      const usd = funded ? D(PAPER_CAPITAL_ILS).div(rate.rate) : null;
      p = await maybeOne<{ id: string }>(
        db,
        `INSERT INTO portfolios (code, name, kind, execution_venue, status, initial_capital_ils, initial_fx_rate, fx_rate_source, fx_rate_as_of,
            fx_conversion_cost_bps, initial_capital_usd, started_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          s.code,
          s.name,
          s.kind,
          s.venue,
          s.kind === "LIVE" ? "DORMANT" : "ACTIVE",
          funded ? PAPER_CAPITAL_ILS : null,
          funded ? rate.rate : null,
          funded ? rate.source : null,
          funded ? rate.asOf : null,
          funded ? FX_CONVERSION_COST_BPS : 0,
          usd ? usd.toFixed(6) : null,
          funded ? now : null,
        ],
      );
      log.push(`created portfolio ${s.code}`);
      if (funded && usd) {
        await query(
          db,
          `INSERT INTO ledger_entries (portfolio_id, entry_type, cash_delta, currency, reference, occurred_at, memo)
           VALUES ($1, 'INITIAL_DEPOSIT', $2, 'USD', 'initial-deposit', $3, $4)`,
          [p!.id, usd.toFixed(6), now, `${PAPER_CAPITAL_ILS} ILS @ ${rate.rate} (${rate.source})`],
        );
        const cost = usd.times(FX_CONVERSION_COST_BPS).div(10_000);
        await query(
          db,
          `INSERT INTO ledger_entries (portfolio_id, entry_type, cash_delta, currency, reference, occurred_at, memo)
           VALUES ($1, 'FX_COST', $2, 'USD', 'initial-fx-cost', $3, $4)`,
          [p!.id, cost.neg().toFixed(6), now, `assumed conversion cost ${FX_CONVERSION_COST_BPS} bps`],
        );
      }
      if (s.kind === "LIVE")
        await query(db, "INSERT INTO broker_connections (portfolio_id, provider, environment, key_env_var, secret_env_var) VALUES ($1, 'alpaca', 'live', 'BROKER_LIVE_KEY', 'BROKER_LIVE_SECRET')", [p!.id]);
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
