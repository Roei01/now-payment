import { query, maybeOne, type Db } from "../db/pool.js";
import { loadAssets } from "../assets/universe.js";
import { ensureDailyBars } from "../market/service.js";
import type { Bar, MarketDataProvider } from "../market/types.js";
import { getStrategyVersion } from "../strategies/registry.js";
import { DEFAULT_COSTS } from "../risk/policy.js";
import { runBacktest, splitRange, type BacktestResult } from "./backtester.js";

export async function runStoredBacktest(
  db: Db,
  provider: MarketDataProvider,
  args: { strategyVersionId: string; start: string; end: string; split: "DEV" | "TEST" | "FULL"; initialUsd?: number; experimentId?: string },
): Promise<{ id: string; result: BacktestResult }> {
  const version = await getStrategyVersion(db, args.strategyVersionId);
  const assets = await loadAssets(db);
  const symbols = new Set([...version.universe, "SPY"]);
  const needed = [...assets.values()].filter((a) => symbols.has(a.symbol));
  await ensureDailyBars(db, provider, needed, new Date());
  const rows = await query<{ symbol: string; ts: Date; open: string; high: string; low: string; close: string; volume: string }>(
    db,
    `SELECT a.symbol, b.ts, b.open, b.high, b.low, b.close, b.volume FROM market_bars b JOIN assets a ON a.id = b.asset_id
      WHERE b.provider = $1 AND b.timeframe = '1Day' AND a.symbol = ANY($2) ORDER BY a.symbol, b.ts`,
    [provider.name, [...symbols]],
  );
  const bars = new Map<string, Bar[]>();
  for (const r of rows) {
    const l = bars.get(r.symbol) ?? [];
    l.push({ ts: r.ts, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume });
    bars.set(r.symbol, l);
  }
  const range = args.split === "FULL" ? [args.start, args.end] : splitRange(args.start, args.end)[args.split === "DEV" ? "dev" : "test"];
  const result = runBacktest({
    version,
    bars,
    assets,
    start: range[0]!,
    end: range[1]!,
    initialUsd: args.initialUsd ?? 54,
    costs: DEFAULT_COSTS,
    simulatedData: provider.simulated,
  });
  const row = await maybeOne<{ id: string }>(
    db,
    `INSERT INTO backtest_runs (strategy_version_id, experiment_id, split, start_date, end_date, cost_model, result, result_hash, simulated_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [version.id, args.experimentId ?? null, args.split, result.start, result.end, JSON.stringify(DEFAULT_COSTS), JSON.stringify(result), result.hash, provider.simulated],
  );
  return { id: row!.id, result };
}
