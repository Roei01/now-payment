process.env.TEST_DATABASE_URL ??= "postgres://postgres@127.0.0.1:5433/fin_sim";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshDb, closePool } from "./helpers.js";
import { query } from "../src/db/pool.js";
import { bootstrap } from "../src/setup/bootstrap.js";
import { StaticFx } from "../src/market/fx.js";
import { SimulatedMarketData } from "../src/market/simulated.js";
import { runCycle, type CycleDeps } from "../src/engine/cycle.js";
import { defaultBrokerFactory } from "../src/broker/factory.js";
import { DEFAULT_COSTS } from "../src/risk/policy.js";
import { listPortfolios, loadState } from "../src/portfolio/state.js";
import { D, ZERO } from "../src/lib/money.js";
import { isoDate, addDays } from "../src/lib/time.js";

let pool: pg.Pool;
let deps: CycleDeps;
const START = new Date("2025-01-02T15:00:00Z");

beforeAll(async () => {
  pool = await freshDb();
  await bootstrap(pool, new StaticFx(3.7), "simulated", START);
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

/** Every invariant the ledger, orders and performance tables must satisfy after any cycle. */
export async function assertInvariants(pool: pg.Pool, cycleId?: string) {
  const portfolios = await listPortfolios(pool);
  for (const p of portfolios) {
    const st = await loadState(pool, p.id);
    const tag = `${p.code}`;
    expect(st.cash.gte(0), `${tag} cash ${st.cash}`).toBe(true);
    for (const pos of st.positions.values()) {
      expect(pos.qty.gt(0), `${tag} ${pos.symbol} qty ${pos.qty}`).toBe(true);
      expect(pos.costBasis.gte(0), `${tag} ${pos.symbol} cost`).toBe(true);
    }
    expect(st.reservedCash.lte(st.cash.plus(1e-6)), `${tag} reserved ${st.reservedCash} > cash ${st.cash}`).toBe(true);
    for (const [s, r] of st.reservedQty) expect(r.lte(st.positions.get(s)?.qty ?? ZERO), `${tag} reserved qty ${s}`).toBe(true);
    // Cash is exactly the sum of ledger cash deltas, and never negative at any point in the ledger's history.
    const [agg] = await query(pool, "SELECT COALESCE(SUM(cash_delta),0) AS s FROM ledger_entries WHERE portfolio_id = $1", [p.id]);
    expect(D(agg.s).eq(st.cash), `${tag} ledger sum`).toBe(true);
    const [minRun] = await query(
      pool,
      `SELECT MIN(run) AS m FROM (SELECT SUM(cash_delta) OVER (ORDER BY occurred_at, id) AS run FROM ledger_entries WHERE portfolio_id = $1) x`,
      [p.id],
    );
    if (minRun.m !== null) expect(D(minRun.m).gte(0), `${tag} running cash went negative: ${minRun.m}`).toBe(true);
    // Position qty per asset from the ledger equals sum of fills.
    const qtyCheck = await query(
      pool,
      `SELECT a.symbol, SUM(l.qty_delta) AS ledger,
              (SELECT COALESCE(SUM(CASE WHEN o.side='BUY' THEN f.qty ELSE -f.qty END),0) FROM fills f JOIN orders o ON o.id = f.order_id
                WHERE o.portfolio_id = $1 AND o.asset_id = l.asset_id) AS fills
         FROM ledger_entries l JOIN assets a ON a.id = l.asset_id WHERE l.portfolio_id = $1 AND l.entry_type IN ('BUY','SELL') GROUP BY a.symbol, l.asset_id`,
      [p.id],
    );
    for (const r of qtyCheck) expect(D(r.ledger).eq(r.fills), `${tag} ${r.symbol} ledger qty vs fills`).toBe(true);
    // P&L attribution: realized + unrealized - fees(incl. FX cost) == value - initial deposit.
    const [perf] = await query(
      pool,
      "SELECT * FROM performance_daily WHERE portfolio_id = $1 ORDER BY date DESC LIMIT 1",
      [p.id],
    );
    if (perf && p.initial_capital_usd) {
      const recon = D(perf.realized_pnl_usd).plus(perf.unrealized_pnl_usd).minus(perf.fees_cum_usd);
      const change = D(perf.value_usd).minus(p.initial_capital_usd);
      expect(recon.minus(change).abs().lt(1e-4), `${tag} pnl attribution ${recon} vs ${change}`).toBe(true);
    }
    if (p.kind === "LIVE") {
      const [n] = await query(pool, "SELECT COUNT(*)::int AS n FROM orders WHERE portfolio_id = $1", [p.id]);
      expect(n.n, "dormant live portfolio has orders").toBe(0);
    }
    if (p.kind === "BENCHMARK") {
      const [n] = await query(pool, "SELECT COUNT(*)::int AS n FROM orders WHERE portfolio_id = $1 AND side = 'SELL'", [p.id]);
      expect(n.n, "benchmark was trimmed").toBe(0);
    }
  }
  // Orders: fills sum to filled_qty; FILLED means fully filled; no fill without exactly one ledger entry.
  const bad = await query(
    pool,
    `SELECT o.client_order_id, o.status, o.qty, o.filled_qty, COALESCE(SUM(f.qty),0) AS fsum
       FROM orders o LEFT JOIN fills f ON f.order_id = o.id GROUP BY o.id
      HAVING COALESCE(SUM(f.qty),0) <> o.filled_qty OR (o.status = 'FILLED' AND o.filled_qty <> o.qty) OR o.filled_qty > o.qty`,
  );
  expect(bad, JSON.stringify(bad)).toEqual([]);
  const orphan = await query(
    pool,
    `SELECT f.id FROM fills f LEFT JOIN ledger_entries l ON l.fill_id = f.id AND l.entry_type IN ('BUY','SELL') GROUP BY f.id HAVING COUNT(l.id) <> 1`,
  );
  expect(orphan).toEqual([]);
  const dup = await query(pool, "SELECT client_order_id FROM orders GROUP BY client_order_id HAVING COUNT(*) > 1");
  expect(dup).toEqual([]);
  // A BUY never spends more than the cash reserved for it (incl. fees).
  const over = await query(
    pool,
    `SELECT o.client_order_id, o.reserved_cash, SUM(f.qty * f.price + f.fee) AS spent
       FROM orders o JOIN fills f ON f.order_id = o.id WHERE o.side = 'BUY' GROUP BY o.id HAVING SUM(f.qty * f.price + f.fee) > o.reserved_cash + 0.000001`,
  );
  expect(over, JSON.stringify(over)).toEqual([]);
  // Performance row for this cycle equals cash + Σ qty × snapshot mid price.
  if (cycleId) {
    const snaps = await query(
      pool,
      `SELECT ps.portfolio_id, ps.cash_usd, ps.value_usd, ps.positions, c.batch_id
         FROM positions_snapshots ps JOIN decision_cycles c ON c.id = $1
         JOIN market_data_batches b ON b.id = c.batch_id WHERE ps.as_of = b.as_of`,
      [cycleId],
    );
    for (const s of snaps) {
      let v = D(s.cash_usd);
      for (const pos of s.positions as { symbol: string; qty: string }[]) {
        const [q] = await query(
          pool,
          "SELECT (q.bid + q.ask) / 2 AS mid, q.last FROM market_quotes q JOIN assets a ON a.id = q.asset_id WHERE q.batch_id = $1 AND a.symbol = $2",
          [s.batch_id, pos.symbol],
        );
        v = v.plus(D(pos.qty).times(q.mid));
      }
      expect(v.minus(s.value_usd).abs().lt(1e-3), `snapshot value ${s.value_usd} vs recomputed ${v}`).toBe(true);
    }
  }
}

function tradingDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); isoDate(d) <= to; d = addDays(d, 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(isoDate(d));
  }
  return out;
}

describe("one simulated year of daily cycles", () => {
  it(
    "keeps every financial invariant after each cycle",
    async () => {
      const days = tradingDays("2025-01-02", "2025-12-31");
      let cycles = 0;
      let orders = 0;
      for (const [i, day] of days.entries()) {
        const times = ["15:00"];
        if (i % 5 === 0) times.push("17:45"); // intraday
        if (i % 7 === 0) times.push("20:45"); // open in EST, closed in EDT
        if (i % 11 === 0) times.push("22:30"); // after the close
        for (const t of times) {
          const at = new Date(`${day}T${t}:00Z`);
          const r = await runCycle(deps, at);
          expect(r.status, `${at.toISOString()} ${r.notes.join(";")}`).toBe("OK");
          expect(r.notes.filter((n) => /failed|error/i.test(n))).toEqual([]);
          cycles++;
          orders += r.orders;
          // Full invariant pass on a subset (they are expensive); cheap ones always.
          await assertInvariants(pool, i % 3 === 0 ? r.cycleId : undefined);
        }
      }
      expect(cycles).toBeGreaterThan(300);
      expect(orders).toBeGreaterThan(10);
      const [perfDays] = await query(pool, "SELECT COUNT(DISTINCT date)::int AS n FROM performance_daily");
      expect(perfDays.n).toBe(days.length);
      const [inc] = await query(pool, "SELECT COUNT(*)::int AS n FROM incidents WHERE severity = 'CRITICAL'");
      expect(inc.n).toBe(0);
    },
    30 * 60_000,
  );
});
