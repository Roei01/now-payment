export interface Bar {
  ts: Date; // session date at 00:00 UTC for daily bars
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number;
  publishedAt: Date;
}

export interface MarketClock {
  isOpen: boolean;
  sessionDate: string; // YYYY-MM-DD in America/New_York
  nextOpen: Date;
  nextClose: Date;
  source: string; // where the calendar came from
  approximate: boolean; // true when holidays are not known (simulated calendar)
}

export interface MarketDataProvider {
  readonly name: string;
  readonly feed: string;
  readonly simulated: boolean;
  getClock(now: Date): Promise<MarketClock>;
  getLatestQuotes(symbols: string[], now: Date): Promise<Quote[]>;
  /** Daily bars with session dates in [start, end] inclusive. */
  getDailyBars(symbols: string[], start: string, end: string): Promise<Record<string, Bar[]>>;
}

export interface FxQuote {
  base: string;
  quote: string;
  rate: number;
  source: string;
  asOf: Date;
}

export interface FxProvider {
  readonly name: string;
  getUsdIls(date?: string): Promise<FxQuote>;
}

/** A point-in-time view used by strategies and the risk engine for one cycle. */
export interface MarketSnapshot {
  asOf: Date;
  batchId: string | null;
  provider: string;
  simulated: boolean;
  clock: MarketClock;
  quotes: Map<string, Quote>;
  bars: Map<string, Bar[]>; // only bars available at asOf, ascending
  staleSymbols: string[];
  missingSymbols: string[];
  fx: FxQuote;
}

export function midPrice(q: Quote): number {
  if (q.bid && q.ask && q.bid > 0 && q.ask >= q.bid) return (q.bid + q.ask) / 2;
  return q.last;
}
