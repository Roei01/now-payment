process.env.TEST_DATABASE_URL ??= "postgres://postgres@127.0.0.1:5433/boot_test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshDb, closePool } from "./helpers.js";
import { query } from "../src/db/pool.js";
import { bootstrap, hasUnfundedPortfolios } from "../src/setup/bootstrap.js";
import { StaticFx } from "../src/market/fx.js";
import { SimulatedMarketData } from "../src/market/simulated.js";
import { defaultBrokerFactory } from "../src/broker/factory.js";
import { DEFAULT_COSTS } from "../src/risk/policy.js";
import { runCycle } from "../src/engine/cycle.js";
import { loadState, listPortfolios } from "../src/portfolio/state.js";
import type { FxProvider } from "../src/market/types.js";

let pool: pg.Pool;
const down: FxProvider = { name: "down", getUsdIls: async () => { throw new Error("fx unreachable"); } };

beforeAll(async () => {
  pool = await freshDb();
});
afterAll(async () => closePool());

describe("first boot during an FX outage", () => {
  it("creates portfolios unfunded (never at a guessed rate) and opens an incident", async () => {
    await bootstrap(pool, down, "simulated");
    expect(await hasUnfundedPortfolios(pool)).toBe(true);
    expect((await query(pool, "SELECT 1 FROM ledger_entries")).length).toBe(0);
    expect((await query(pool, "SELECT 1 FROM incidents WHERE dedupe_key = 'fx-bootstrap' AND resolved_at IS NULL")).length).toBe(1);
  });

  it("does not trade unfunded portfolios", async () => {
    const r = await runCycle(
      { pool, market: new SimulatedMarketData(), fx: new StaticFx(3.7), brokers: defaultBrokerFactory(pool, DEFAULT_COSTS), ai: { model: "x", budget: { aiBudgetIls: 60, opsCapIls: 150, infraEstimateIls: 0 } }, maxQuoteAgeMinutes: 20, maxAiCallsPerCycle: 0 },
      new Date("2026-09-24T15:00:00Z"),
    );
    expect(r.notes.join(" ")).toMatch(/waiting for starting capital/);
    expect((await query(pool, "SELECT 1 FROM orders")).length).toBe(0);
  });

  it("funds exactly once when the rate becomes available, and resolves the incident", async () => {
    await bootstrap(pool, new StaticFx(3.6), "simulated");
    await bootstrap(pool, new StaticFx(3.9), "simulated"); // idempotent: no second deposit
    expect(await hasUnfundedPortfolios(pool)).toBe(false);
    for (const p of (await listPortfolios(pool)).filter((x) => x.kind !== "LIVE")) {
      expect(Number(p.initial_fx_rate)).toBe(3.6);
      expect((await loadState(pool, p.id)).cash.toNumber()).toBeCloseTo((200 / 3.6) * 0.9975, 6);
    }
    expect((await query(pool, "SELECT 1 FROM incidents WHERE dedupe_key = 'fx-bootstrap' AND resolved_at IS NULL")).length).toBe(0);
  });
});
