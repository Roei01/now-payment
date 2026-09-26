import { D, ZERO } from "../lib/money.js";
import { sha256 } from "../lib/crypto.js";
import { isoDate } from "../lib/time.js";
import type { AssetRow } from "../assets/universe.js";
import type { Bar, MarketSnapshot, Quote } from "../market/types.js";
import type { PortfolioRow, PortfolioState, Position } from "../portfolio/state.js";
import { valuate } from "../portfolio/state.js";
import { STRATEGIES } from "../strategies/registry.js";
import type { StrategyVersionRow } from "../strategies/types.js";
import { computeAllRiskStats } from "../risk/stats.js";
import { checkOrder, estimateFee } from "../risk/engine.js";
import { paperPolicy, type CostModel } from "../risk/policy.js";
import { diffToTrades } from "../engine/sizing.js";
import { maxDrawdown, meanStd } from "../promotion/stats.js";

export interface BacktestInput {
  version: StrategyVersionRow;
  bars: Map<string, Bar[]>; // full history, ascending
  assets: Map<string, AssetRow>;
  start: string;
  end: string;
  initialUsd: number;
  costs: CostModel;
  benchmarkSymbol?: string;
  simulatedData: boolean;
}

export interface BacktestResult {
  start: string;
  end: string;
  days: number;
  finalValue: number;
  totalReturn: number;
  cagr: number;
  annualVol: number;
  maxDrawdown: number;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  trades: number;
  fees: number;
  rejectedOrders: number;
  equity: { date: string; value: number; benchmark: number | null }[];
  limitations: string[];
  hash: string;
}

const LIMITATIONS = [
  "Signals use only bars available before each trading day; orders fill at that day's open plus slippage (no look-ahead).",
  "Universe is today's list — survivorship bias is possible.",
  "Adjusted bars (splits/dividends) approximate total return; corporate-action timing is not point-in-time.",
  "Execution costs are model assumptions; real fills and paper fills can differ.",
];

/**
 * Deterministic backtest for rule-based strategy versions, using the same
 * strategy code, sizing and hard risk gate as the live cycle.
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  const { version } = input;
  if (version.requires_ai)
    throw new Error("AI-dependent strategies are not backtested: a model can carry knowledge of the future from training data, so the result would not be a clean out-of-sample test.");
  const strategy = STRATEGIES[version.code];
  if (!strategy) throw new Error(`unknown strategy ${version.code}`);
  const bench = input.benchmarkSymbol ?? "SPY";
  const calendar = (input.bars.get(bench) ?? []).map((b) => isoDate(b.ts)).filter((d) => d >= input.start && d <= input.end);
  const policy = paperPolicy({ costs: input.costs, maxQuoteAgeMinutes: 10_000 });
  const portfolio = { id: "backtest", code: "BT", kind: "PAPER", status: "ACTIVE", initial_capital_usd: String(input.initialUsd) } as PortfolioRow;
  let cash = D(input.initialUsd);
  const positions = new Map<string, Position>();
  let trades = 0;
  let fees = ZERO;
  let rejected = 0;
  let lastTradeAt: Date | null = null;
  const equity: BacktestResult["equity"] = [];
  const index = new Map<string, Map<string, number>>();
  for (const [s, list] of input.bars) index.set(s, new Map(list.map((b, i) => [isoDate(b.ts), i])));

  for (const day of calendar) {
    const dayDate = new Date(`${day}T14:30:00Z`);
    const past = new Map<string, Bar[]>();
    const quotes = new Map<string, Quote>();
    for (const [s, list] of input.bars) {
      const i = index.get(s)!.get(day);
      if (i === undefined) continue;
      past.set(s, list.slice(0, i));
      const open = list[i]!.open;
      const half = open * 0.0001;
      quotes.set(s, { symbol: s, bid: open - half, ask: open + half, last: open, publishedAt: dayDate });
    }
    const snapshot: MarketSnapshot = {
      asOf: dayDate,
      batchId: null,
      provider: "backtest",
      simulated: input.simulatedData,
      clock: { isOpen: true, sessionDate: day, nextOpen: dayDate, nextClose: dayDate, source: "backtest", approximate: true },
      quotes,
      bars: past,
      staleSymbols: [],
      missingSymbols: [],
      fx: { base: "USD", quote: "ILS", rate: 1, source: "n/a", asOf: dayDate },
    };
    const state = (): PortfolioState => ({
      portfolio,
      cash,
      positions,
      realizedPnl: ZERO,
      feesCum: fees,
      trades,
      reservedCash: ZERO,
      reservedQty: new Map(),
      initialCapitalUsd: D(input.initialUsd),
    });
    const stats = computeAllRiskStats(past, bench);
    const out = strategy.evaluate({ snapshot, state: state(), valuation: valuate(state(), snapshot), assets: input.assets, stats, version, lastTradeAt });
    if (out.targets) {
      const intents = diffToTrades(out.targets, state(), valuate(state(), snapshot), snapshot, input.assets, { minTradeUsd: policy.minOrderUsd, minTradePctOfValue: 0.02 });
      for (const t of intents) {
        const risk = checkOrder(
          { state: state(), snapshot, assets: input.assets, stats, policy, blockers: [] },
          { symbol: t.symbol, side: t.side, qty: t.qty, orderType: "MARKET", source: "STRATEGY_TARGET", addToLoserJustification: out.rebalanceByDesign ? "rebalance" : undefined },
        );
        if (risk.result === "REJECT") {
          rejected++;
          continue;
        }
        const slip = input.costs.slippageBps / 10_000;
        const px = t.side === "BUY" ? risk.estPrice * (1 + slip) : risk.estPrice * (1 - slip);
        const qty = risk.approvedQty;
        const notional = qty.times(px);
        const fee = estimateFee(policy, t.side, notional);
        const pos = positions.get(t.symbol) ?? { assetId: t.symbol, symbol: t.symbol, qty: ZERO, costBasis: ZERO, openedAt: dayDate };
        if (t.side === "BUY") {
          if (notional.plus(fee).greaterThan(cash)) {
            rejected++;
            continue;
          }
          cash = cash.minus(notional).minus(fee);
          pos.costBasis = pos.costBasis.plus(notional);
          pos.qty = pos.qty.plus(qty);
        } else {
          const avg = pos.qty.isZero() ? ZERO : pos.costBasis.div(pos.qty);
          cash = cash.plus(notional).minus(fee);
          pos.costBasis = pos.costBasis.minus(avg.times(qty));
          pos.qty = pos.qty.minus(qty);
        }
        fees = fees.plus(fee);
        trades++;
        lastTradeAt = dayDate;
        if (pos.qty.lte("1e-9")) positions.delete(t.symbol);
        else positions.set(t.symbol, pos);
      }
    }
    // Mark to the day's close.
    let value = cash;
    for (const p of positions.values()) {
      const i = index.get(p.symbol)!.get(day);
      const close = i === undefined ? undefined : input.bars.get(p.symbol)![i]!.close;
      value = value.plus(close === undefined ? p.costBasis : p.qty.times(close));
    }
    const bi = index.get(bench)?.get(day);
    equity.push({ date: day, value: Number(value.toFixed(6)), benchmark: bi === undefined ? null : input.bars.get(bench)![bi]!.close });
  }

  const values = equity.map((e) => e.value);
  const rets = values.slice(1).map((v, i) => v / values[i]! - 1);
  const { sd } = meanStd(rets);
  const finalValue = values.at(-1) ?? input.initialUsd;
  const totalReturn = finalValue / input.initialUsd - 1;
  const years = Math.max(equity.length / 252, 1 / 252);
  const b0 = equity.find((e) => e.benchmark !== null)?.benchmark ?? null;
  const b1 = [...equity].reverse().find((e) => e.benchmark !== null)?.benchmark ?? null;
  const benchmarkReturn = b0 && b1 ? b1 / b0 - 1 : null;
  const core = {
    start: calendar[0] ?? input.start,
    end: calendar.at(-1) ?? input.end,
    days: equity.length,
    finalValue,
    totalReturn,
    cagr: (1 + totalReturn) ** (1 / years) - 1,
    annualVol: sd * Math.sqrt(252),
    maxDrawdown: maxDrawdown([input.initialUsd, ...values]),
    benchmarkReturn,
    excessReturn: benchmarkReturn === null ? null : totalReturn - benchmarkReturn,
    trades,
    fees: Number(fees.toFixed(6)),
    rejectedOrders: rejected,
    equity,
    limitations: input.simulatedData ? [...LIMITATIONS, "SIMULATED price data — not evidence of anything."] : LIMITATIONS,
  };
  return { ...core, hash: sha256(JSON.stringify(core)) };
}

/** Development / untouched-test split by date (default 70/30). */
export function splitRange(start: string, end: string, devFraction = 0.7): { dev: [string, string]; test: [string, string] } {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  const cut = new Date(s + (e - s) * devFraction);
  const cutStr = isoDate(cut);
  return { dev: [start, cutStr], test: [isoDate(new Date(cut.getTime() + 86_400_000)), end] };
}

