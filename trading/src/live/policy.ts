import { query, maybeOne, type Db } from "../db/pool.js";
import { paperPolicy, type RiskPolicy } from "../risk/policy.js";
import type { PortfolioRow } from "../portfolio/state.js";
import { config } from "../config.js";

export interface LivePolicyRow {
  id: string;
  portfolio_id: string;
  version: number;
  market: string;
  max_capital_usd: string;
  pilot_fraction: string;
  allowed_symbols: string[];
  max_position_pct: string;
  max_order_usd: string;
  risk_budget_pct: string;
  strategy_switch_policy: "MANUAL" | "AUTO_WITHIN_GATE";
  auto_promote: boolean;
  notes: string | null;
  signed_by: string;
  mfa_verified: boolean;
  signed_at: Date;
}

export async function latestLivePolicy(db: Db, portfolioId: string): Promise<LivePolicyRow | undefined> {
  return maybeOne<LivePolicyRow>(db, "SELECT * FROM live_policy_versions WHERE portfolio_id = $1 ORDER BY version DESC LIMIT 1", [portfolioId]);
}

export interface LivePolicyInput {
  maxCapitalUsd: number;
  pilotFraction: number;
  allowedSymbols: string[];
  maxPositionPct: number;
  maxOrderUsd: number;
  riskBudgetPct: number;
  strategySwitchPolicy: "MANUAL" | "AUTO_WITHIN_GATE";
  autoPromote: boolean;
  notes?: string;
}

export function validateLivePolicy(p: LivePolicyInput): string[] {
  const errs: string[] = [];
  if (!(p.maxCapitalUsd > 0)) errs.push("maxCapitalUsd must be > 0");
  if (!(p.pilotFraction > 0 && p.pilotFraction <= 0.5)) errs.push("pilotFraction must be in (0, 0.5]");
  if (p.allowedSymbols.length === 0) errs.push("allowedSymbols must not be empty");
  if (!(p.maxPositionPct > 0 && p.maxPositionPct <= 0.6)) errs.push("maxPositionPct must be in (0, 0.6]");
  if (!(p.maxOrderUsd > 0 && p.maxOrderUsd <= p.maxCapitalUsd)) errs.push("maxOrderUsd must be in (0, maxCapitalUsd]");
  if (!(p.riskBudgetPct > 0 && p.riskBudgetPct <= 0.3)) errs.push("riskBudgetPct must be in (0, 0.30]");
  return errs;
}

/** Signs a new immutable policy version. Requires a verified 2FA step-up by the caller. */
export async function signLivePolicy(db: Db, portfolioId: string, p: LivePolicyInput, by: string, mfaVerified: boolean): Promise<LivePolicyRow> {
  if (!mfaVerified) throw new Error("signing a live policy requires 2FA");
  const errs = validateLivePolicy(p);
  if (errs.length) throw new Error(errs.join("; "));
  const prev = await latestLivePolicy(db, portfolioId);
  const rows = await query<LivePolicyRow>(
    db,
    `INSERT INTO live_policy_versions (portfolio_id, version, max_capital_usd, pilot_fraction, allowed_symbols, max_position_pct, max_order_usd,
        risk_budget_pct, strategy_switch_policy, auto_promote, notes, signed_by, mfa_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      portfolioId,
      (prev?.version ?? 0) + 1,
      p.maxCapitalUsd,
      p.pilotFraction,
      p.allowedSymbols,
      p.maxPositionPct,
      p.maxOrderUsd,
      p.riskBudgetPct,
      p.strategySwitchPolicy,
      p.autoPromote,
      p.notes ?? null,
      by,
      mfaVerified,
    ],
  );
  await query(db, "UPDATE portfolios SET auto_promote = $2, risk_budget_pct = $3 WHERE id = $1", [portfolioId, p.autoPromote, p.riskBudgetPct]);
  return rows[0]!;
}

/** Risk policy for a portfolio. Live uses the signed policy; the pilot scales the capital cap. */
export function riskPolicyFor(portfolio: PortfolioRow, live?: LivePolicyRow): RiskPolicy {
  const base = paperPolicy({ riskBudgetPct: Number(portfolio.risk_budget_pct), maxQuoteAgeMinutes: config().MAX_QUOTE_AGE_MINUTES });
  // The passive benchmark is a yardstick, not a candidate: same costs and product rules, no concentration/risk-budget trimming.
  if (portfolio.kind === "BENCHMARK")
    return { ...base, version: "benchmark-v1", riskBudgetPct: 1, maxPositionPctEtf: 1, maxPositionPctStock: 1, maxSectorPct: 1 };
  if (portfolio.kind !== "LIVE" || !live) return base;
  const cap = Number(live.max_capital_usd) * (portfolio.status === "PILOT" ? Number(live.pilot_fraction) : 1);
  return {
    ...base,
    version: `live-policy-v${live.version}`,
    mode: "LIVE",
    riskBudgetPct: Number(live.risk_budget_pct),
    maxPositionPctStock: Math.min(base.maxPositionPctStock, Number(live.max_position_pct)),
    maxPositionPctEtf: Math.min(base.maxPositionPctEtf, Number(live.max_position_pct)),
    maxOrderUsd: Number(live.max_order_usd),
    maxCapitalUsd: cap,
    allowedSymbols: live.allowed_symbols,
  };
}
