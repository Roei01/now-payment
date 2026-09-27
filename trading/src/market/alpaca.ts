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

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Authenticated JSON request. GET requests
 * are retried on 429/5xx with backoff (Retry-After honoured, capped); writes are never
 * retried here because the caller must reconcile by client_order_id instead.
 */
export async function alpacaFetch<T>(
  base: string,
  path: string,
  creds: AlpacaCreds,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        "APCA-API-KEY-ID": creds.keyId,
        "APCA-API-SECRET-KEY": creds.secret,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      if (attempt < maxAttempts && RETRYABLE_STATUS.has(res.status)) {
        const retryAfter = Number(res.headers?.get?.("retry-after"));
        const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt, 10_000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      const err = new Error(`alpaca ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}

const isPrice = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

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
    type Clock = { is_open: boolean; next_open: string; next_close: string; timestamp: string };
    // /v2/clock is a Trading API endpoint; paper keys work on the paper host, live keys on the live host.
    let c: Clock;
    try {
      c = await alpacaFetch<Clock>(ALPACA_URLS.paper, "/v2/clock", this.creds, {}, this.fetchImpl);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 401 && status !== 403) throw err;
      c = await alpacaFetch<Clock>(ALPACA_URLS.live, "/v2/clock", this.creds, {}, this.fetchImpl);
    }
    if (typeof c.is_open !== "boolean" || Number.isNaN(Date.parse(c.next_open)) || Number.isNaN(Date.parse(c.next_close)))
      throw new Error("alpaca /v2/clock: malformed response");
    return {
      isOpen: c.is_open,
      sessionDate: zonedParts(now, "America/New_York").dateStr,
      nextOpen: new Date(c.next_open),
      nextClose: new Date(c.next_close),
      source: "alpaca/v2/clock",
      approximate: false,
    };
  }

  /** GET /v2/stocks/snapshots — multi-symbol response is keyed by symbol at the top level. */
  async getLatestQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    type Snap = {
      latestTrade?: { p: number; t: string } | null;
      latestQuote?: { bp: number; ap: number; t: string } | null;
    } | null;
    const params = new URLSearchParams({ symbols: symbols.join(","), feed: this.feed });
    const data = await alpacaFetch<Record<string, Snap>>(ALPACA_URLS.data, `/v2/stocks/snapshots?${params}`, this.creds, {}, this.fetchImpl);
    const out: Quote[] = [];
    for (const symbol of symbols) {
      const s = data[symbol];
      const trade = s?.latestTrade;
      if (!trade || !isPrice(trade.p)) continue;
      const tradeAt = new Date(trade.t);
      if (Number.isNaN(tradeAt.getTime())) continue;
      const q = s?.latestQuote;
      const quoteAt = q ? new Date(q.t) : undefined;
      // bp/ap are 0 when a side is empty; a crossed quote is unusable.
      let bid = q && isPrice(q.bp) ? q.bp : null;
      let ask = q && isPrice(q.ap) ? q.ap : null;
      if (bid !== null && ask !== null && ask < bid) bid = ask = null;
      out.push({
        symbol,
        bid,
        ask,
        last: trade.p,
        publishedAt: quoteAt && !Number.isNaN(quoteAt.getTime()) && quoteAt > tradeAt ? quoteAt : tradeAt,
      });
    }
    return out;
  }

  /**
   * GET /v2/stocks/bars (timeframe=1Day). Daily bars are stamped at midnight America/New_York
   * (e.g. 2022-04-11T04:00:00Z), so the session date is the NY calendar date of `t`.
   * start/end are sent as explicit RFC-3339 instants covering the whole session dates;
   * `limit` (max 10000) applies to the page across all symbols, so pagination is required.
   */
  async getDailyBars(symbols: string[], start: string, end: string): Promise<Record<string, Bar[]>> {
    const out: Record<string, Bar[]> = Object.fromEntries(symbols.map((s) => [s, []]));
    if (symbols.length === 0 || start > end) return out;
    const wanted = new Set(symbols);
    const seen = new Set<string>();
    let pageToken: string | undefined;
    let pages = 0;
    do {
      if (++pages > 1000) throw new Error("alpaca bars: pagination did not terminate");
      const params = new URLSearchParams({
        symbols: symbols.join(","),
        timeframe: "1Day",
        start: `${start}T00:00:00Z`,
        end: `${end}T23:59:59Z`,
        adjustment: "all",
        feed: this.feed,
        limit: "10000",
        sort: "asc",
      });
      if (pageToken) params.set("page_token", pageToken);
      const data = await alpacaFetch<{
        bars: Record<string, { t: string; o: number; h: number; l: number; c: number; v: number }[]> | null;
        next_page_token?: string | null;
      }>(ALPACA_URLS.data, `/v2/stocks/bars?${params}`, this.creds, {}, this.fetchImpl);
      for (const [sym, bars] of Object.entries(data.bars ?? {})) {
        if (!wanted.has(sym)) continue;
        for (const b of bars ?? []) {
          const t = new Date(b.t);
          if (Number.isNaN(t.getTime())) continue;
          const session = zonedParts(t, "America/New_York").dateStr;
          if (session < start || session > end) continue;
          if (![b.o, b.h, b.l, b.c].every(isPrice) || !(b.h >= b.l) || !(typeof b.v === "number" && b.v >= 0)) continue;
          const key = `${sym}|${session}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out[sym]!.push({ ts: new Date(`${session}T00:00:00Z`), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
        }
      }
      pageToken = data.next_page_token || undefined;
    } while (pageToken);
    for (const s of Object.keys(out)) out[s]!.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    return out;
  }
}
