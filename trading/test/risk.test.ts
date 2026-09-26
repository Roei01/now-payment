import { describe, expect, it } from "vitest";
import { D } from "../src/lib/money.js";
import { checkOrder, type OrderProposal } from "../src/risk/engine.js";
import { paperPolicy } from "../src/risk/policy.js";
import { computeAllRiskStats } from "../src/risk/stats.js";
import { asset, bars, snapshot, state } from "./fixtures.js";

const assets = new Map([
  ["SPY", asset("SPY", { sector: "US_EQUITY_BROAD" })],
  ["BND", asset("BND")],
  ["LEV", asset("LEV", { is_leveraged: true })],
  ["UNV", asset("UNV", { verified: false })],
  ["STK", asset("STK", { asset_class: "STOCK", fractionable: false, sector: "TECH" })],
]);
const history = new Map([
  ["SPY", bars(100, 0.0003, 300, 0.01)],
  ["BND", bars(100, 0.0001, 300, 0.002)],
  ["STK", bars(50, 0.0005, 300, 0.02)],
  ["LEV", bars(50, 0.0005, 300, 0.02)],
  ["UNV", bars(50, 0.0005, 300, 0.02)],
]);
const stats = computeAllRiskStats(history);
const snap = (o: Parameters<typeof snapshot>[1] = {}) => snapshot({ SPY: 100, BND: 100, LEV: 50, UNV: 50, STK: 50 }, { bars: history, ...o });
const buy = (symbol: string, qty: number, extra: Partial<OrderProposal> = {}): OrderProposal => ({ symbol, side: "BUY", qty: D(qty), orderType: "MARKET", source: "STRATEGY_TARGET", ...extra });
const ctx = (st = state(100), o: { blockers?: string[]; snap?: ReturnType<typeof snap> } = {}) => ({ state: st, snapshot: o.snap ?? snap(), assets, stats, policy: paperPolicy(), blockers: o.blockers ?? [] });

describe("risk engine", () => {
  it("allows a small, diversified cash buy", () => {
    const r = checkOrder(ctx(), buy("BND", 0.3));
    expect(r.result).toBe("ALLOW");
  });

  it("never buys more than available cash (resizes instead)", () => {
    const r = checkOrder(ctx(state(10, {}, 10)), buy("BND", 0.5));
    expect(r.result).toBe("RESIZE");
    expect(r.reservedCash.lte(10)).toBe(true);
  });

  it("rejects sells beyond holdings (no shorting)", () => {
    const r = checkOrder(ctx(state(0, { SPY: { qty: 0.2, cost: 20 } })), { ...buy("SPY", 0.5), side: "SELL" });
    expect(r.result).toBe("REJECT");
    expect(r.reasons.map((x) => x.code)).toContain("SELL_EXCEEDS_HOLDINGS");
  });

  it("rejects leveraged and unverified products", () => {
    expect(checkOrder(ctx(), buy("LEV", 0.1)).reasons.map((x) => x.code)).toContain("LEVERAGED_PRODUCT");
    expect(checkOrder(ctx(), buy("UNV", 0.1)).reasons.map((x) => x.code)).toContain("ASSET_CLASSIFICATION_NOT_VERIFIED");
    expect(checkOrder(ctx(), buy("XYZ", 0.1)).reasons.map((x) => x.code)).toContain("ASSET_NOT_IN_REGISTRY");
  });

  it("blocks when the market is closed, quotes are stale, or the kill switch is on", () => {
    expect(checkOrder(ctx(state(100), { snap: snap({ open: false }) }), buy("BND", 0.1)).reasons.map((x) => x.code)).toContain("MARKET_CLOSED");
    expect(checkOrder(ctx(state(100), { snap: snap({ quoteAgeMin: 90 }) }), buy("BND", 0.1)).reasons.map((x) => x.code)).toContain("STALE_QUOTE");
    expect(checkOrder(ctx(state(100), { blockers: ["KILL_SWITCH: test"] }), buy("BND", 0.1)).result).toBe("REJECT");
  });

  it("keeps estimated worst-case loss within the 30% budget by resizing", () => {
    const r = checkOrder(ctx(state(100)), buy("SPY", 0.99));
    expect(r.result).toBe("RESIZE");
    expect(Number(r.metrics.estimatedWorstLossFromInitialPct)).toBeLessThanOrEqual(0.3);
  });

  it("refuses new exposure when already beyond the risk budget, but does not force a sale", () => {
    const st = state(5, { SPY: { qty: 0.6, cost: 100 } }, 100); // value ~65, already lost ~35%
    expect(checkOrder(ctx(st), buy("BND", 0.04)).result).toBe("REJECT");
    expect(checkOrder(ctx(st), { ...buy("SPY", 0.1), side: "SELL" }).result).toBe("ALLOW");
  });

  it("blocks automatic averaging down without an explicit justification", () => {
    const st = state(80, { BND: { qty: 0.1, cost: 20 } }); // avg cost 200 vs price 100
    expect(checkOrder(ctx(st), buy("BND", 0.05)).reasons.map((x) => x.code)).toContain("AVERAGING_DOWN_BLOCKED");
    expect(checkOrder(ctx(st), buy("BND", 0.05, { addToLoserJustification: "rebalance policy" })).result).not.toBe("REJECT");
  });

  it("requires whole shares for non-fractionable assets", () => {
    expect(checkOrder(ctx(), buy("STK", 0.5)).reasons.map((x) => x.code)).toContain("FRACTIONAL_NOT_ALLOWED");
  });
});
