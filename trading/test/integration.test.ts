import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshDb, closePool } from "./helpers.js";
import { query, maybeOne } from "../src/db/pool.js";
import { bootstrap } from "../src/setup/bootstrap.js";
import { StaticFx } from "../src/market/fx.js";
import { SimulatedMarketData } from "../src/market/simulated.js";
import { runCycle, type CycleDeps } from "../src/engine/cycle.js";
import { defaultBrokerFactory } from "../src/broker/factory.js";
import { DEFAULT_COSTS } from "../src/risk/policy.js";
import { loadState, listPortfolios } from "../src/portfolio/state.js";
import { placeOrder, recordFill, reconcileOrders, reconcilePositions, getOrderByClientId } from "../src/execution/orders.js";
import { InternalSimBroker } from "../src/broker/internalSim.js";
import type { Broker, BrokerOrderRequest } from "../src/broker/types.js";
import { setState } from "../src/ops/systemState.js";
import { D } from "../src/lib/money.js";
import { buildSnapshot } from "../src/market/service.js";
import { loadAssets } from "../src/assets/universe.js";
import { enqueueNotification } from "../src/notify/outbox.js";
import { dispatchNotifications } from "../src/notify/email.js";
import { transitionLive } from "../src/live/stateMachine.js";
import { createStrategyVersion } from "../src/strategies/registry.js";

let pool: pg.Pool;
let deps: CycleDeps;
const OPEN = new Date("2026-09-24T15:00:00Z"); // Thursday 11:00 New York
const LATER = new Date("2026-09-24T17:30:00Z");

beforeAll(async () => {
  pool = await freshDb();
  await bootstrap(pool, new StaticFx(3.7), OPEN);
  deps = {
    pool,
    market: new SimulatedMarketData(),
    fx: new StaticFx(3.7),
    brokers: defaultBrokerFactory(pool, DEFAULT_COSTS),
    ai: { model: "claude-opus-5", budget: { aiBudgetIls: 60, opsCapIls: 150, infraEstimateIls: 0 } },
    maxQuoteAgeMinutes: 20,
    maxAiCallsPerCycle: 2,
  };
});
afterAll(async () => closePool());

const byCode = async (code: string) => (await listPortfolios(pool)).find((p) => p.code === code)!;

describe("bootstrap", () => {
  it("creates three 200 ₪ paper portfolios, a benchmark and a dormant live portfolio", async () => {
    const ps = await listPortfolios(pool);
    expect(ps.filter((p) => p.kind === "PAPER")).toHaveLength(3);
    for (const p of ps.filter((x) => x.kind !== "LIVE")) {
      expect(Number(p.initial_capital_ils)).toBe(200);
      expect(Number(p.initial_capital_usd)).toBeCloseTo(200 / 3.7, 6);
      const st = await loadState(pool, p.id);
      expect(st.cash.toNumber()).toBeCloseTo((200 / 3.7) * (1 - 0.0025), 6); // conversion cost booked
    }
    expect((await byCode("LIVE")).status).toBe("DORMANT");
    await bootstrap(pool, new StaticFx(4), OPEN); // idempotent
    expect(await listPortfolios(pool)).toHaveLength(5);
  });
});

describe("decision cycle", () => {
  it("runs, trades paper portfolios within cash, and never trades the dormant live portfolio", async () => {
    const r = await runCycle(deps, OPEN);
    expect(r.status).toBe("OK");
    expect(r.orders).toBeGreaterThan(0);
    for (const p of await listPortfolios(pool)) {
      const st = await loadState(pool, p.id);
      expect(st.cash.gte(0)).toBe(true);
      for (const pos of st.positions.values()) expect(pos.qty.gt(0)).toBe(true);
    }
    const live = await byCode("LIVE");
    expect((await query(pool, "SELECT 1 FROM orders WHERE portfolio_id = $1", [live.id])).length).toBe(0);
    const ai = await byCode("PAPER-3");
    const d = await maybeOne(pool, "SELECT status, rationale FROM decisions WHERE portfolio_id = $1", [ai.id]);
    expect(d.status).toBe("DEFERRED"); // no AI provider → HOLD, never a guess
  });

  it("records HOLD when nothing is due", async () => {
    await runCycle(deps, LATER);
    const p = await byCode("PAPER-2");
    const last = await maybeOne(pool, "SELECT action, status FROM decisions WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT 1", [p.id]);
    expect(last.action).toBe("HOLD");
  });

  it("kill switch blocks every new order but keeps holdings", async () => {
    await setState(pool, "kill_switch", { active: true, reason: "test" }, "test");
    const p = await byCode("PAPER-2");
    const before = await loadState(pool, p.id);
    await query(pool, "INSERT INTO strategy_assignments (portfolio_id, strategy_version_id, reason, assigned_by) SELECT $1, id, 'x', 'x' FROM strategy_versions WHERE false", [p.id]);
    const v = await createStrategyVersion(pool, { code: "DEFENSIVE_REBALANCE", params: { targets: { VTI: 0.2, BND: 0.2, GLD: 0.2, SHY: 0.3 } }, reason: "test drift", by: "test" });
    await query(pool, "UPDATE strategy_assignments SET unassigned_at = now() WHERE portfolio_id = $1 AND unassigned_at IS NULL", [p.id]);
    await query(pool, "INSERT INTO strategy_assignments (portfolio_id, strategy_version_id, reason, assigned_by) VALUES ($1, $2, 'test', 'test')", [p.id, v.id]);
    const ordersBefore = (await query(pool, "SELECT 1 FROM orders")).length;
    await runCycle(deps, new Date("2026-09-24T19:00:00Z"));
    expect((await query(pool, "SELECT 1 FROM orders")).length).toBe(ordersBefore);
    const rc = await maybeOne(pool, "SELECT reasons FROM risk_checks ORDER BY id DESC LIMIT 1");
    expect(JSON.stringify(rc.reasons)).toMatch(/KILL_SWITCH/);
    const after = await loadState(pool, p.id);
    expect(after.positions.size).toBe(before.positions.size);
    await setState(pool, "kill_switch", { active: false }, "test");
  });
});

describe("ledger & versions are append-only", () => {
  it("rejects updates/deletes of ledger entries and strategy versions", async () => {
    await expect(query(pool, "UPDATE ledger_entries SET cash_delta = 0")).rejects.toThrow(/append-only/);
    await expect(query(pool, "DELETE FROM ledger_entries")).rejects.toThrow(/append-only/);
    await expect(query(pool, "UPDATE strategy_versions SET params = '{}'")).rejects.toThrow(/append-only/);
  });
});

describe("execution safety", () => {
  it("ignores a duplicate fill notification", async () => {
    const o = await maybeOne(pool, "SELECT o.id FROM orders o WHERE o.status = 'FILLED' LIMIT 1");
    const f = await maybeOne(pool, "SELECT broker_fill_id, qty, price, fee, occurred_at FROM fills WHERE order_id = $1", [o.id]);
    const ledgerBefore = (await query(pool, "SELECT 1 FROM ledger_entries")).length;
    const dup = await recordFill(pool, o.id, { id: f.broker_fill_id, qty: f.qty, price: f.price, fee: f.fee, at: f.occurred_at, feeEstimated: false });
    expect(dup).toBe(false);
    expect((await query(pool, "SELECT 1 FROM ledger_entries")).length).toBe(ledgerBefore);
  });

  it("a retry of the same decision never creates a second order", async () => {
    const p = await byCode("PAPER-1");
    const assets = await loadAssets(pool);
    const snap = await buildSnapshot(pool, { provider: deps.market, fx: deps.fx, maxQuoteAgeMinutes: 20 }, [...assets.values()], OPEN);
    const broker = deps.brokers(p).broker!;
    broker.setMarket!(snap);
    const decision = await maybeOne(pool, "INSERT INTO decisions (portfolio_id, action, status, rationale, policy_version) VALUES ($1, 'BUY', 'PROPOSED', 'test', 't') RETURNING id", [p.id]);
    const input = { portfolioId: p.id, portfolioCode: p.code, decisionId: decision.id, assetId: assets.get("SHY")!.id, symbol: "SHY", side: "BUY" as const, qty: D("0.01"), orderType: "MARKET" as const, estPrice: 80, reservedCash: D(1), venue: "INTERNAL_SIM" };
    const a = await placeOrder(pool, broker, input);
    const b = await placeOrder(pool, broker, input);
    expect(a.id).toBe(b.id);
    expect((await query(pool, "SELECT 1 FROM orders WHERE decision_id = $1", [decision.id])).length).toBe(1);
    expect((await query(pool, "SELECT 1 FROM sim_broker_orders WHERE client_order_id = $1", [a.client_order_id])).length).toBe(1);
  });

  it("recovers from a crash between broker submit and acknowledgement without double-ordering", async () => {
    const p = await byCode("PAPER-1");
    const assets = await loadAssets(pool);
    const snap = await buildSnapshot(pool, { provider: deps.market, fx: deps.fx, maxQuoteAgeMinutes: 20 }, [...assets.values()], OPEN);
    const inner = new InternalSimBroker(pool, p.code, DEFAULT_COSTS, async () => [], async () => "0");
    inner.setMarket(snap);
    // Venue accepts the order, then the connection dies before we see the response.
    const flaky: Broker = {
      venue: "INTERNAL_SIM",
      setMarket: (s) => inner.setMarket(s),
      submit: async (req: BrokerOrderRequest) => {
        await inner.submit(req);
        throw new Error("socket hang up");
      },
      getByClientOrderId: (id) => inner.getByClientOrderId(id),
      cancel: (id) => inner.cancel(id),
      listOpenOrders: () => inner.listOpenOrders(),
      getAccount: () => inner.getAccount(),
      getPositions: () => inner.getPositions(),
    };
    const decision = await maybeOne(pool, "INSERT INTO decisions (portfolio_id, action, status, rationale, policy_version) VALUES ($1, 'BUY', 'PROPOSED', 'crash test', 't') RETURNING id", [p.id]);
    const o = await placeOrder(pool, flaky, { portfolioId: p.id, portfolioCode: p.code, decisionId: decision.id, assetId: assets.get("SHY")!.id, symbol: "SHY", side: "BUY", qty: D("0.01"), orderType: "MARKET", estPrice: 80, reservedCash: D(1), venue: "INTERNAL_SIM" });
    expect(o.status).toBe("UNKNOWN");
    expect((await byCode("PAPER-1")).status).toBe("PAUSED"); // uncertain broker state → pause
    const cashBefore = (await loadState(pool, p.id)).cash;
    await reconcileOrders(pool, inner, p.id);
    const after = await getOrderByClientId(pool, o.client_order_id);
    expect(after!.status).toBe("FILLED");
    expect((await query(pool, "SELECT 1 FROM sim_broker_orders WHERE client_order_id = $1", [o.client_order_id])).length).toBe(1);
    expect((await loadState(pool, p.id)).cash.lt(cashBefore)).toBe(true); // fill booked exactly once
    await reconcileOrders(pool, inner, p.id);
    expect((await query(pool, "SELECT 1 FROM fills WHERE order_id = $1", [o.id])).length).toBe(1);
    await query(pool, "UPDATE portfolios SET status = 'ACTIVE' WHERE id = $1", [p.id]);
  });

  it("pauses the portfolio when broker positions differ from the ledger (e.g. a manual trade)", async () => {
    const p = await byCode("PAPER-1");
    const manual: Broker = {
      venue: "ALPACA_PAPER",
      submit: async () => { throw new Error("n/a"); },
      getByClientOrderId: async () => null,
      cancel: async () => undefined,
      listOpenOrders: async () => [],
      getAccount: async () => ({ cash: "0", buyingPower: "0", currency: "USD", tradingBlocked: false, accountBlocked: false, status: "ACTIVE", multiplier: "1" }),
      getPositions: async () => [{ symbol: "AAPL", qty: "3" }],
    };
    const r = await reconcilePositions(pool, manual, p.id);
    expect(r.ok).toBe(false);
    expect((await byCode("PAPER-1")).status).toBe("PAUSED");
    const inc = await maybeOne(pool, "SELECT severity FROM incidents WHERE kind = 'RECONCILIATION_MISMATCH' AND resolved_at IS NULL");
    expect(inc.severity).toBe("CRITICAL");
  });
});

describe("live portfolio", () => {
  it("cannot be armed by hand, or without 2FA and readiness", async () => {
    const live = await byCode("LIVE");
    await expect(transitionLive(pool, { portfolioId: live.id, to: "ELIGIBLE", actor: "owner@x", reason: "try", mfaVerified: true })).rejects.toThrow(/promotion gate/);
    await expect(transitionLive(pool, { portfolioId: live.id, to: "PILOT", actor: "owner@x", reason: "try", mfaVerified: true })).rejects.toThrow(/not allowed/);
    await transitionLive(pool, { portfolioId: live.id, to: "ELIGIBLE", actor: "system", reason: "gate", mfaVerified: false });
    await expect(transitionLive(pool, { portfolioId: live.id, to: "ARMED", actor: "owner@x", reason: "try", mfaVerified: false })).rejects.toThrow(/2FA/);
    await expect(
      transitionLive(pool, { portfolioId: live.id, to: "ARMED", actor: "owner@x", reason: "try", mfaVerified: true, readiness: { ready: false, checks: [{ code: "LIVE_FLAG", pass: false, detail: "" }] } }),
    ).rejects.toThrow(/readiness/);
  });
});

describe("notifications", () => {
  it("deduplicates and marks undeliverable mail as SUPPRESSED (visible), never dropped", async () => {
    expect(await enqueueNotification(pool, { dedupeKey: "t1", kind: "t", subject: "s", body: "b" })).toBe(true);
    expect(await enqueueNotification(pool, { dedupeKey: "t1", kind: "t", subject: "s", body: "b" })).toBe(false);
    await dispatchNotifications(pool, undefined);
    const n = await maybeOne(pool, "SELECT status FROM notifications WHERE dedupe_key = 't1'");
    expect(n.status).toBe("SUPPRESSED");
  });
});
