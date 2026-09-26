import { D, ZERO } from "../src/lib/money.js";
import type { AssetRow } from "../src/assets/universe.js";
import type { Bar, MarketSnapshot, Quote } from "../src/market/types.js";
import type { PortfolioRow, PortfolioState, Position } from "../src/portfolio/state.js";

export function asset(symbol: string, extra: Partial<AssetRow> = {}): AssetRow {
  return {
    id: symbol,
    symbol,
    exchange: "ARCA",
    market: "US",
    asset_class: "ETF",
    name: symbol,
    currency: "USD",
    price_unit: "USD",
    sector: symbol === "BND" ? "BOND_AGG" : `SECTOR_${symbol}`,
    is_leveraged: false,
    is_inverse: false,
    crypto_exposure: false,
    fractionable: true,
    verified: true,
    verified_source: "test",
    active: true,
    cik: null,
    ...extra,
  };
}

export function bars(start: number, drift: number, n = 300, vol = 0.01): Bar[] {
  const out: Bar[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000);
    const next = p * (1 + drift + vol * Math.sin(i * 1.7));
    out.push({ ts: d, open: p, high: Math.max(p, next), low: Math.min(p, next), close: next, volume: 1 });
    p = next;
  }
  return out;
}

export function snapshot(prices: Record<string, number>, opts: { open?: boolean; bars?: Map<string, Bar[]>; quoteAgeMin?: number } = {}): MarketSnapshot {
  const asOf = new Date("2026-06-01T15:00:00Z");
  const quotes = new Map<string, Quote>();
  for (const [s, p] of Object.entries(prices))
    quotes.set(s, { symbol: s, bid: p * 0.9999, ask: p * 1.0001, last: p, publishedAt: new Date(asOf.getTime() - (opts.quoteAgeMin ?? 1) * 60_000) });
  return {
    asOf,
    batchId: null,
    provider: "test",
    simulated: true,
    clock: { isOpen: opts.open ?? true, sessionDate: "2026-06-01", nextOpen: asOf, nextClose: asOf, source: "test", approximate: true },
    quotes,
    bars: opts.bars ?? new Map(),
    staleSymbols: [],
    missingSymbols: [],
    fx: { base: "USD", quote: "ILS", rate: 3.7, source: "test", asOf },
  };
}

export function state(cash: number, positions: Record<string, { qty: number; cost: number }> = {}, initial = 100): PortfolioState {
  const pos = new Map<string, Position>();
  for (const [s, p] of Object.entries(positions)) pos.set(s, { assetId: s, symbol: s, qty: D(p.qty), costBasis: D(p.cost), openedAt: new Date() });
  return {
    portfolio: { id: "p", code: "P", kind: "PAPER", status: "ACTIVE", initial_capital_usd: String(initial) } as PortfolioRow,
    cash: D(cash),
    positions: pos,
    realizedPnl: ZERO,
    feesCum: ZERO,
    trades: 0,
    reservedCash: ZERO,
    reservedQty: new Map(),
    initialCapitalUsd: D(initial),
  };
}
