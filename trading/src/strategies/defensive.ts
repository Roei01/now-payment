import type { Strategy, StrategyContext, StrategyOutput } from "./types.js";

/** Static defensive allocation with drift-band rebalancing. */
export const DefensiveRebalance: Strategy = {
  code: "DEFENSIVE_REBALANCE",
  evaluate(ctx: StrategyContext): StrategyOutput {
    const p = ctx.version.params as { targets: Record<string, number>; driftBand: number };
    const targets = new Map(Object.entries(p.targets));
    let maxDrift = 0;
    const signals: StrategyOutput["signals"] = [];
    for (const [s, w] of targets) {
      const cur = ctx.valuation.weights.get(s)?.toNumber() ?? 0;
      signals.push({ symbol: s, kind: "WEIGHT_DRIFT", value: cur - w, payload: { current: cur, target: w } });
      maxDrift = Math.max(maxDrift, Math.abs(cur - w));
    }
    for (const [s, w] of ctx.valuation.weights) if (!targets.has(s)) maxDrift = Math.max(maxDrift, w.toNumber());
    const act = maxDrift > p.driftBand;
    return {
      targets: act ? targets : null,
      signals,
      rebalanceByDesign: true,
      rationale: act ? `Drift ${(maxDrift * 100).toFixed(1)}% exceeds band ${(p.driftBand * 100).toFixed(0)}%` : `Within band (max drift ${(maxDrift * 100).toFixed(1)}%)`,
      evidence: { maxDrift, band: p.driftBand },
    };
  },
};

/** Passive benchmark: buy once, hold. Never a promotion candidate. */
export const BenchmarkHold: Strategy = {
  code: "BENCHMARK_HOLD",
  evaluate(ctx: StrategyContext): StrategyOutput {
    const p = ctx.version.params as { symbol: string; weight: number };
    const w = ctx.valuation.weights.get(p.symbol)?.toNumber() ?? 0;
    const act = w < p.weight - 0.03;
    return {
      targets: act ? new Map([[p.symbol, p.weight]]) : null,
      signals: [{ symbol: p.symbol, kind: "BENCHMARK_WEIGHT", value: w }],
      rebalanceByDesign: true,
      rationale: act ? `Invest idle cash into ${p.symbol}` : "Holding benchmark",
      evidence: { weight: w },
    };
  },
};
