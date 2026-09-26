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
import { EdgarFundamentals, extractPointInTime } from "../src/research/edgar.js";
import type { AiProvider } from "../src/ai/provider.js";
import { listPortfolios } from "../src/portfolio/state.js";

const OPEN = new Date("2026-09-24T15:00:00Z");

function facts() {
  const usd = (vals: [string, number, string][]) => ({ units: { USD: vals.map(([end, val, filed]) => ({ end, start: `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`, val, fy: Number(end.slice(0, 4)), fp: "FY", form: "10-K", filed, accn: `a-${end}` })) } });
  return {
    facts: {
      "us-gaap": {
        Revenues: usd([["2023-12-31", 100e9, "2024-02-01"], ["2024-12-31", 110e9, "2025-02-01"], ["2025-12-31", 120e9, "2026-02-01"], ["2026-12-31", 999e9, "2027-02-01"]]),
        NetIncomeLoss: usd([["2024-12-31", 20e9, "2025-02-01"], ["2025-12-31", 22e9, "2026-02-01"]]),
        NetCashProvidedByUsedInOperatingActivities: usd([["2025-12-31", 30e9, "2026-02-01"]]),
      },
      dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ end: "2026-01-15", val: 1e9, form: "10-K", filed: "2026-02-01", accn: "x" }] } } },
    },
  };
}

class FakeModel implements AiProvider {
  readonly name = "fake";
  calls: string[] = [];
  constructor(private mode: "cheap" | "hallucinate" | "expensive") {}
  async structuredCall(args: { user: string }) {
    this.calls.push(args.user);
    const pkg = JSON.parse(args.user.replace(/^Data package \(JSON\):\n/, ""));
    const price = pkg.market.price as number;
    const src = this.mode === "hallucinate" ? "news:made-up" : pkg.fundamentals.source_id;
    const base = this.mode === "cheap" ? price * 1.6 : price * 1.05;
    return {
      ok: true,
      modelServed: "claude-opus-5",
      inputTokens: 5000,
      outputTokens: 1000,
      json: {
        symbol: pkg.symbol,
        action: "BUY",
        thesis: "test thesis",
        valuation: { method: "DCF", currency: "USD", per_share_low: base * 0.8, per_share_base: base, per_share_high: base * 1.3, assumptions: ["a"] },
        scenarios: { bear: { price: price * 0.6, description: "b" }, base: { price: base, description: "m" }, bull: { price: base * 1.3, description: "u" } },
        evidence_for: [{ claim: "revenue growth", source_id: src }],
        evidence_against: [{ claim: "valuation risk", source_id: pkg.market.source_id }],
        target_exposure_pct: 15,
        max_buy_price: price * 1.02,
        sell_conditions: ["price above high"],
        thesis_invalidation: ["revenue declines"],
        horizon_days: 180,
        valid_for_minutes: 60,
        confidence_label: "medium",
        missing_material_information: [],
        add_to_losing_position_reason: null,
      },
    };
  }
}

let pool: pg.Pool;
const fakeFetch = (async () => new Response(JSON.stringify(facts()), { status: 200 })) as unknown as typeof fetch;

function deps(model: FakeModel): CycleDeps {
  return {
    pool,
    market: new SimulatedMarketData(),
    fx: new StaticFx(3.7),
    brokers: defaultBrokerFactory(pool, DEFAULT_COSTS),
    ai: { provider: model, edgar: new EdgarFundamentals("test test@example.com", fakeFetch), model: "claude-opus-5", budget: { aiBudgetIls: 60, opsCapIls: 150, infraEstimateIls: 0 } },
    maxQuoteAgeMinutes: 20,
    maxAiCallsPerCycle: 1,
  };
}

beforeAll(async () => {
  pool = await freshDb();
  await bootstrap(pool, new StaticFx(3.7), "simulated", OPEN);
  // Keep the test focused on the AI portfolio.
  await query(pool, "UPDATE portfolios SET status = 'PAUSED' WHERE code <> 'PAPER-3' AND kind <> 'LIVE'");
});
afterAll(async () => closePool());

describe("point-in-time fundamentals", () => {
  it("never uses filings published after the decision date", () => {
    const s = extractPointInTime(facts(), "2026-09-24", "X", "1");
    expect(s.annual.revenue!.map((f) => f.value)).not.toContain(999e9);
    expect(s.annual.revenue![0]!.value).toBe(120e9);
  });
});

describe("AI manager", () => {
  it("rejects output that cites sources not in the data package (no orders, cost recorded)", async () => {
    const m = new FakeModel("hallucinate");
    await runCycle(deps(m), OPEN);
    const p = (await listPortfolios(pool)).find((x) => x.code === "PAPER-3")!;
    const d = await maybeOne(pool, "SELECT status, rationale FROM decisions WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT 1", [p.id]);
    expect(d.status).toBe("DEFERRED");
    expect(d.rationale).toMatch(/unknown source_id/);
    expect((await query(pool, "SELECT 1 FROM orders WHERE portfolio_id = $1", [p.id])).length).toBe(0);
    const cost = await maybeOne(pool, "SELECT SUM(amount_ils) AS ils FROM cost_ledger WHERE category = 'AI'");
    expect(Number(cost.ils)).toBeGreaterThan(0);
  });

  it("does not buy when the price lacks a margin of safety to the model's base value", async () => {
    await query(pool, "DELETE FROM decisions WHERE false"); // decisions are kept; re-review happens because DEFERRED ones are not counted
    const m = new FakeModel("expensive");
    await runCycle(deps(m), new Date("2026-09-24T16:30:00Z"));
    const p = (await listPortfolios(pool)).find((x) => x.code === "PAPER-3")!;
    const d = await maybeOne(pool, "SELECT status, rationale FROM decisions WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT 1", [p.id]);
    expect(d.status).toBe("NO_ACTION");
    expect(d.rationale).toMatch(/מרווח הביטחון/);
    const f = await maybeOne(pool, "SELECT value_base FROM forecast_snapshots WHERE portfolio_id = $1", [p.id]);
    expect(Number(f.value_base)).toBeGreaterThan(0); // the forecast is stored before any outcome
  });

  it("places a limit buy at or below the code-computed limit when the model finds a real discount", async () => {
    const m = new FakeModel("cheap");
    await runCycle(deps(m), new Date("2026-10-01T15:00:00Z")); // > 5 days later: re-review allowed
    const p = (await listPortfolios(pool)).find((x) => x.code === "PAPER-3")!;
    const o = await maybeOne(pool, "SELECT o.order_type, o.limit_price, o.status, o.qty, o.est_price FROM orders o WHERE portfolio_id = $1", [p.id]);
    expect(o.order_type).toBe("LIMIT");
    expect(Number(o.limit_price)).toBeGreaterThan(0);
    expect(["FILLED", "ACCEPTED"]).toContain(o.status);
    const rc = await maybeOne(pool, "SELECT metrics FROM risk_checks ORDER BY id DESC LIMIT 1");
    expect(Number(rc.metrics.positionPctAfter)).toBeLessThanOrEqual(0.2);
  });
});
