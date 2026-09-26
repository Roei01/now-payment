import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest/backtester.js";
import { SimulatedMarketData } from "../src/market/simulated.js";
import { STRATEGY_SEEDS } from "../src/strategies/registry.js";
import { DEFAULT_COSTS } from "../src/risk/policy.js";
import type { StrategyVersionRow } from "../src/strategies/types.js";
import { asset } from "./fixtures.js";

function version(code: string): StrategyVersionRow {
  const s = STRATEGY_SEEDS.find((x) => x.code === code)!;
  return { id: code, strategy_id: code, code, name: s.name, version: 1, params: s.version.params, universe: s.version.universe, horizon_days: s.version.horizonDays, rules: s.version.rules, requires_ai: s.version.requiresAi, change_reason: "", created_at: new Date() };
}

async function data() {
  const sim = new SimulatedMarketData();
  const symbols = ["SPY", "QQQ", "IWM", "EFA", "VWO", "TLT", "IEF", "GLD", "SHY", "VTI", "BND"];
  const raw = await sim.getDailyBars(symbols, "2023-01-01", "2025-12-31");
  const assets = new Map(symbols.map((s) => [s, asset(s, { sector: s === "SHY" ? "BOND_SHORT" : s === "TLT" ? "BOND_TREASURY_LONG" : s === "BND" ? "BOND_AGG" : `S_${s}` })]));
  return { bars: new Map(Object.entries(raw)), assets };
}

describe("backtester", () => {
  it("is deterministic", async () => {
    const { bars, assets } = await data();
    const input = { version: version("TREND_ROTATION"), bars, assets, start: "2024-06-01", end: "2025-06-30", initialUsd: 54, costs: DEFAULT_COSTS, simulatedData: true };
    const a = runBacktest(input);
    const b = runBacktest(input);
    expect(a.hash).toBe(b.hash);
    expect(a.trades).toBeGreaterThan(0);
    expect(a.limitations.join(" ")).toMatch(/SIMULATED/);
  });

  it("has no look-ahead: changing future prices does not change earlier equity", async () => {
    const { bars, assets } = await data();
    const input = { version: version("DEFENSIVE_REBALANCE"), bars, assets, start: "2024-06-01", end: "2025-06-30", initialUsd: 54, costs: DEFAULT_COSTS, simulatedData: true };
    const base = runBacktest(input);
    const shocked = new Map([...bars].map(([s, l]) => [s, l.map((b) => (b.ts.toISOString() > "2025-03-01" ? { ...b, open: b.open * 0.5, close: b.close * 0.5, high: b.high * 0.5, low: b.low * 0.5 } : b))]));
    const alt = runBacktest({ ...input, bars: shocked });
    const cut = base.equity.findIndex((e) => e.date > "2025-03-01");
    expect(alt.equity.slice(0, cut)).toEqual(base.equity.slice(0, cut));
  });

  it("refuses to backtest AI-dependent strategies", async () => {
    const { bars, assets } = await data();
    expect(() => runBacktest({ version: version("VALUE_DISCOUNT_AI"), bars, assets, start: "2024-06-01", end: "2025-06-30", initialUsd: 54, costs: DEFAULT_COSTS, simulatedData: true })).toThrow(/future/);
  });
});
