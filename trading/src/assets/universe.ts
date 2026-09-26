import { query, type Db } from "../db/pool.js";

export interface AssetRow {
  id: string;
  symbol: string;
  exchange: string;
  market: string;
  asset_class: "STOCK" | "ETF";
  name: string;
  currency: string;
  price_unit: string;
  sector: string;
  is_leveraged: boolean;
  is_inverse: boolean;
  crypto_exposure: boolean;
  fractionable: boolean;
  verified: boolean;
  verified_source: string | null;
  active: boolean;
  cik: string | null;
}

type Seed = Omit<AssetRow, "id" | "market" | "currency" | "price_unit" | "is_leveraged" | "is_inverse" | "crypto_exposure" | "verified" | "verified_source" | "active"> & {
  verified?: boolean;
};

const SEED_SOURCE =
  "seed v1: plain, unleveraged, non-inverse, no crypto exposure per issuer description; owner should re-confirm on the Assets screen";

/**
 * Initial allowed universe (US only). Anything not in this table, or not
 * verified, can never be bought — the classification is data, not an LLM guess.
 */
export const SEED_ASSETS: Seed[] = [
  { symbol: "SPY", exchange: "ARCA", asset_class: "ETF", name: "SPDR S&P 500 ETF Trust", sector: "US_EQUITY_BROAD", fractionable: true, cik: null },
  { symbol: "VTI", exchange: "ARCA", asset_class: "ETF", name: "Vanguard Total Stock Market ETF", sector: "US_EQUITY_BROAD", fractionable: true, cik: null },
  { symbol: "QQQ", exchange: "NASDAQ", asset_class: "ETF", name: "Invesco QQQ Trust", sector: "US_EQUITY_GROWTH", fractionable: true, cik: null },
  { symbol: "IWM", exchange: "ARCA", asset_class: "ETF", name: "iShares Russell 2000 ETF", sector: "US_EQUITY_SMALL", fractionable: true, cik: null },
  { symbol: "EFA", exchange: "ARCA", asset_class: "ETF", name: "iShares MSCI EAFE ETF", sector: "INTL_EQUITY", fractionable: true, cik: null },
  { symbol: "VWO", exchange: "ARCA", asset_class: "ETF", name: "Vanguard FTSE Emerging Markets ETF", sector: "EM_EQUITY", fractionable: true, cik: null },
  { symbol: "BND", exchange: "NASDAQ", asset_class: "ETF", name: "Vanguard Total Bond Market ETF", sector: "BOND_AGG", fractionable: true, cik: null },
  { symbol: "IEF", exchange: "NASDAQ", asset_class: "ETF", name: "iShares 7-10 Year Treasury Bond ETF", sector: "BOND_TREASURY", fractionable: true, cik: null },
  { symbol: "TLT", exchange: "NASDAQ", asset_class: "ETF", name: "iShares 20+ Year Treasury Bond ETF", sector: "BOND_TREASURY_LONG", fractionable: true, cik: null },
  { symbol: "SHY", exchange: "NASDAQ", asset_class: "ETF", name: "iShares 1-3 Year Treasury Bond ETF", sector: "BOND_SHORT", fractionable: true, cik: null },
  { symbol: "GLD", exchange: "ARCA", asset_class: "ETF", name: "SPDR Gold Shares", sector: "GOLD", fractionable: true, cik: null },
  { symbol: "XLV", exchange: "ARCA", asset_class: "ETF", name: "Health Care Select Sector SPDR", sector: "HEALTHCARE", fractionable: true, cik: null },
  { symbol: "XLP", exchange: "ARCA", asset_class: "ETF", name: "Consumer Staples Select Sector SPDR", sector: "STAPLES", fractionable: true, cik: null },
  { symbol: "AAPL", exchange: "NASDAQ", asset_class: "STOCK", name: "Apple Inc.", sector: "TECHNOLOGY", fractionable: true, cik: "0000320193" },
  { symbol: "MSFT", exchange: "NASDAQ", asset_class: "STOCK", name: "Microsoft Corporation", sector: "TECHNOLOGY", fractionable: true, cik: "0000789019" },
  { symbol: "NVDA", exchange: "NASDAQ", asset_class: "STOCK", name: "NVIDIA Corporation", sector: "TECHNOLOGY", fractionable: true, cik: "0001045810" },
  { symbol: "GOOGL", exchange: "NASDAQ", asset_class: "STOCK", name: "Alphabet Inc. Class A", sector: "COMMUNICATION", fractionable: true, cik: "0001652044" },
  { symbol: "AMZN", exchange: "NASDAQ", asset_class: "STOCK", name: "Amazon.com, Inc.", sector: "CONSUMER_DISC", fractionable: true, cik: "0001018724" },
  { symbol: "META", exchange: "NASDAQ", asset_class: "STOCK", name: "Meta Platforms, Inc.", sector: "COMMUNICATION", fractionable: true, cik: "0001326801" },
  { symbol: "JNJ", exchange: "NYSE", asset_class: "STOCK", name: "Johnson & Johnson", sector: "HEALTHCARE", fractionable: true, cik: "0000200406" },
  { symbol: "PG", exchange: "NYSE", asset_class: "STOCK", name: "Procter & Gamble Co.", sector: "STAPLES", fractionable: true, cik: "0000080424" },
  { symbol: "KO", exchange: "NYSE", asset_class: "STOCK", name: "Coca-Cola Co.", sector: "STAPLES", fractionable: true, cik: "0000021344" },
  { symbol: "JPM", exchange: "NYSE", asset_class: "STOCK", name: "JPMorgan Chase & Co.", sector: "FINANCIALS", fractionable: true, cik: "0000019617" },
  { symbol: "XOM", exchange: "NYSE", asset_class: "STOCK", name: "Exxon Mobil Corporation", sector: "ENERGY", fractionable: true, cik: "0000034088" },
];

export async function seedAssets(db: Db): Promise<void> {
  for (const a of SEED_ASSETS) {
    await query(
      db,
      `INSERT INTO assets (symbol, exchange, asset_class, name, sector, fractionable, cik, verified, verified_source, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, now())
       ON CONFLICT (symbol, exchange) DO NOTHING`,
      [a.symbol, a.exchange, a.asset_class, a.name, a.sector, a.fractionable, a.cik, SEED_SOURCE],
    );
  }
}

export async function loadAssets(db: Db): Promise<Map<string, AssetRow>> {
  const rows = await query<AssetRow>(db, "SELECT * FROM assets WHERE market = 'US' ORDER BY symbol");
  return new Map(rows.map((r) => [r.symbol, r]));
}

/** Hard product-policy check (identical for paper and live). Empty array = tradeable. */
export function assetPolicyViolations(a: AssetRow | undefined): string[] {
  if (!a) return ["ASSET_NOT_IN_REGISTRY"];
  const out: string[] = [];
  if (!a.active) out.push("ASSET_INACTIVE");
  if (!a.verified) out.push("ASSET_CLASSIFICATION_NOT_VERIFIED");
  if (a.asset_class !== "STOCK" && a.asset_class !== "ETF") out.push("ASSET_CLASS_NOT_ALLOWED");
  if (a.is_leveraged) out.push("LEVERAGED_PRODUCT");
  if (a.is_inverse) out.push("INVERSE_PRODUCT");
  if (a.crypto_exposure) out.push("CRYPTO_EXPOSURE");
  if (a.market !== "US") out.push("MARKET_NOT_ENABLED");
  return out;
}
