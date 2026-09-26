import { D, Decimal, floorQty } from "../lib/money.js";
import type { AssetRow } from "../assets/universe.js";
import type { MarketSnapshot } from "../market/types.js";
import { sellableQty, type PortfolioState, type Valuation } from "../portfolio/state.js";
import { executionPrice } from "../risk/engine.js";

export interface TradeIntent {
  symbol: string;
  side: "BUY" | "SELL";
  qty: Decimal;
  price: number;
  targetWeight: number;
  currentWeight: number;
}

/**
 * Converts target weights into the minimal set of trades (sells first). Only the
 * difference from the current holdings is traded — history is never replayed.
 */
export function diffToTrades(
  targets: Map<string, number>,
  state: PortfolioState,
  valuation: Valuation,
  snapshot: MarketSnapshot,
  assets: Map<string, AssetRow>,
  opts: { minTradeUsd: number; minTradePctOfValue: number },
): TradeIntent[] {
  const total = valuation.total;
  const threshold = Decimal.max(D(opts.minTradeUsd), total.times(opts.minTradePctOfValue));
  const sells: TradeIntent[] = [];
  const buys: TradeIntent[] = [];
  const symbols = new Set([...targets.keys(), ...state.positions.keys()]);
  for (const symbol of symbols) {
    const target = targets.get(symbol) ?? 0;
    const current = valuation.weights.get(symbol)?.toNumber() ?? 0;
    const diffValue = total.times(target - current);
    if (diffValue.abs().lessThan(threshold) && !(target === 0 && state.positions.has(symbol))) continue;
    const asset = assets.get(symbol);
    const decimals = asset?.fractionable ? 6 : 0;
    if (diffValue.isNegative()) {
      const px = executionPrice(snapshot, symbol, "SELL");
      if (!px) continue;
      const sellable = sellableQty(state, symbol);
      const qty = target === 0 ? sellable : Decimal.min(sellable, floorQty(diffValue.abs().div(px), decimals));
      if (qty.gt(0)) sells.push({ symbol, side: "SELL", qty, price: px, targetWeight: target, currentWeight: current });
    } else {
      const px = executionPrice(snapshot, symbol, "BUY");
      if (!px) continue;
      const qty = floorQty(diffValue.div(px), decimals);
      if (qty.gt(0)) buys.push({ symbol, side: "BUY", qty, price: px, targetWeight: target, currentWeight: current });
    }
  }
  return [...sells, ...buys];
}
