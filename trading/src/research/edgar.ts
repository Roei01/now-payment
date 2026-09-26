import { query, maybeOne, type Db } from "../db/pool.js";
import { sha256 } from "../lib/crypto.js";
import type { AssetRow } from "../assets/universe.js";

/**
 * Point-in-time fundamentals from SEC EDGAR XBRL "companyfacts". Every value
 * carries the date it was filed, and only filings with filed <= asOf are used,
 * so a decision can never see a report published after it.
 */
const CONCEPTS: Record<string, { taxonomy: string; tags: string[]; unit: string }> = {
  revenue: { taxonomy: "us-gaap", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "USD" },
  netIncome: { taxonomy: "us-gaap", tags: ["NetIncomeLoss"], unit: "USD" },
  epsDiluted: { taxonomy: "us-gaap", tags: ["EarningsPerShareDiluted"], unit: "USD/shares" },
  operatingCashFlow: { taxonomy: "us-gaap", tags: ["NetCashProvidedByUsedInOperatingActivities"], unit: "USD" },
  capex: { taxonomy: "us-gaap", tags: ["PaymentsToAcquirePropertyPlantAndEquipment"], unit: "USD" },
  equity: { taxonomy: "us-gaap", tags: ["StockholdersEquity"], unit: "USD" },
  longTermDebt: { taxonomy: "us-gaap", tags: ["LongTermDebtNoncurrent", "LongTermDebt"], unit: "USD" },
  cash: { taxonomy: "us-gaap", tags: ["CashAndCashEquivalentsAtCarryingValue"], unit: "USD" },
  sharesOutstanding: { taxonomy: "dei", tags: ["EntityCommonStockSharesOutstanding"], unit: "shares" },
};

interface FactPoint {
  val: number;
  end: string;
  start?: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  accn: string;
}

export interface FundamentalsFact {
  metric: string;
  value: number;
  periodEnd: string;
  fiscalYear?: number;
  form: string;
  filed: string;
  accession: string;
  tag: string;
}

export interface FundamentalsSnapshot {
  symbol: string;
  cik: string;
  asOf: string;
  annual: Record<string, FundamentalsFact[]>; // last 3 fiscal years per metric
  latestShares?: FundamentalsFact;
  sourceUrl: string;
}

export function extractPointInTime(companyFacts: any, asOf: string, symbol: string, cik: string): FundamentalsSnapshot {
  const annual: Record<string, FundamentalsFact[]> = {};
  let latestShares: FundamentalsFact | undefined;
  for (const [metric, def] of Object.entries(CONCEPTS)) {
    for (const tag of def.tags) {
      const points: FactPoint[] = companyFacts?.facts?.[def.taxonomy]?.[tag]?.units?.[def.unit] ?? [];
      const known = points.filter((p) => p.filed <= asOf);
      if (known.length === 0) continue;
      if (metric === "sharesOutstanding") {
        const last = known.sort((a, b) => (a.filed < b.filed ? -1 : 1)).at(-1)!;
        latestShares = { metric, value: last.val, periodEnd: last.end, form: last.form, filed: last.filed, accession: last.accn, tag };
        break;
      }
      // Annual 10-K figures; for each fiscal-year end keep the earliest filing known at asOf (original, not restated later).
      const byEnd = new Map<string, FactPoint>();
      for (const p of known) {
        if (p.form !== "10-K" || (p.fp && p.fp !== "FY")) continue;
        if (p.start && (Date.parse(p.end) - Date.parse(p.start)) / 86_400_000 < 300) continue;
        const cur = byEnd.get(p.end);
        if (!cur || p.filed < cur.filed) byEnd.set(p.end, p);
      }
      const list = [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 3);
      if (list.length) {
        annual[metric] = list.map((p) => ({ metric, value: p.val, periodEnd: p.end, fiscalYear: p.fy, form: p.form, filed: p.filed, accession: p.accn, tag }));
        break;
      }
    }
  }
  return {
    symbol,
    cik,
    asOf,
    annual,
    latestShares,
    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  };
}

export class EdgarFundamentals {
  constructor(private userAgent: string, private fetchImpl: typeof fetch = fetch) {}

  async companyFacts(cik: string): Promise<any> {
    const res = await this.fetchImpl(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": this.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`SEC EDGAR ${res.status} for CIK ${cik}`);
    return res.json();
  }
}

/**
 * Returns a stored research artifact with point-in-time fundamentals, fetching at
 * most once per day per company (cache), so the AI prompt can cite it by id.
 */
export async function fundamentalsArtifact(
  db: Db,
  edgar: EdgarFundamentals | undefined,
  asset: AssetRow,
  asOf: Date,
): Promise<{ id: string; snapshot: FundamentalsSnapshot } | undefined> {
  if (!asset.cik) return undefined;
  const asOfDate = asOf.toISOString().slice(0, 10);
  const cached = await maybeOne<{ id: string; payload: FundamentalsSnapshot }>(
    db,
    `SELECT id, payload FROM research_artifacts WHERE kind = 'FUNDAMENTALS' AND asset_id = $1 AND payload->>'asOf' = $2
      ORDER BY ingested_at DESC LIMIT 1`,
    [asset.id, asOfDate],
  );
  if (cached) return { id: cached.id, snapshot: cached.payload };
  if (!edgar) return undefined;
  const facts = await edgar.companyFacts(asset.cik);
  const snapshot = extractPointInTime(facts, asOfDate, asset.symbol, asset.cik);
  const filedDates = Object.values(snapshot.annual).flat().map((f) => f.filed).sort();
  const published = filedDates.at(-1) ?? null;
  const rows = await query<{ id: string }>(
    db,
    `INSERT INTO research_artifacts (kind, asset_id, source, source_url, title, published_at, available_at, content_hash, payload)
     VALUES ('FUNDAMENTALS', $1, 'SEC EDGAR companyfacts', $2, $3, $4, now(), $5, $6)
     ON CONFLICT (kind, content_hash) DO UPDATE SET ingested_at = research_artifacts.ingested_at RETURNING id`,
    [asset.id, snapshot.sourceUrl, `${asset.symbol} annual fundamentals as of ${asOfDate}`, published, sha256(JSON.stringify(snapshot)), JSON.stringify(snapshot)],
  );
  return { id: rows[0]!.id, snapshot };
}
