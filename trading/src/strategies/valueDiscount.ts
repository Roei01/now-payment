import type { Strategy, StrategyContext, StrategyOutput, AiCandidate } from "./types.js";
import { high, tradingDaysBetween } from "./indicators.js";

/**
 * "Buy below estimated value, sell above it." Code screens for candidates only;
 * the AI manager must supply a sourced valuation range, and code then checks the
 * margin of safety. A lower price alone is never a buy signal.
 */
export const ValueDiscountAi: Strategy = {
  code: "VALUE_DISCOUNT_AI",
  evaluate(ctx: StrategyContext): StrategyOutput {
    const p = ctx.version.params as {
      minDiscountFromHigh: number;
      maxCandidatesPerCycle: number;
      reviewEveryDays: number;
      maxPositions: number;
    };
    const signals: StrategyOutput["signals"] = [];
    const candidates: AiCandidate[] = [];
    const held = [...ctx.state.positions.keys()];
    // Periodic thesis review of existing holdings.
    for (const symbol of held) {
      candidates.push({ symbol, mode: "REVIEW", screen: { reason: "periodic holding review", reviewEveryDays: p.reviewEveryDays } });
    }
    if (held.length < p.maxPositions) {
      const screened: { symbol: string; discount: number }[] = [];
      for (const symbol of ctx.version.universe) {
        if (held.includes(symbol)) continue;
        const a = ctx.assets.get(symbol);
        if (!a || a.asset_class !== "STOCK") continue; // ETFs need a different valuation method (not in v1)
        const bars = ctx.snapshot.bars.get(symbol) ?? [];
        const hi = high(bars, 252);
        const last = bars.at(-1)?.close;
        if (!hi || !last || bars.length < 200) continue;
        const discount = 1 - last / hi;
        signals.push({ symbol, kind: "DISCOUNT_FROM_52W_HIGH", value: discount });
        if (discount >= p.minDiscountFromHigh) screened.push({ symbol, discount });
      }
      screened.sort((a, b) => b.discount - a.discount);
      for (const s of screened.slice(0, p.maxCandidatesPerCycle))
        candidates.push({ symbol: s.symbol, mode: "ENTRY", screen: { discountFrom52wHigh: s.discount, note: "screen only — not a buy signal" } });
    }
    return {
      targets: null,
      signals,
      rationale: candidates.length ? `${candidates.length} מועמדים לבדיקת מנהל ההשקעות` : "אף מניה לא עברה את הסינון",
      evidence: { held, lastTradeDaysAgo: ctx.lastTradeAt ? tradingDaysBetween(ctx.lastTradeAt, ctx.snapshot.asOf) : null },
      aiCandidates: candidates,
    };
  },
};
