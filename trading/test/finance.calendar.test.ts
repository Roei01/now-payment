process.env.TEST_DATABASE_URL ??= "postgres://postgres@127.0.0.1:5433/fin_cal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshDb, closePool } from "./helpers.js";
import { zonedParts, zonedTimeToUtc, isoDate, addDays } from "../src/lib/time.js";
import { simulatedClock, SimulatedMarketData } from "../src/market/simulated.js";
import { barAvailableAt, ensureDailyBars, loadBars } from "../src/market/service.js";
import { seedAssets, loadAssets } from "../src/assets/universe.js";
import type { Bar } from "../src/market/types.js";

const NY = "America/New_York";

describe("America/New_York DST", () => {
  const cases: [string, string, string][] = [
    // date, NY wall time, expected UTC
    ["2025-03-07", "09:30", "2025-03-07T14:30:00.000Z"], // Friday before spring-forward (EST)
    ["2025-03-07", "16:00", "2025-03-07T21:00:00.000Z"],
    ["2025-03-09", "12:00", "2025-03-09T16:00:00.000Z"], // DST day itself, after the switch
    ["2025-03-09", "01:59", "2025-03-09T06:59:00.000Z"], // just before the gap
    ["2025-03-09", "03:00", "2025-03-09T07:00:00.000Z"], // just after the gap
    ["2025-03-10", "09:30", "2025-03-10T13:30:00.000Z"], // Monday after (EDT)
    ["2025-03-10", "16:00", "2025-03-10T20:00:00.000Z"],
    ["2025-10-31", "09:30", "2025-10-31T13:30:00.000Z"], // Friday before fall-back (EDT)
    ["2025-11-02", "12:00", "2025-11-02T17:00:00.000Z"],
    ["2025-11-03", "09:30", "2025-11-03T14:30:00.000Z"], // Monday after (EST)
    ["2025-11-03", "16:00", "2025-11-03T21:00:00.000Z"],
    ["2026-03-09", "09:30", "2026-03-09T13:30:00.000Z"], // 2026 spring-forward is Mar 8
    ["2026-11-02", "09:30", "2026-11-02T14:30:00.000Z"], // 2026 fall-back is Nov 1
    ["2025-12-31", "23:30", "2026-01-01T04:30:00.000Z"], // crosses the UTC year boundary
  ];
  it.each(cases)("zonedTimeToUtc(%s %s) = %s", (d, t, exp) => {
    expect(zonedTimeToUtc(d, t, NY).toISOString()).toBe(exp);
  });

  it("round-trips every quarter hour of every day in 2024–2026 (except the spring-forward gap)", () => {
    for (let d = new Date("2024-01-01T12:00:00Z"); d < new Date("2027-01-01T00:00:00Z"); d = addDays(d, 1)) {
      const ds = isoDate(d);
      for (let m = 0; m < 24 * 60; m += 15) {
        const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        const u = zonedTimeToUtc(ds, hhmm, NY);
        const p = zonedParts(u, NY);
        const back = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
        if (p.dateStr === ds && back === hhmm) continue;
        // Only a wall time that does not exist (02:00–02:59 on the spring-forward Sunday) may fail to round-trip.
        expect(hhmm.startsWith("02:"), `${ds} ${hhmm} -> ${u.toISOString()} (${p.dateStr} ${back})`).toBe(true);
        expect(zonedParts(u, NY).hour).toBe(3);
      }
    }
  });

  it("simulated clock opens at 09:30 and closes at 16:00 New York time on both sides of DST", () => {
    const check = (iso: string, open: boolean, session: string) => {
      const c = simulatedClock(new Date(iso));
      expect(c.isOpen, iso).toBe(open);
      expect(c.sessionDate, iso).toBe(session);
    };
    check("2025-03-07T14:29:00Z", false, "2025-03-07");
    check("2025-03-07T14:30:00Z", true, "2025-03-07");
    check("2025-03-07T20:59:00Z", true, "2025-03-07");
    check("2025-03-07T21:00:00Z", false, "2025-03-07");
    check("2025-03-10T13:29:00Z", false, "2025-03-10");
    check("2025-03-10T13:30:00Z", true, "2025-03-10");
    check("2025-03-10T19:59:00Z", true, "2025-03-10");
    check("2025-03-10T20:00:00Z", false, "2025-03-10");
    check("2025-11-03T13:30:00Z", false, "2025-11-03");
    check("2025-11-03T14:30:00Z", true, "2025-11-03");
    check("2025-11-03T20:30:00Z", true, "2025-11-03");
    check("2025-11-03T21:00:00Z", false, "2025-11-03");
    check("2025-11-04T02:00:00Z", false, "2025-11-03"); // Monday evening NY, Tuesday in UTC
    check("2025-03-09T15:00:00Z", false, "2025-03-09"); // Sunday
  });

  it("nextOpen/nextClose are correct across DST weekends", () => {
    const fri = simulatedClock(new Date("2025-03-07T22:00:00Z"));
    expect(fri.nextOpen.toISOString()).toBe("2025-03-10T13:30:00.000Z");
    expect(fri.nextClose.toISOString()).toBe("2025-03-10T20:00:00.000Z");
    const fri2 = simulatedClock(new Date("2025-10-31T21:00:00Z"));
    expect(fri2.nextOpen.toISOString()).toBe("2025-11-03T14:30:00.000Z");
    const open = simulatedClock(new Date("2025-11-03T15:00:00Z"));
    expect(open.nextClose.toISOString()).toBe("2025-11-03T21:00:00.000Z");
    expect(open.nextOpen.toISOString()).toBe("2025-11-04T14:30:00.000Z");
    const before = simulatedClock(new Date("2025-11-03T12:00:00Z"));
    expect(before.nextOpen.toISOString()).toBe("2025-11-03T14:30:00.000Z");
  });

  it("the market is open for exactly 6.5 hours on every weekday of 2025 (DST included)", () => {
    for (let d = new Date("2025-01-01T12:00:00Z"); d < new Date("2026-01-01T00:00:00Z"); d = addDays(d, 1)) {
      const ds = isoDate(d);
      const wd = d.getUTCDay();
      let minutes = 0;
      const start = zonedTimeToUtc(ds, "00:00", NY).getTime();
      for (let t = start; t < start + 26 * 3600_000; t += 5 * 60_000) {
        const c = simulatedClock(new Date(t));
        if (c.isOpen && c.sessionDate === ds) minutes += 5;
      }
      expect(minutes, ds).toBe(wd === 0 || wd === 6 ? 0 : 390);
    }
  });
});

describe("bar availability (no look-ahead)", () => {
  it("a daily bar is never available before its session's NY close", () => {
    for (let d = new Date("2024-01-01T12:00:00Z"); d < new Date("2027-01-01T00:00:00Z"); d = addDays(d, 1)) {
      const ds = isoDate(d);
      const at = barAvailableAt(ds);
      expect(at.getTime()).toBeGreaterThanOrEqual(zonedTimeToUtc(ds, "16:00", NY).getTime());
      const p = zonedParts(at, NY);
      expect(p.dateStr).toBe(ds);
      expect(`${p.hour}:${p.minute}`).toBe("16:15");
    }
  });

  let pool: pg.Pool;
  beforeAll(async () => {
    pool = await freshDb();
    await seedAssets(pool);
  });
  afterAll(async () => closePool());

  it("loadBars hides today's bar until 16:15 New York even if a provider hands it over early", async () => {
    const sim = new SimulatedMarketData();
    // A misbehaving provider that returns bars up to and including 'today' regardless of `end`.
    const eager = {
      ...sim,
      name: "eager",
      feed: "x",
      simulated: true,
      getClock: sim.getClock.bind(sim),
      getLatestQuotes: sim.getLatestQuotes.bind(sim),
      getDailyBars: async (symbols: string[], start: string) => sim.getDailyBars(symbols, start, "2025-11-03"),
    };
    const assets = [...(await loadAssets(pool)).values()].filter((a) => a.symbol === "SPY" || a.symbol === "BND");
    await ensureDailyBars(pool, eager, assets, new Date("2025-11-03T15:00:00Z"));
    const lastDate = (bars: Map<string, Bar[]>) => isoDate(bars.get("SPY")!.at(-1)!.ts);
    // During the session and right at the close: yesterday is the latest usable bar.
    expect(lastDate(await loadBars(pool, "eager", assets, new Date("2025-11-03T15:00:00Z")))).toBe("2025-10-31");
    expect(lastDate(await loadBars(pool, "eager", assets, new Date("2025-11-03T21:14:59Z")))).toBe("2025-10-31");
    expect(lastDate(await loadBars(pool, "eager", assets, new Date("2025-11-03T21:15:00Z")))).toBe("2025-11-03");
    // Summer (EDT): the same bar would be usable an hour earlier in UTC.
    await ensureDailyBars(pool, { ...eager, getDailyBars: async (s: string[], start: string) => sim.getDailyBars(s, start, "2025-06-10") } as never, assets, new Date("2025-06-10T15:00:00Z"));
    const summer = await loadBars(pool, "eager", assets, new Date("2025-06-10T20:14:00Z"));
    expect(summer.get("SPY")!.some((b) => isoDate(b.ts) === "2025-06-10")).toBe(false);
  });

  it("the simulated quote never reveals a price from after `now`", async () => {
    const sim = new SimulatedMarketData();
    const bars = await sim.getDailyBars(["SPY"], "2025-06-01", "2025-06-30");
    const jun10 = bars.SPY!.find((b) => isoDate(b.ts) === "2025-06-10")!;
    const jun9 = bars.SPY!.find((b) => isoDate(b.ts) === "2025-06-09")!;
    const [pre] = await sim.getLatestQuotes(["SPY"], new Date("2025-06-10T13:00:00Z")); // before open
    expect(pre!.last).toBeCloseTo(jun9.close, 8);
    expect(pre!.publishedAt.getTime()).toBeLessThanOrEqual(new Date("2025-06-10T13:00:00Z").getTime());
    const [atOpen] = await sim.getLatestQuotes(["SPY"], new Date("2025-06-10T13:30:00Z"));
    expect(atOpen!.last).toBeCloseTo(jun10.open, 8);
  });
});
