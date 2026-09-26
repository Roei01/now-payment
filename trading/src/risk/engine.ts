import { D, Decimal, ZERO, floorQty } from "../lib/money.js";
import { assetPolicyViolations, type AssetRow } from "../assets/universe.js";
import type { MarketSnapshot } from "../market/types.js";
import { minutesBetween } from "../lib/time.js";
import { availableCash, priceFor, sellableQty, valuate, type PortfolioState } from "../portfolio/state.js";
import type { RiskStats } from "./stats.js";
import type { RiskPolicy } from "./policy.js";

export interface OrderProposal {
  symbol: string;
  side: "BUY" | "SELL";
  qty: Decimal;
  orderType: "MARKET" | "LIMIT";
  limitPrice?: number;
  /** Explicit, recorded reason when adding to a position that is below cost. */
  addToLoserJustification?: string;
  source: "STRATEGY_TARGET" | "AI_DECISION" | "REBALANCE";
}

export interface RiskReason {
  code: string;
  message: string;
}

export interface RiskContext {
  state: PortfolioState;
  snapshot: MarketSnapshot;
  assets: Map<string, AssetRow>;
  stats: Map<string, RiskStats>;
  policy: RiskPolicy;
  /** System/portfolio level blockers (kill switch, maintenance, paused portfolio, unknown broker state…). */
  blockers: string[];
}

export interface RiskResult {
  result: "ALLOW" | "REJECT" | "RESIZE";
  approvedQty: Decimal;
  estPrice: number;
  reservedCash: Decimal;
  reasons: RiskReason[];
  metrics: Record<string, unknown>;
}

export function estimateFee(policy: RiskPolicy, side: "BUY" | "SELL", notional: Decimal): Decimal {
  const c = policy.costs;
  const reg = side === "SELL" ? notional.times(c.sellRegulatoryFeeBps).div(10_000) : ZERO;
  return D(c.commissionPerOrderUsd).plus(reg);
}

/** Price used for sizing / cash reservation: the side of the book we would pay. */
export function executionPrice(snapshot: MarketSnapshot, symbol: string, side: "BUY" | "SELL"): number | undefined {
  const q = snapshot.quotes.get(symbol);
  if (q) {
    if (side === "BUY" && q.ask && q.ask > 0) return q.ask;
    if (side === "SELL" && q.bid && q.bid > 0) return q.bid;
    return q.last;
  }
  return undefined;
}

function scenarioShock(code: string, asset: AssetRow, st: RiskStats | undefined, isWorstSingle: boolean): number {
  const beta = st ? Math.max(-0.5, Math.min(2, st.beta)) : 1.5; // unknown => conservative
  const vol = st ? st.annualVol : 0.8;
  const sector = asset.sector;
  const isBond = sector.startsWith("BOND");
  const isLong = sector === "BOND_TREASURY_LONG";
  switch (code) {
    case "MARKET_CRASH":
      if (isBond) return isLong ? -0.1 : -0.05;
      if (sector === "GOLD") return -0.15;
      return Math.max(-0.95, Math.min(-0.2, beta * -0.35));
    case "RATES_SHOCK":
      if (isLong) return -0.25;
      if (sector === "BOND_TREASURY") return -0.1;
      if (sector === "BOND_AGG") return -0.12;
      if (sector === "BOND_SHORT") return -0.02;
      if (sector === "GOLD") return -0.05;
      return -0.15;
    case "SINGLE_NAME":
      return asset.asset_class === "STOCK" && isWorstSingle ? -0.5 : 0;
    case "CORRELATED_VOL":
      return -Math.min(0.9, 2.5 * vol);
    case "COMBINED": {
      const mkt = isBond ? -0.05 : sector === "GOLD" ? -0.1 : Math.max(-0.95, Math.min(-0.12, beta * -0.2));
      return asset.asset_class === "STOCK" && isWorstSingle ? Math.max(-0.95, mkt - 0.4) : mkt;
    }
    default:
      return 0;
  }
}

export interface ScenarioResult {
  code: string;
  loss: number;
}

/**
 * Portfolio loss under each stress scenario, computed in code from holdings
 * (never from a model's claim). Includes estimated exit costs.
 */
export function stressTest(
  holdings: Map<string, Decimal>,
  assets: Map<string, AssetRow>,
  stats: Map<string, RiskStats>,
  policy: RiskPolicy,
  scenarios = ["MARKET_CRASH", "RATES_SHOCK", "SINGLE_NAME", "CORRELATED_VOL", "COMBINED"],
): { worst: ScenarioResult; all: ScenarioResult[]; missingStats: string[] } {
  let largestStock: string | undefined;
  let largestVal = ZERO;
  for (const [s, v] of holdings) {
    if (assets.get(s)?.asset_class === "STOCK" && v.greaterThan(largestVal)) {
      largestVal = v;
      largestStock = s;
    }
  }
  const missing = [...holdings.keys()].filter((s) => !stats.has(s));
  const exitCostRate = (policy.costs.slippageBps + policy.costs.sellRegulatoryFeeBps) / 10_000;
  const all = scenarios.map((code) => {
    let loss = 0;
    for (const [s, v] of holdings) {
      const a = assets.get(s);
      if (!a) continue;
      const shock = scenarioShock(code, a, stats.get(s), s === largestStock);
      const value = v.toNumber();
      loss += -shock * value + value * (1 + shock) * exitCostRate;
    }
    return { code, loss };
  });
  const worst = all.reduce((a, b) => (b.loss > a.loss ? b : a), { code: "NONE", loss: 0 });
  return { worst, all, missingStats: missing };
}

function holdingValues(state: PortfolioState, snapshot: MarketSnapshot): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const p of state.positions.values()) {
    const px = priceFor(snapshot, p.symbol);
    out.set(p.symbol, px === undefined ? p.costBasis : p.qty.times(px));
  }
  return out;
}

interface Evaluation {
  ok: boolean;
  reasons: RiskReason[];
  metrics: Record<string, unknown>;
  reservedCash: Decimal;
}

function evaluateQty(ctx: RiskContext, p: OrderProposal, qty: Decimal, px: number, asset: AssetRow): Evaluation {
  const { state, snapshot, policy, assets, stats } = ctx;
  const reasons: RiskReason[] = [];
  const notional = qty.times(px);
  const fee = estimateFee(policy, p.side, notional);
  const reservePx = p.orderType === "LIMIT" && p.limitPrice ? Math.max(p.limitPrice, 0) : px * (1 + policy.costs.buyCashBufferBps / 10_000);
  const reservedCash = p.side === "BUY" ? qty.times(reservePx).plus(fee) : ZERO;
  const metrics: Record<string, unknown> = { notional: notional.toFixed(2), fee: fee.toFixed(4) };

  if (notional.lessThan(policy.minOrderUsd)) reasons.push({ code: "BELOW_MIN_ORDER", message: `notional ${notional.toFixed(2)} < min ${policy.minOrderUsd}` });
  if (policy.maxOrderUsd !== null && notional.greaterThan(policy.maxOrderUsd))
    reasons.push({ code: "ABOVE_MAX_ORDER", message: `notional ${notional.toFixed(2)} > max ${policy.maxOrderUsd}` });
  if (!asset.fractionable && !qty.isInteger()) reasons.push({ code: "FRACTIONAL_NOT_ALLOWED", message: `${asset.symbol} is not fractionable` });

  if (p.side === "SELL") {
    const sellable = sellableQty(state, p.symbol);
    if (qty.greaterThan(sellable))
      reasons.push({ code: "SELL_EXCEEDS_HOLDINGS", message: `sell ${qty} > unreserved holdings ${sellable} (no short selling)` });
    return { ok: reasons.length === 0, reasons, metrics, reservedCash };
  }

  // BUY: cash-only (no margin, no negative balance), after reservations for open orders and fees.
  const avail = availableCash(state);
  metrics.availableCash = avail.toFixed(2);
  if (reservedCash.greaterThan(avail))
    reasons.push({ code: "INSUFFICIENT_CASH", message: `requires ${reservedCash.toFixed(2)} (incl. buffer and fees), available ${avail.toFixed(2)}` });

  const val = valuate(state, snapshot);
  const holdings = holdingValues(state, snapshot);
  holdings.set(p.symbol, (holdings.get(p.symbol) ?? ZERO).plus(notional));
  const totalAfter = val.total.minus(fee).minus(notional.times(policy.costs.slippageBps).div(10_000));
  const posPct = holdings.get(p.symbol)!.div(totalAfter);
  const maxPos = asset.asset_class === "STOCK" ? policy.maxPositionPctStock : policy.maxPositionPctEtf;
  metrics.positionPctAfter = posPct.toFixed(4);
  if (posPct.greaterThan(maxPos)) reasons.push({ code: "POSITION_LIMIT", message: `${p.symbol} would be ${posPct.times(100).toFixed(1)}% > ${maxPos * 100}%` });

  let sectorVal = ZERO;
  for (const [s, v] of holdings) if (assets.get(s)?.sector === asset.sector) sectorVal = sectorVal.plus(v);
  const sectorPct = sectorVal.div(totalAfter);
  metrics.sectorPctAfter = sectorPct.toFixed(4);
  if (sectorPct.greaterThan(policy.maxSectorPct))
    reasons.push({ code: "SECTOR_LIMIT", message: `sector ${asset.sector} would be ${sectorPct.times(100).toFixed(1)}% > ${policy.maxSectorPct * 100}%` });

  if (policy.maxCapitalUsd !== null) {
    let invested = ZERO;
    for (const v of holdings.values()) invested = invested.plus(v);
    if (invested.greaterThan(policy.maxCapitalUsd))
      reasons.push({ code: "LIVE_CAPITAL_CAP", message: `invested ${invested.toFixed(2)} > cap ${policy.maxCapitalUsd}` });
  }

  // Risk budget over the whole holding period: estimated worst-case value vs initial capital.
  const stress = stressTest(holdings, assets, stats, policy);
  const initial = state.initialCapitalUsd;
  const worstValue = totalAfter.minus(stress.worst.loss);
  const lossFromInitialWorst = initial.isZero() ? D(1) : initial.minus(worstValue).div(initial);
  metrics.stress = stress.all.map((s) => ({ code: s.code, loss: s.loss.toFixed(2) }));
  metrics.worstScenario = stress.worst.code;
  metrics.currentLossFromInitialPct = initial.isZero() ? null : initial.minus(val.total).div(initial).toFixed(4);
  metrics.estimatedWorstLossFromInitialPct = lossFromInitialWorst.toFixed(4);
  if (stress.missingStats.includes(p.symbol))
    reasons.push({ code: "INSUFFICIENT_RISK_DATA", message: `not enough price history to estimate risk for ${p.symbol}; exposure increase refused` });
  if (lossFromInitialWorst.greaterThan(policy.riskBudgetPct))
    reasons.push({
      code: "RISK_BUDGET",
      message: `estimated worst-case loss from initial capital ${lossFromInitialWorst.times(100).toFixed(1)}% (${stress.worst.code}) > budget ${policy.riskBudgetPct * 100}%`,
    });

  return { ok: reasons.length === 0, reasons, metrics, reservedCash };
}

/**
 * The hard risk gate. Runs in code, cannot be bypassed by a strategy or model,
 * and is identical for paper and live apart from the policy values.
 */
export function checkOrder(ctx: RiskContext, p: OrderProposal): RiskResult {
  const { snapshot, policy } = ctx;
  const reasons: RiskReason[] = [];
  const asset = ctx.assets.get(p.symbol);
  const reject = (extra: RiskReason[] = [], px = 0): RiskResult => ({
    result: "REJECT",
    approvedQty: ZERO,
    estPrice: px,
    reservedCash: ZERO,
    reasons: [...reasons, ...extra],
    metrics: {},
  });

  for (const b of ctx.blockers) reasons.push({ code: "BLOCKED", message: b });
  if (p.side === "BUY") for (const v of assetPolicyViolations(asset)) reasons.push({ code: v, message: `${p.symbol}: ${v}` });
  else if (!asset) reasons.push({ code: "ASSET_NOT_IN_REGISTRY", message: p.symbol });
  if (policy.allowedSymbols && p.side === "BUY" && !policy.allowedSymbols.includes(p.symbol))
    reasons.push({ code: "NOT_IN_LIVE_ALLOWLIST", message: p.symbol });
  if (!policy.allowedOrderTypes.includes(p.orderType)) reasons.push({ code: "ORDER_TYPE_NOT_ALLOWED", message: p.orderType });
  if (p.orderType === "LIMIT" && !(p.limitPrice && p.limitPrice > 0)) reasons.push({ code: "LIMIT_PRICE_REQUIRED", message: "limit order without price" });
  if (!p.qty.isFinite() || p.qty.lte(0)) reasons.push({ code: "INVALID_QTY", message: String(p.qty) });
  if (policy.requireMarketOpen && !snapshot.clock.isOpen) reasons.push({ code: "MARKET_CLOSED", message: "market is closed" });

  const q = snapshot.quotes.get(p.symbol);
  if (!q) reasons.push({ code: "NO_QUOTE", message: `no current quote for ${p.symbol}` });
  else if (snapshot.clock.isOpen && minutesBetween(q.publishedAt, snapshot.asOf) > policy.maxQuoteAgeMinutes)
    reasons.push({ code: "STALE_QUOTE", message: `${p.symbol} quote is ${minutesBetween(q.publishedAt, snapshot.asOf).toFixed(0)} min old` });
  if (snapshot.staleSymbols.includes(p.symbol)) reasons.push({ code: "STALE_DATA", message: p.symbol });

  // No automatic averaging down: adding to a losing position needs an explicit recorded reason.
  const pos = ctx.state.positions.get(p.symbol);
  const px = executionPrice(snapshot, p.symbol, p.side);
  if (p.side === "BUY" && pos && px !== undefined && !pos.qty.isZero()) {
    const avgCost = pos.costBasis.div(pos.qty);
    if (D(px).lessThan(avgCost.times(1 - policy.losingPositionThresholdPct)) && !p.addToLoserJustification)
      reasons.push({ code: "AVERAGING_DOWN_BLOCKED", message: `${p.symbol} is below average cost; adding requires an explicit justification` });
  }
  if (reasons.length > 0 || !asset || px === undefined) return reject([], px ?? 0);

  const first = evaluateQty(ctx, p, p.qty, px, asset);
  if (first.ok) return { result: "ALLOW", approvedQty: p.qty, estPrice: px, reservedCash: first.reservedCash, reasons: [], metrics: first.metrics };

  // Only size-dependent failures can be fixed by resizing a BUY.
  const resizable = new Set(["INSUFFICIENT_CASH", "POSITION_LIMIT", "SECTOR_LIMIT", "RISK_BUDGET", "ABOVE_MAX_ORDER", "LIVE_CAPITAL_CAP"]);
  if (p.side !== "BUY" || !first.reasons.every((r) => resizable.has(r.code)))
    return { ...reject(first.reasons, px), metrics: first.metrics };

  const decimals = asset.fractionable ? 6 : 0;
  let lo = ZERO;
  let hi = p.qty;
  for (let i = 0; i < 40; i++) {
    const mid = floorQty(lo.plus(hi).div(2), decimals);
    if (mid.lte(lo)) break;
    if (evaluateQty(ctx, p, mid, px, asset).ok) lo = mid;
    else hi = mid;
  }
  if (lo.isZero()) return { ...reject(first.reasons, px), metrics: first.metrics };
  const final = evaluateQty(ctx, p, lo, px, asset);
  if (!final.ok) return { ...reject(first.reasons, px), metrics: first.metrics };
  return {
    result: "RESIZE",
    approvedQty: lo,
    estPrice: px,
    reservedCash: final.reservedCash,
    reasons: first.reasons.map((r) => ({ ...r, message: `${r.message} → resized to ${lo}` })),
    metrics: final.metrics,
  };
}
