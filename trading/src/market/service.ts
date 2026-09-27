import { query, maybeOne, type Db } from "../db/pool.js";
import type { AssetRow } from "../assets/universe.js";
import type { Bar, FxProvider, FxQuote, MarketDataProvider, MarketSnapshot, Quote } from "./types.js";
import { addDays, isoDate, minutesBetween, zonedTimeToUtc } from "../lib/time.js";
import { errMsg, log } from "../lib/logger.js";

const HISTORY_DAYS = 420;

/** Daily bar becomes usable 15 minutes after the NY close of its session. */
export function barAvailableAt(sessionDate: string): Date {
  return new Date(zonedTimeToUtc(sessionDate, "16:00", "America/New_York").getTime() + 15 * 60_000);
}

/** Calendar days of already-stored history re-requested to detect corporate-action re-adjustment. */
const OVERLAP_DAYS = 10;
/** Relative close difference above which stored (adjusted) history is considered stale. */
const READJUST_TOLERANCE = 1e-4;

async function upsertBars(db: Db, provider: MarketDataProvider, assetId: string, list: Bar[], overwrite: boolean): Promise<void> {
  for (const b of list) {
    const session = isoDate(b.ts);
    await query(
      db,
      `INSERT INTO market_bars (asset_id, timeframe, ts, open, high, low, close, volume, provider, adjusted, available_at)
       VALUES ($1, '1Day', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (asset_id, timeframe, ts, provider) DO ${
         overwrite
           ? "UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume, adjusted = EXCLUDED.adjusted, ingested_at = now()"
           : "NOTHING"
       }`,
      [assetId, b.ts, b.open, b.high, b.low, b.close, b.volume, provider.name, provider.name === "alpaca", barAvailableAt(session)],
    );
  }
}

/**
 * Fetches missing daily bars. Bars are requested split/dividend-adjusted, and a later
 * corporate action re-adjusts all earlier history; storing only the new bars would splice
 * two price bases together (a 2:1 split would look like a -50% day). Each incremental
 * fetch therefore re-requests a small overlap and, if the overlap no longer matches what
 * is stored, re-downloads and overwrites that symbol's full history.
 */
export async function ensureDailyBars(db: Db, provider: MarketDataProvider, assets: AssetRow[], now: Date): Promise<void> {
  const end = isoDate(addDays(now, -1));
  const fullStart = isoDate(addDays(now, -HISTORY_DAYS));
  const lastStored = new Map<string, string>();
  const bySymbolStart = new Map<string, string>();
  for (const a of assets) {
    const row = await maybeOne<{ max: string | null }>(
      db,
      "SELECT to_char(max(ts), 'YYYY-MM-DD') AS max FROM market_bars WHERE asset_id = $1 AND timeframe = '1Day' AND provider = $2",
      [a.id, provider.name],
    );
    if (!row?.max) {
      if (fullStart <= end) bySymbolStart.set(a.symbol, fullStart);
      continue;
    }
    const next = isoDate(addDays(new Date(`${row.max}T00:00:00Z`), 1));
    if (next > end) continue; // up to date
    lastStored.set(a.symbol, row.max);
    bySymbolStart.set(a.symbol, isoDate(addDays(new Date(`${row.max}T00:00:00Z`), -OVERLAP_DAYS)));
  }
  if (bySymbolStart.size === 0) return;
  // Group symbols by start date to minimise requests.
  const groups = new Map<string, string[]>();
  for (const [s, start] of bySymbolStart) groups.set(start, [...(groups.get(start) ?? []), s]);
  const byId = new Map(assets.map((a) => [a.symbol, a]));
  const readjust: string[] = [];
  for (const [start, symbols] of groups) {
    const bars = await provider.getDailyBars(symbols, start, end);
    for (const [symbol, list] of Object.entries(bars)) {
      const asset = byId.get(symbol);
      if (!asset) continue;
      const last = lastStored.get(symbol);
      if (last) {
        const overlap = list.filter((b) => isoDate(b.ts) <= last);
        if (overlap.length > 0) {
          const stored = await query<{ ts: Date; close: string }>(
            db,
            "SELECT ts, close FROM market_bars WHERE asset_id = $1 AND timeframe = '1Day' AND provider = $2 AND ts >= $3 AND ts <= $4",
            [asset.id, provider.name, overlap[0]!.ts, overlap.at(-1)!.ts],
          );
          const storedClose = new Map(stored.map((r) => [isoDate(r.ts), Number(r.close)]));
          const mismatch = overlap.some((b) => {
            const old = storedClose.get(isoDate(b.ts));
            return old !== undefined && Math.abs(b.close / old - 1) > READJUST_TOLERANCE;
          });
          if (mismatch) {
            readjust.push(symbol);
            continue;
          }
        }
      }
      await upsertBars(db, provider, asset.id, list, false);
    }
  }
  if (readjust.length > 0) {
    log.warn("stored daily bars no longer match the provider's adjusted history; reloading", { symbols: readjust });
    const bars = await provider.getDailyBars(readjust, fullStart, end);
    for (const [symbol, list] of Object.entries(bars)) {
      const asset = byId.get(symbol);
      if (asset) await upsertBars(db, provider, asset.id, list, true);
    }
  }
}

export async function loadBars(db: Db, providerName: string, assets: AssetRow[], asOf: Date): Promise<Map<string, Bar[]>> {
  const rows = await query<{ symbol: string; ts: Date; open: string; high: string; low: string; close: string; volume: string }>(
    db,
    `SELECT a.symbol, b.ts, b.open, b.high, b.low, b.close, b.volume
       FROM market_bars b JOIN assets a ON a.id = b.asset_id
      WHERE b.provider = $1 AND b.timeframe = '1Day' AND b.available_at <= $2 AND a.id = ANY($3)
      ORDER BY a.symbol, b.ts`,
    [providerName, asOf, assets.map((a) => a.id)],
  );
  const out = new Map<string, Bar[]>();
  for (const r of rows) {
    const list = out.get(r.symbol) ?? [];
    list.push({ ts: r.ts, open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume });
    out.set(r.symbol, list);
  }
  return out;
}

export async function currentFx(db: Db, fx: FxProvider): Promise<FxQuote> {
  try {
    const q = await fx.getUsdIls();
    await query(db, "INSERT INTO fx_rates (base, quote, rate, source, as_of) VALUES ($1, $2, $3, $4, $5)", [
      q.base,
      q.quote,
      q.rate,
      q.source,
      q.asOf,
    ]);
    return q;
  } catch (err) {
    const last = await maybeOne<{ rate: string; source: string; as_of: Date }>(
      db,
      "SELECT rate, source, as_of FROM fx_rates WHERE base = 'USD' AND quote = 'ILS' ORDER BY as_of DESC LIMIT 1",
    );
    if (last && minutesBetween(last.as_of, new Date()) < 5 * 24 * 60) {
      log.warn("fx provider failed; using last stored rate", { error: errMsg(err) });
      return { base: "USD", quote: "ILS", rate: +last.rate, source: `${last.source} (cached)`, asOf: last.as_of };
    }
    throw err;
  }
}

export interface SnapshotDeps {
  provider: MarketDataProvider;
  fx: FxProvider;
  maxQuoteAgeMinutes: number;
}

/** Builds and persists a point-in-time snapshot shared by all portfolios in a cycle. */
export async function buildSnapshot(db: Db, deps: SnapshotDeps, assets: AssetRow[], now: Date): Promise<MarketSnapshot> {
  const { provider } = deps;
  const clock = await provider.getClock(now);
  await ensureDailyBars(db, provider, assets, now);
  const bars = await loadBars(db, provider.name, assets, now);
  const fx = await currentFx(db, deps.fx);
  let quotes: Quote[] = [];
  let quoteError: string | undefined;
  try {
    quotes = await provider.getLatestQuotes(
      assets.map((a) => a.symbol),
      now,
    );
  } catch (err) {
    quoteError = errMsg(err);
  }
  const qmap = new Map(quotes.map((q) => [q.symbol, q]));
  const missing = assets.map((a) => a.symbol).filter((s) => !qmap.has(s));
  const stale = clock.isOpen
    ? quotes.filter((q) => minutesBetween(q.publishedAt, now) > deps.maxQuoteAgeMinutes).map((q) => q.symbol)
    : [];
  const status = quoteError ? "FAILED" : missing.length === assets.length ? "FAILED" : missing.length || stale.length ? "PARTIAL" : "OK";
  const batch = await maybeOne<{ id: string }>(
    db,
    `INSERT INTO market_data_batches (provider, feed, as_of, simulated, status, stats)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      provider.name,
      provider.feed,
      now,
      provider.simulated,
      status,
      JSON.stringify({ quotes: quotes.length, missing, stale, quoteError, clock: { ...clock }, fx }),
    ],
  );
  const idBySymbol = new Map(assets.map((a) => [a.symbol, a.id]));
  for (const q of quotes) {
    await query(
      db,
      "INSERT INTO market_quotes (batch_id, asset_id, bid, ask, last, published_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [batch!.id, idBySymbol.get(q.symbol), q.bid, q.ask, q.last, q.publishedAt],
    );
  }
  return {
    asOf: now,
    batchId: batch!.id,
    provider: provider.name,
    simulated: provider.simulated,
    clock,
    quotes: qmap,
    bars,
    staleSymbols: stale,
    missingSymbols: missing,
    fx,
  };
}
