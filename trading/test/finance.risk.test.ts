import { describe, expect, it } from "vitest";
import { D, Decimal, ZERO } from "../src/lib/money.js";
import { checkOrder, executionPrice, estimateFee, stressTest, type OrderProposal } from "../src/risk/engine.js";
import { paperPolicy, type RiskPolicy } from "../src/risk/policy.js";
import type { RiskStats } from "../src/risk/stats.js";
import type { AssetRow } from "../src/assets/universe.js";
import { priceFor, type PortfolioState } from "../src/portfolio/state.js";
import { asset, snapshot, state } from "./fixtures.js";

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYMBOLS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"];
const SECTORS = ["TECH", "TECH", "BOND_AGG", "GOLD", "HEALTH", "BOND_TREASURY_LONG", "ENERGY", "TECH"];

interface Scenario {
  st: PortfolioState;
  snap: ReturnType<typeof snapshot>;
  assets: Map<string, AssetRow>;
  stats: Map<string, RiskStats>;
  policy: RiskPolicy;
  blockers: string[];
  proposal: OrderProposal;
}

function scenario(seed: number): Scenario {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const assets = new Map<string, AssetRow>();
  const prices: Record<string, number> = {};
  const stats = new Map<string, RiskStats>();
  SYMBOLS.forEach((s, i) => {
    const bad = r();
    assets.set(
      s,
      asset(s, {
        asset_class: r() < 0.4 ? "STOCK" : "ETF",
        sector: SECTORS[i]!,
        fractionable: r() < 0.7,
        verified: bad > 0.08,
        is_leveraged: bad > 0.08 && bad < 0.12,
        is_inverse: bad > 0.12 && bad < 0.15,
        crypto_exposure: bad > 0.15 && bad < 0.18,
        active: !(bad > 0.18 && bad < 0.2),
      }),
    );
    prices[s] = r() < 0.03 ? 0 : Math.exp(r() * 7 - 1); // 0.37 .. 400, occasionally 0
    if (r() < 0.9) stats.set(s, { symbol: s, observations: 200, annualVol: r() * 0.9, beta: r() * 3 - 0.8, maxDrawdown1y: r() * 0.6 });
  });
  const open = r() < 0.9;
  const snap = snapshot(prices, { open, quoteAgeMin: r() < 0.05 ? 60 : 1 });
  if (r() < 0.05) snap.quotes.delete(pick(SYMBOLS));
  const initial = 20 + r() * 20_000;
  const positions: Record<string, { qty: number; cost: number }> = {};
  let cash = initial * r();
  if (r() < 0.05) cash = 0;
  for (const s of SYMBOLS) {
    if (r() < 0.4) {
      const px = prices[s] || 1;
      const qty = assets.get(s)!.fractionable ? (r() * initial) / px / 4 : Math.floor((r() * initial) / px / 4) + 1;
      positions[s] = { qty, cost: qty * px * (0.7 + r() * 0.6) };
    }
  }
  const st = state(cash, positions, initial);
  if (r() < 0.3) st.reservedCash = D(cash * r());
  for (const s of Object.keys(positions)) if (r() < 0.2) st.reservedQty.set(s, D(positions[s]!.qty * r() * 1.2));
  const policy = paperPolicy({
    riskBudgetPct: 0.05 + r() * 0.5,
    maxPositionPctStock: 0.05 + r() * 0.4,
    maxPositionPctEtf: 0.2 + r() * 0.7,
    maxSectorPct: 0.2 + r() * 0.8,
    minOrderUsd: r() < 0.5 ? 1 : r() * 50,
    maxOrderUsd: r() < 0.3 ? 10 + r() * 5000 : null,
    maxCapitalUsd: r() < 0.2 ? r() * initial : null,
    requireMarketOpen: r() < 0.95,
    costs: {
      commissionPerOrderUsd: r() < 0.5 ? 0 : r() * 3,
      sellRegulatoryFeeBps: r() * 5,
      slippageBps: r() * 20,
      buyCashBufferBps: 50,
      note: "fuzz",
    },
  });
  const blockers = r() < 0.05 ? ["KILL_SWITCH: fuzz"] : [];
  const sym = pick(SYMBOLS);
  const side = r() < 0.6 ? "BUY" : "SELL";
  const px = prices[sym] || 1;
  let qty: Decimal;
  const q = r();
  if (q < 0.03) qty = D(0);
  else if (q < 0.05) qty = D(-3);
  else if (side === "SELL" && positions[sym] && r() < 0.5) qty = D(positions[sym]!.qty).times(0.5 + r());
  else qty = D(((r() * initial) / px) * (r() < 0.2 ? 5 : 1));
  if (!assets.get(sym)!.fractionable && r() < 0.8) qty = qty.floor();
  qty = qty.toDecimalPlaces(6, Decimal.ROUND_DOWN);
  const limit = r() < 0.25;
  const proposal: OrderProposal = {
    symbol: sym,
    side,
    qty,
    orderType: limit ? "LIMIT" : "MARKET",
    limitPrice: limit ? (r() < 0.05 ? 0 : px * (0.9 + r() * 0.3)) : undefined,
    addToLoserJustification: r() < 0.5 ? "fuzz" : undefined,
    source: "STRATEGY_TARGET",
  };
  return { st, snap, assets, stats, policy, blockers, proposal };
}

const EPS = 1e-9;

function holdingsAfter(sc: Scenario, qty: Decimal, px: number): { holdings: Map<string, Decimal>; total: Decimal } {
  const holdings = new Map<string, Decimal>();
  let total = sc.st.cash;
  for (const p of sc.st.positions.values()) {
    const mp = priceFor(sc.snap, p.symbol);
    const v = mp === undefined ? p.costBasis : p.qty.times(mp);
    holdings.set(p.symbol, v);
    total = total.plus(v);
  }
  holdings.set(sc.proposal.symbol, (holdings.get(sc.proposal.symbol) ?? ZERO).plus(qty.times(px)));
  return { holdings, total };
}

function assertApprovedInvariants(sc: Scenario, qty: Decimal, reservedCash: Decimal) {
  const { st, snap, policy, proposal: p } = sc;
  const a = sc.assets.get(p.symbol)!;
  expect(sc.blockers).toHaveLength(0);
  if (policy.requireMarketOpen) expect(snap.clock.isOpen).toBe(true);
  expect(qty.gt(0)).toBe(true);
  expect(qty.lte(p.qty)).toBe(true);
  if (!a.fractionable) expect(qty.isInteger()).toBe(true);
  const px = executionPrice(snap, p.symbol, p.side)!;
  expect(px).toBeGreaterThan(0);
  const notional = qty.times(px);
  expect(notional.gte(policy.minOrderUsd)).toBe(true);
  if (policy.maxOrderUsd !== null) expect(notional.lte(policy.maxOrderUsd)).toBe(true);
  const fee = estimateFee(policy, p.side, notional);
  if (p.side === "SELL") {
    const pos = st.positions.get(p.symbol);
    expect(pos).toBeDefined();
    const sellable = pos!.qty.minus(st.reservedQty.get(p.symbol) ?? ZERO);
    expect(qty.lte(sellable)).toBe(true);
    // Worst-case proceeds (slippage) minus fee must not push cash (after reservations) below zero.
    const proceeds = notional.times(1 - policy.costs.slippageBps / 10_000);
    expect(st.cash.minus(st.reservedCash).plus(proceeds).minus(fee).gte(-EPS)).toBe(true);
    return;
  }
  // BUY: product policy
  expect(a.verified && a.active && !a.is_leveraged && !a.is_inverse && !a.crypto_exposure).toBe(true);
  // Cash: reservation covers qty at the worst allowed fill price plus fees, and fits available cash.
  const worstPx = p.orderType === "LIMIT" ? p.limitPrice! : px * (1 + policy.costs.slippageBps / 10_000);
  expect(reservedCash.gte(qty.times(worstPx).plus(fee).minus(1e-9))).toBe(true);
  expect(st.cash.minus(st.reservedCash).minus(reservedCash).gte(-EPS)).toBe(true);
  // Concentration: independent recomputation (less strict than engine's: no slippage deduction).
  const { holdings, total } = holdingsAfter(sc, qty, px);
  const totalAfter = total.minus(fee);
  const maxPos = a.asset_class === "STOCK" ? policy.maxPositionPctStock : policy.maxPositionPctEtf;
  expect(holdings.get(p.symbol)!.div(totalAfter).lte(maxPos + 1e-9)).toBe(true);
  let sector = ZERO;
  for (const [s, v] of holdings) if (sc.assets.get(s)?.sector === a.sector) sector = sector.plus(v);
  expect(sector.div(totalAfter).lte(policy.maxSectorPct + 1e-9)).toBe(true);
  if (policy.maxCapitalUsd !== null) {
    let inv = ZERO;
    for (const v of holdings.values()) inv = inv.plus(v);
    expect(inv.lte(policy.maxCapitalUsd + 1e-9)).toBe(true);
  }
  // Risk budget
  expect(sc.stats.has(p.symbol)).toBe(true);
  const stress = stressTest(holdings, sc.assets, sc.stats, policy);
  const worstValue = totalAfter.minus(stress.worst.loss);
  const loss = st.initialCapitalUsd.minus(worstValue).div(st.initialCapitalUsd);
  expect(loss.lte(policy.riskBudgetPct + 1e-6)).toBe(true);
}

describe("risk engine property/fuzz", () => {
  const N = 6000;
  it(`never approves an unsafe order across ${N} random portfolios/proposals`, () => {
    const counts = { ALLOW: 0, RESIZE: 0, REJECT: 0 };
    for (let seed = 1; seed <= N; seed++) {
      const sc = scenario(seed);
      const res = checkOrder({ state: sc.st, snapshot: sc.snap, assets: sc.assets, stats: sc.stats, policy: sc.policy, blockers: sc.blockers }, sc.proposal);
      counts[res.result]++;
      if (res.result === "REJECT") {
        expect(res.approvedQty.isZero()).toBe(true);
        expect(res.reservedCash.isZero()).toBe(true);
        continue;
      }
      try {
        assertApprovedInvariants(sc, res.approvedQty, res.reservedCash);
        if (res.result === "RESIZE") {
          expect(res.approvedQty.lt(sc.proposal.qty)).toBe(true);
          const again = checkOrder(
            { state: sc.st, snapshot: sc.snap, assets: sc.assets, stats: sc.stats, policy: sc.policy, blockers: sc.blockers },
            { ...sc.proposal, qty: res.approvedQty },
          );
          expect(again.result).toBe("ALLOW");
        } else expect(res.approvedQty.eq(sc.proposal.qty)).toBe(true);
      } catch (err) {
        throw new Error(`seed ${seed} (${res.result} ${sc.proposal.side} ${sc.proposal.symbol} ${sc.proposal.qty}): ${(err as Error).message}`);
      }
    }
    // The generator must actually exercise every outcome.
    expect(counts.ALLOW).toBeGreaterThan(200);
    expect(counts.RESIZE).toBeGreaterThan(100);
    expect(counts.REJECT).toBeGreaterThan(200);
  });

  it("rejects everything under kill switch / market closed / bad assets regardless of size", () => {
    for (let seed = 10_000; seed < 11_000; seed++) {
      const sc = scenario(seed);
      const ctx = { state: sc.st, snapshot: sc.snap, assets: sc.assets, stats: sc.stats, policy: sc.policy };
      expect(checkOrder({ ...ctx, blockers: ["KILL_SWITCH: x"] }, sc.proposal).result).toBe("REJECT");
      const closed = { ...sc.snap, clock: { ...sc.snap.clock, isOpen: false } };
      expect(checkOrder({ ...ctx, snapshot: closed, policy: { ...sc.policy, requireMarketOpen: true }, blockers: [] }, sc.proposal).result).toBe("REJECT");
      for (const flag of ["is_leveraged", "is_inverse", "crypto_exposure"] as const) {
        const assets = new Map(sc.assets);
        assets.set(sc.proposal.symbol, { ...assets.get(sc.proposal.symbol)!, [flag]: true });
        if (sc.proposal.side === "BUY") expect(checkOrder({ ...ctx, assets, blockers: [] }, sc.proposal).result).toBe("REJECT");
      }
      const unverified = new Map(sc.assets);
      unverified.set(sc.proposal.symbol, { ...unverified.get(sc.proposal.symbol)!, verified: false });
      if (sc.proposal.side === "BUY") expect(checkOrder({ ...ctx, assets: unverified, blockers: [] }, sc.proposal).result).toBe("REJECT");
    }
  });

  it("a tiny sell whose fixed commission exceeds proceeds cannot drive cash negative", () => {
    const policy = paperPolicy({ minOrderUsd: 1, costs: { commissionPerOrderUsd: 5, sellRegulatoryFeeBps: 0, slippageBps: 0, buyCashBufferBps: 50, note: "" } });
    const st = state(0, { AAA: { qty: 1, cost: 2 } }, 100);
    const res = checkOrder(
      { state: st, snapshot: snapshot({ AAA: 2 }), assets: new Map([["AAA", asset("AAA")]]), stats: new Map(), policy, blockers: [] },
      { symbol: "AAA", side: "SELL", qty: D(1), orderType: "MARKET", source: "STRATEGY_TARGET" },
    );
    expect(res.result).toBe("REJECT");
  });

  it("NaN / Infinity inputs are rejected", () => {
    const st = state(1000, {}, 1000);
    const ctx = { state: st, snapshot: snapshot({ AAA: 10 }), assets: new Map([["AAA", asset("AAA")]]), stats: new Map([["AAA", { symbol: "AAA", observations: 100, annualVol: 0.1, beta: 1, maxDrawdown1y: 0.1 }]]), policy: paperPolicy(), blockers: [] };
    for (const qty of [D(NaN), D(Infinity), D(-1)]) expect(checkOrder(ctx, { symbol: "AAA", side: "BUY", qty, orderType: "MARKET", source: "STRATEGY_TARGET" }).result).toBe("REJECT");
    for (const limitPrice of [NaN, Infinity, -5, 0])
      expect(checkOrder(ctx, { symbol: "AAA", side: "BUY", qty: D(1), orderType: "LIMIT", limitPrice, source: "STRATEGY_TARGET" }).result).toBe("REJECT");
    const nanSnap = snapshot({ AAA: NaN });
    expect(checkOrder({ ...ctx, snapshot: nanSnap }, { symbol: "AAA", side: "BUY", qty: D(1), orderType: "MARKET", source: "STRATEGY_TARGET" }).result).toBe("REJECT");
  });
});
