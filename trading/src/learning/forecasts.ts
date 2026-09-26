import { query, type Db } from "../db/pool.js";
import { addDays } from "../lib/time.js";
import type { ManagerDecision } from "../ai/contract.js";

export async function recordForecast(
  db: Db,
  args: {
    decisionId: string;
    portfolioId: string;
    assetId: string | null;
    strategyVersionId: string | null;
    modelVersion?: string | null;
    promptVersionId?: string | null;
    horizonDays: number;
    priceAtForecast: number | null;
    benchmarkAtForecast: number | null;
    ai?: ManagerDecision;
    sources?: unknown[];
    dataAsOf: Date;
  },
): Promise<void> {
  await query(
    db,
    `INSERT INTO forecast_snapshots (decision_id, portfolio_id, asset_id, strategy_version_id, model_version, prompt_version_id, horizon_days,
        price_at_forecast, benchmark_at_forecast, value_low, value_base, value_high, scenarios, failure_conditions, sources, data_as_of, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      args.decisionId,
      args.portfolioId,
      args.assetId,
      args.strategyVersionId,
      args.modelVersion ?? null,
      args.promptVersionId ?? null,
      args.horizonDays,
      args.priceAtForecast,
      args.benchmarkAtForecast,
      args.ai?.valuation.per_share_low ?? null,
      args.ai?.valuation.per_share_base ?? null,
      args.ai?.valuation.per_share_high ?? null,
      JSON.stringify(args.ai?.scenarios ?? {}),
      JSON.stringify(args.ai?.thesis_invalidation ?? []),
      JSON.stringify(args.sources ?? []),
      args.dataAsOf,
      addDays(args.dataAsOf, args.horizonDays),
    ],
  );
}

/**
 * Scores matured forecasts against realised prices (point-in-time closes after the
 * horizon). Immature forecasts are left alone — not counted as failures.
 */
export async function evaluateMaturedForecasts(db: Db, now: Date, benchmarkSymbol = "SPY"): Promise<number> {
  const due = await query<{
    id: string;
    asset_id: string | null;
    price_at_forecast: string | null;
    benchmark_at_forecast: string | null;
    value_low: string | null;
    value_high: string | null;
    due_at: Date;
  }>(
    db,
    `SELECT f.id, f.asset_id, f.price_at_forecast, f.benchmark_at_forecast, f.value_low, f.value_high, f.due_at
       FROM forecast_snapshots f LEFT JOIN forecast_outcomes o ON o.forecast_id = f.id
      WHERE o.id IS NULL AND f.due_at <= $1 LIMIT 200`,
    [now],
  );
  let n = 0;
  for (const f of due) {
    const px = f.asset_id
      ? await query<{ close: string }>(
          db,
          "SELECT close FROM market_bars WHERE asset_id = $1 AND timeframe = '1Day' AND ts >= $2 AND available_at <= $3 ORDER BY ts LIMIT 1",
          [f.asset_id, f.due_at, now],
        )
      : [];
    const bm = await query<{ close: string }>(
      db,
      `SELECT b.close FROM market_bars b JOIN assets a ON a.id = b.asset_id
        WHERE a.symbol = $1 AND b.timeframe = '1Day' AND b.ts >= $2 AND b.available_at <= $3 ORDER BY b.ts LIMIT 1`,
      [benchmarkSymbol, f.due_at, now],
    );
    if (!px[0] || !f.price_at_forecast) {
      if (now.getTime() - f.due_at.getTime() > 10 * 86_400_000)
        await query(db, "INSERT INTO forecast_outcomes (forecast_id, classification, notes) VALUES ($1, 'NO_PRICE', 'no price available after horizon')", [f.id]);
      continue;
    }
    const price = Number(px[0].close);
    const ret = price / Number(f.price_at_forecast) - 1;
    const bret = bm[0] && f.benchmark_at_forecast ? Number(bm[0].close) / Number(f.benchmark_at_forecast) - 1 : null;
    const excess = bret === null ? null : ret - bret;
    const within = f.value_low && f.value_high ? price >= Number(f.value_low) && price <= Number(f.value_high) : null;
    const classification = excess === null ? (ret >= 0 ? "THESIS_SUPPORTED" : "THESIS_CONTRADICTED") : Math.abs(excess) < 0.02 ? "MARKET_DRIVEN" : excess > 0 ? "THESIS_SUPPORTED" : "THESIS_CONTRADICTED";
    await query(
      db,
      `INSERT INTO forecast_outcomes (forecast_id, price_at_horizon, return_pct, benchmark_return_pct, excess_return_pct, within_range, classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (forecast_id) DO NOTHING`,
      [f.id, price, ret, bret, excess, within, classification],
    );
    n++;
  }
  return n;
}
