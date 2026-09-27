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

/** EDGAR APIs take the CIK as exactly ten digits with leading zeros. */
export function padCik(cik: string): string {
  const digits = cik.trim().replace(/^CIK/i, "");
  if (!/^\d{1,10}$/.test(digits)) throw new Error(`invalid CIK '${cik}'`);
  return digits.padStart(10, "0");
}

export function companyFactsUrl(cik: string): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function extractPointInTime(companyFacts: any, asOf: string, symbol: string, cik: string): FundamentalsSnapshot {
  const annual: Record<string, FundamentalsFact[]> = {};
  let latestShares: FundamentalsFact | undefined;
  for (const [metric, def] of Object.entries(CONCEPTS)) {
    if (metric === "sharesOutstanding") {
      // dei cover-page value (unit "shares"). Multi-class issuers (e.g. Alphabet) report one
      // entry per class for the same filing and date, so all entries of the latest filing are summed.
      for (const tag of def.tags) {
        const points: FactPoint[] = (companyFacts?.facts?.[def.taxonomy]?.[tag]?.units?.[def.unit] ?? []).filter(
          (p: FactPoint) => isNum(p.val) && typeof p.filed === "string" && p.filed <= asOf,
        );
        if (points.length === 0) continue;
        const latest = points.reduce((m, p) => (p.filed > m.filed || (p.filed === m.filed && p.end > m.end) ? p : m));
        const sameReport = points.filter((p) => p.accn === latest.accn && p.end === latest.end);
        // Duplicate rows for the same class carry the same frame/val; de-duplicate by value+frame.
        const unique = new Map(sameReport.map((p) => [`${(p as FactPoint & { frame?: string }).frame ?? ""}|${p.val}`, p]));
        const total = [...unique.values()].reduce((sum, p) => sum + p.val, 0);
        latestShares = { metric, value: total, periodEnd: latest.end, form: latest.form, filed: latest.filed, accession: latest.accn, tag };
        break;
      }
      continue;
    }
    // Annual 10-K figures. Companies switch tags over time (e.g. SalesRevenueNet ->
    // RevenueFromContractWithCustomer...), so candidates from all tags are merged per period
    // end, preferring the first-listed tag; for each end the earliest filing known at asOf is
    // kept (the original figure, not a later restatement).
    const byEnd = new Map<string, { p: FactPoint; tag: string; rank: number }>();
    def.tags.forEach((tag, rank) => {
      const points: FactPoint[] = companyFacts?.facts?.[def.taxonomy]?.[tag]?.units?.[def.unit] ?? [];
      for (const p of points) {
        if (!isNum(p.val) || typeof p.filed !== "string" || p.filed > asOf) continue;
        if (p.form !== "10-K" || (p.fp && p.fp !== "FY")) continue;
        if (p.start && (Date.parse(p.end) - Date.parse(p.start)) / 86_400_000 < 300) continue;
        const cur = byEnd.get(p.end);
        if (!cur || rank < cur.rank || (rank === cur.rank && p.filed < cur.p.filed)) byEnd.set(p.end, { p, tag, rank });
      }
    });
    const list = [...byEnd.values()].sort((a, b) => (a.p.end < b.p.end ? 1 : -1)).slice(0, 3);
    if (list.length)
      annual[metric] = list.map(({ p, tag }) => ({ metric, value: p.val, periodEnd: p.end, fiscalYear: p.fy, form: p.form, filed: p.filed, accession: p.accn, tag }));
  }
  return {
    symbol,
    cik,
    asOf,
    annual,
    latestShares,
    sourceUrl: companyFactsUrl(cik),
  };
}

export class EdgarFundamentals {
  /** SEC fair-access limit is 10 requests/second across all machines; stay well below it. */
  private static nextSlot = 0;
  private static readonly MIN_INTERVAL_MS = 150;

  constructor(private userAgent: string, private fetchImpl: typeof fetch = fetch) {}

  /** SEC requires a declared User-Agent of the form "Company Name admin@example.com"; others get 403. */
  static isValidUserAgent(ua: string | undefined): boolean {
    return !!ua && /\S+@\S+\.\S+/.test(ua) && ua.trim().length >= 8;
  }

  async companyFacts(cik: string): Promise<any> {
    const now = Date.now();
    const wait = Math.max(0, EdgarFundamentals.nextSlot - now);
    EdgarFundamentals.nextSlot = Math.max(now, EdgarFundamentals.nextSlot) + EdgarFundamentals.MIN_INTERVAL_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await this.fetchImpl(companyFactsUrl(cik), {
      headers: { "User-Agent": this.userAgent, Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`SEC EDGAR ${res.status} for CIK ${padCik(cik)}`);
    const body = (await res.json()) as any;
    if (!body || typeof body !== "object" || typeof body.facts !== "object") throw new Error(`SEC EDGAR: malformed companyfacts for CIK ${padCik(cik)}`);
    return body;
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
