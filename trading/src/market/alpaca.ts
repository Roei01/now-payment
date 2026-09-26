import type { Bar, MarketClock, MarketDataProvider, Quote } from "./types.js";
import { zonedParts } from "../lib/time.js";

export interface AlpacaCreds {
  keyId: string;
  secret: string;
}

export const ALPACA_URLS = {
  data: "https://data.alpaca.markets",
  paper: "https://paper-api.alpaca.markets",
  live: "https://api.alpaca.markets",
} as const;

export async function alpacaFetch<T>(
  base: string,
  path: string,
  creds: AlpacaCreds,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${base}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": creds.keyId,
      "APCA-API-SECRET-KEY": creds.secret,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`alpaca ${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Alpaca Market Data API v2. The free "iex" feed covers a single venue and is
 * not the consolidated tape; the feed is recorded on every batch.
 */
export class AlpacaMarketData implements MarketDataProvider {
  readonly name = "alpaca";
  readonly simulated = false;
  constructor(
    private creds: AlpacaCreds,
    readonly feed: "iex" | "sip" = "iex",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async getClock(now: Date): Promise<MarketClock> {
    const c = await alpacaFetch<{ is_open: boolean; next_open: string; next_close: string; timestamp: string }>(
      ALPACA_URLS.paper,
      "/v2/clock",
      this.creds,
      {},
      this.fetchImpl,
    );
    return {
      isOpen: c.is_open,
      sessionDate: zonedParts(now, "America/New_York").dateStr,
      nextOpen: new Date(c.next_open),
      nextClose: new Date(c.next_close),
      source: "alpaca/v2/clock",
      approximate: false,
    };
  }

  async getLatestQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    type Snap = {
      latestTrade?: { p: number; t: string };
      latestQuote?: { bp: number; ap: number; t: string };
    };
    const data = await alpacaFetch<Record<string, Snap>>(
      ALPACA_URLS.data,
      `/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=${this.feed}`,
      this.creds,
      {},
      this.fetchImpl,
    );
    const out: Quote[] = [];
    for (const symbol of symbols) {
      const s = data[symbol];
      if (!s?.latestTrade) continue;
      const tradeAt = new Date(s.latestTrade.t);
      const quoteAt = s.latestQuote ? new Date(s.latestQuote.t) : tradeAt;
      out.push({
        symbol,
        bid: s.latestQuote?.bp || null,
        ask: s.latestQuote?.ap || null,
        last: s.latestTrade.p,
        publishedAt: quoteAt > tradeAt ? quoteAt : tradeAt,
      });
    }
    return out;
  }

  async getDailyBars(symbols: string[], start: string, end: string): Promise<Record<string, Bar[]>> {
    const out: Record<string, Bar[]> = Object.fromEntries(symbols.map((s) => [s, []]));
    if (symbols.length === 0) return out;
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        symbols: symbols.join(","),
        timeframe: "1Day",
        start,
        end,
        adjustment: "all",
        feed: this.feed,
        limit: "10000",
      });
      if (pageToken) params.set("page_token", pageToken);
      const data = await alpacaFetch<{
        bars: Record<string, { t: string; o: number; h: number; l: number; c: number; v: number }[]>;
        next_page_token?: string | null;
      }>(ALPACA_URLS.data, `/v2/stocks/bars?${params}`, this.creds, {}, this.fetchImpl);
      for (const [sym, bars] of Object.entries(data.bars ?? {})) {
        for (const b of bars) {
          const session = zonedParts(new Date(b.t), "America/New_York").dateStr;
          (out[sym] ??= []).push({ ts: new Date(`${session}T00:00:00Z`), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
        }
      }
      pageToken = data.next_page_token ?? undefined;
    } while (pageToken);
    for (const s of Object.keys(out)) out[s]!.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    return out;
  }
}
