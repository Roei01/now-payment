import type { Bar, MarketClock, MarketDataProvider, Quote } from "./types.js";
import { zonedParts, zonedTimeToUtc, isoDate, addDays } from "../lib/time.js";

const NY = "America/New_York";

function hashSeed(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const PROFILE: Record<string, { start: number; drift: number; vol: number; beta: number }> = {
  SPY: { start: 450, drift: 0.08, vol: 0.17, beta: 1 },
  BND: { start: 72, drift: 0.02, vol: 0.06, beta: 0.05 },
  TLT: { start: 95, drift: 0.01, vol: 0.15, beta: -0.1 },
  SHY: { start: 82, drift: 0.03, vol: 0.02, beta: 0 },
  GLD: { start: 190, drift: 0.05, vol: 0.14, beta: 0.1 },
  VTI: { start: 220, drift: 0.08, vol: 0.18, beta: 1.02 },
  QQQ: { start: 370, drift: 0.1, vol: 0.23, beta: 1.2 },
  IWM: { start: 190, drift: 0.06, vol: 0.24, beta: 1.15 },
  EFA: { start: 72, drift: 0.05, vol: 0.16, beta: 0.85 },
  VWO: { start: 41, drift: 0.04, vol: 0.19, beta: 0.8 },
  IEF: { start: 95, drift: 0.02, vol: 0.08, beta: 0 },
  XLV: { start: 135, drift: 0.06, vol: 0.15, beta: 0.7 },
  XLP: { start: 72, drift: 0.05, vol: 0.13, beta: 0.6 },
};

function isWeekday(dateStr: string): boolean {
  const d = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

const EPOCH = "2023-01-02";

/**
 * Deterministic synthetic market for development and tests. Prices are NOT real;
 * everything produced from it is flagged `simulated` and can never pass the promotion gate.
 */
export class SimulatedMarketData implements MarketDataProvider {
  readonly name = "simulated";
  readonly feed = "synthetic";
  readonly simulated = true;
  private cache = new Map<string, Map<string, Bar>>();

  private series(symbol: string, until: string): Map<string, Bar> {
    let s = this.cache.get(symbol);
    const lastKey = s ? [...s.keys()].at(-1) : undefined;
    if (s && lastKey && lastKey >= until) return s;
    s = new Map();
    const p = PROFILE[symbol] ?? { start: 50 + (hashSeed(symbol) % 300), drift: 0.07, vol: 0.28, beta: 1.1 };
    const rand = mulberry32(hashSeed(`sim:${symbol}`));
    const market = mulberry32(hashSeed("sim:market"));
    let price = p.start;
    for (let d = new Date(`${EPOCH}T00:00:00Z`); isoDate(d) <= until; d = addDays(d, 1)) {
      const ds = isoDate(d);
      if (!isWeekday(ds)) continue;
      const mkt = gaussian(market);
      const idio = gaussian(rand);
      const dailyVol = p.vol / Math.sqrt(252);
      const mktShare = Math.min(Math.abs(p.beta), 1);
      const shock = dailyVol * (mktShare * Math.sign(p.beta || 1) * mkt + Math.sqrt(1 - mktShare ** 2) * idio);
      const open = price;
      const close = Math.max(1, price * Math.exp(p.drift / 252 - 0.5 * dailyVol ** 2 + shock));
      const hi = Math.max(open, close) * (1 + Math.abs(gaussian(rand)) * dailyVol * 0.3);
      const lo = Math.min(open, close) * (1 - Math.abs(gaussian(rand)) * dailyVol * 0.3);
      s.set(ds, { ts: new Date(`${ds}T00:00:00Z`), open, high: hi, low: lo, close, volume: 1_000_000 + Math.floor(rand() * 5e6) });
      price = close;
    }
    this.cache.set(symbol, s);
    return s;
  }

  async getClock(now: Date): Promise<MarketClock> {
    return simulatedClock(now);
  }

  async getLatestQuotes(symbols: string[], now: Date): Promise<Quote[]> {
    const clock = simulatedClock(now);
    const today = clock.sessionDate;
    return symbols.map((symbol) => {
      const s = this.series(symbol, today);
      const bars = [...s.values()].filter((b) => isoDate(b.ts) <= today);
      const todayBar = s.get(today);
      const prev = bars.filter((b) => isoDate(b.ts) < today).at(-1) ?? bars.at(-1)!;
      let last = prev.close;
      let publishedAt = zonedTimeToUtc(isoDate(prev.ts), "16:00", NY);
      if (todayBar) {
        const open = zonedTimeToUtc(today, "09:30", NY).getTime();
        const close = zonedTimeToUtc(today, "16:00", NY).getTime();
        const f = Math.min(1, Math.max(0, (now.getTime() - open) / (close - open)));
        if (now.getTime() >= open) {
          last = todayBar.open + (todayBar.close - todayBar.open) * f;
          publishedAt = new Date(Math.min(now.getTime(), close));
        }
      }
      const spread = last * 0.0002;
      return { symbol, bid: last - spread / 2, ask: last + spread / 2, last, publishedAt };
    });
  }

  async getDailyBars(symbols: string[], start: string, end: string): Promise<Record<string, Bar[]>> {
    const out: Record<string, Bar[]> = {};
    for (const symbol of symbols) {
      const s = this.series(symbol, end);
      out[symbol] = [...s.values()].filter((b) => {
        const d = isoDate(b.ts);
        return d >= start && d <= end;
      });
    }
    return out;
  }
}

/** Weekday 09:30–16:00 New York; holidays unknown (approximate). */
export function simulatedClock(now: Date): MarketClock {
  const p = zonedParts(now, NY);
  const today = p.dateStr;
  const open = zonedTimeToUtc(today, "09:30", NY);
  const close = zonedTimeToUtc(today, "16:00", NY);
  const weekday = isWeekday(today);
  const isOpen = weekday && now >= open && now < close;
  let nextOpenDate = today;
  if (!weekday || now >= open) {
    let d = addDays(new Date(`${today}T12:00:00Z`), 1);
    while (!isWeekday(isoDate(d))) d = addDays(d, 1);
    nextOpenDate = isoDate(d);
  }
  const nextOpen = zonedTimeToUtc(nextOpenDate, "09:30", NY);
  const nextClose = isOpen ? close : zonedTimeToUtc(nextOpenDate, "16:00", NY);
  return { isOpen, sessionDate: today, nextOpen, nextClose, source: "simulated-weekday-calendar", approximate: true };
}
