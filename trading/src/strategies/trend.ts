import type { Strategy, StrategyContext, StrategyOutput } from "./types.js";
import { momentum, sma, tradingDaysBetween } from "./indicators.js";

/**
 * Trend / momentum rotation across broad ETFs: hold the strongest assets that
 * trade above their long moving average; the rest goes to a short-bond proxy or cash.
 */
export const TrendRotation: Strategy = {
  code: "TREND_ROTATION",
  evaluate(ctx: StrategyContext): StrategyOutput {
    const p = ctx.version.params as {
      lookbackDays: number;
      skipDays: number;
      smaDays: number;
      topN: number;
      weightEach: number;
      cashProxy: string | null;
      rebalanceDays: number;
      driftBand: number;
    };
    const signals: StrategyOutput["signals"] = [];
    const scored: { symbol: string; mom: number }[] = [];
    for (const symbol of ctx.version.universe) {
      if (symbol === p.cashProxy) continue;
      const bars = ctx.snapshot.bars.get(symbol) ?? [];
      const mom = momentum(bars, p.lookbackDays, p.skipDays);
      const ma = sma(bars, p.smaDays);
      const last = bars.at(-1)?.close;
      if (mom === undefined || ma === undefined || last === undefined) {
        signals.push({ symbol, kind: "INSUFFICIENT_HISTORY", payload: { bars: bars.length } });
        continue;
      }
      const aboveTrend = last > ma;
      signals.push({ symbol, kind: "MOMENTUM", value: mom, payload: { sma: ma, last, aboveTrend } });
      if (aboveTrend && mom > 0) scored.push({ symbol, mom });
    }
    scored.sort((a, b) => b.mom - a.mom);
    const chosen = scored.slice(0, p.topN);
    const targets = new Map<string, number>();
    for (const c of chosen) targets.set(c.symbol, p.weightEach);
    const used = chosen.length * p.weightEach;
    if (p.cashProxy && used < 0.95 && ctx.snapshot.bars.get(p.cashProxy)?.length) targets.set(p.cashProxy, Math.min(0.6, 0.95 - used));

    const due = !ctx.lastTradeAt || tradingDaysBetween(ctx.lastTradeAt, ctx.snapshot.asOf) >= p.rebalanceDays;
    let maxDrift = 0;
    for (const s of new Set([...targets.keys(), ...ctx.valuation.weights.keys()])) {
      maxDrift = Math.max(maxDrift, Math.abs((targets.get(s) ?? 0) - (ctx.valuation.weights.get(s)?.toNumber() ?? 0)));
    }
    const act = due || (ctx.state.positions.size === 0 && targets.size > 0) || maxDrift > p.driftBand * 2;
    return {
      targets: act ? targets : null,
      signals,
      rationale: act
        ? `Rotation: ${chosen.map((c) => `${c.symbol} (${(c.mom * 100).toFixed(1)}%)`).join(", ") || "no asset above trend"}; max drift ${(maxDrift * 100).toFixed(1)}%`
        : `No rebalance due (last trade ${ctx.lastTradeAt?.toISOString().slice(0, 10) ?? "never"}, drift ${(maxDrift * 100).toFixed(1)}%)`,
      evidence: { ranking: scored, due, maxDrift },
    };
  },
};
