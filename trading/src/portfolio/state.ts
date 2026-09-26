import { query, one, type Db } from "../db/pool.js";
import { D, Decimal, ZERO } from "../lib/money.js";
import type { MarketSnapshot } from "../market/types.js";
import { midPrice } from "../market/types.js";

export interface PortfolioRow {
  id: string;
  code: string;
  name: string;
  kind: "PAPER" | "LIVE" | "BENCHMARK";
  market: string;
  base_currency: string;
  execution_venue: "INTERNAL_SIM" | "ALPACA_PAPER" | "ALPACA_LIVE" | "NONE";
  status: string;
  run_id: string;
  initial_capital_ils: string | null;
  initial_fx_rate: string | null;
  fx_rate_source: string | null;
  fx_conversion_cost_bps: string;
  initial_capital_usd: string | null;
  risk_budget_pct: string;
  auto_promote: boolean;
  status_before_pause: string | null;
  started_at: Date | null;
  created_at: Date;
}

export interface Position {
  assetId: string;
  symbol: string;
  qty: Decimal;
  costBasis: Decimal; // total USD cost of the remaining qty (excl. fees)
  openedAt: Date;
}

export interface PortfolioState {
  portfolio: PortfolioRow;
  cash: Decimal;
  positions: Map<string, Position>;
  realizedPnl: Decimal;
  feesCum: Decimal;
  trades: number;
  reservedCash: Decimal; // for open BUY orders
  reservedQty: Map<string, Decimal>; // for open SELL orders
  initialCapitalUsd: Decimal;
}

export const OPEN_ORDER_STATUSES = ["PENDING_SUBMIT", "SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED", "UNKNOWN"];

export async function getPortfolio(db: Db, id: string): Promise<PortfolioRow> {
  return one<PortfolioRow>(db, "SELECT * FROM portfolios WHERE id = $1", [id]);
}

export async function listPortfolios(db: Db): Promise<PortfolioRow[]> {
  return query<PortfolioRow>(db, "SELECT * FROM portfolios ORDER BY kind DESC, code");
}

/** Derives state from the immutable ledger plus open orders (the ledger is the source of truth). */
export async function loadState(db: Db, portfolioId: string): Promise<PortfolioState> {
  const portfolio = await getPortfolio(db, portfolioId);
  const entries = await query<{
    entry_type: string;
    symbol: string | null;
    asset_id: string | null;
    qty_delta: string;
    cash_delta: string;
    occurred_at: Date;
  }>(
    db,
    `SELECT l.entry_type, a.symbol, l.asset_id, l.qty_delta, l.cash_delta, l.occurred_at
       FROM ledger_entries l LEFT JOIN assets a ON a.id = l.asset_id
      WHERE l.portfolio_id = $1 ORDER BY l.occurred_at, l.id`,
    [portfolioId],
  );
  let cash = ZERO;
  let realized = ZERO;
  let fees = ZERO;
  let trades = 0;
  const positions = new Map<string, Position>();
  for (const e of entries) {
    const qty = D(e.qty_delta);
    const cashDelta = D(e.cash_delta);
    cash = cash.plus(cashDelta);
    if (e.entry_type === "FEE" || e.entry_type === "FX_COST") fees = fees.plus(cashDelta.neg());
    if (!e.symbol || !e.asset_id) continue;
    const pos = positions.get(e.symbol) ?? { assetId: e.asset_id, symbol: e.symbol, qty: ZERO, costBasis: ZERO, openedAt: e.occurred_at };
    if (e.entry_type === "BUY") {
      trades++;
      if (pos.qty.isZero()) pos.openedAt = e.occurred_at;
      pos.qty = pos.qty.plus(qty);
      pos.costBasis = pos.costBasis.plus(cashDelta.neg());
    } else if (e.entry_type === "SELL") {
      trades++;
      const sold = qty.neg();
      const avg = pos.qty.isZero() ? ZERO : pos.costBasis.div(pos.qty);
      const costOut = avg.times(sold);
      realized = realized.plus(cashDelta.minus(costOut));
      pos.qty = pos.qty.minus(sold);
      pos.costBasis = pos.costBasis.minus(costOut);
    } else if (e.entry_type === "SPLIT" || e.entry_type === "RECONCILE_ADJUSTMENT") {
      pos.qty = pos.qty.plus(qty);
    } else if (e.entry_type === "DIVIDEND") {
      realized = realized.plus(cashDelta);
    }
    if (pos.qty.abs().lessThan("1e-9")) positions.delete(e.symbol);
    else positions.set(e.symbol, pos);
  }
  const open = await query<{ side: string; symbol: string; qty: string; filled_qty: string; reserved_cash: string }>(
    db,
    `SELECT o.side, a.symbol, o.qty, o.filled_qty, o.reserved_cash FROM orders o JOIN assets a ON a.id = o.asset_id
      WHERE o.portfolio_id = $1 AND o.status = ANY($2)`,
    [portfolioId, OPEN_ORDER_STATUSES],
  );
  let reservedCash = ZERO;
  const reservedQty = new Map<string, Decimal>();
  for (const o of open) {
    const remaining = D(o.qty).minus(o.filled_qty);
    if (o.side === "BUY") {
      const frac = D(o.qty).isZero() ? ZERO : remaining.div(o.qty);
      reservedCash = reservedCash.plus(D(o.reserved_cash).times(frac));
    } else reservedQty.set(o.symbol, (reservedQty.get(o.symbol) ?? ZERO).plus(remaining));
  }
  return {
    portfolio,
    cash,
    positions,
    realizedPnl: realized,
    feesCum: fees,
    trades,
    reservedCash,
    reservedQty,
    initialCapitalUsd: D(portfolio.initial_capital_usd),
  };
}

export function priceFor(snapshot: MarketSnapshot, symbol: string): number | undefined {
  const q = snapshot.quotes.get(symbol);
  if (q) return midPrice(q);
  return snapshot.bars.get(symbol)?.at(-1)?.close;
}

export interface Valuation {
  cash: Decimal;
  positionsValue: Decimal;
  total: Decimal;
  unrealizedPnl: Decimal;
  weights: Map<string, Decimal>;
  missingPrices: string[];
}

export function valuate(state: PortfolioState, snapshot: MarketSnapshot): Valuation {
  let positionsValue = ZERO;
  let unrealized = ZERO;
  const missing: string[] = [];
  const values = new Map<string, Decimal>();
  for (const p of state.positions.values()) {
    const px = priceFor(snapshot, p.symbol);
    if (px === undefined) {
      missing.push(p.symbol);
      values.set(p.symbol, p.costBasis);
      positionsValue = positionsValue.plus(p.costBasis);
      continue;
    }
    const v = p.qty.times(px);
    values.set(p.symbol, v);
    positionsValue = positionsValue.plus(v);
    unrealized = unrealized.plus(v.minus(p.costBasis));
  }
  const total = state.cash.plus(positionsValue);
  const weights = new Map<string, Decimal>();
  for (const [s, v] of values) weights.set(s, total.isZero() ? ZERO : v.div(total));
  return { cash: state.cash, positionsValue, total, unrealizedPnl: unrealized, weights, missingPrices: missing };
}

export function availableCash(state: PortfolioState): Decimal {
  return state.cash.minus(state.reservedCash);
}

export function sellableQty(state: PortfolioState, symbol: string): Decimal {
  const pos = state.positions.get(symbol);
  if (!pos) return ZERO;
  const r = state.reservedQty.get(symbol) ?? ZERO;
  const q = pos.qty.minus(r);
  return q.isNegative() ? ZERO : q;
}
