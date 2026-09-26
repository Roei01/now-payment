import { query, maybeOne, type Db } from "../db/pool.js";
import { maxDrawdown, meanStd, normInv } from "./stats.js";

export interface GatePolicy {
  minForwardDays: number;
  minTrades: number;
  maxDrawdown: number;
  minExcessReturn: number;
  alpha: number;
  minStableSubPeriods: number;
  subPeriods: number;
  minDataCoverage: number;
  requireRealData: boolean;
  maxLossFromInitial: number;
}

/** Discussion defaults, not final values (see the spec: depend on strategy frequency). */
export const DEFAULT_GATE: GatePolicy = {
  minForwardDays: 90,
  minTrades: 6,
  maxDrawdown: 0.2,
  minExcessReturn: 0,
  alpha: 0.05,
  minStableSubPeriods: 2,
  subPeriods: 3,
  minDataCoverage: 0.95,
  requireRealData: true,
  maxLossFromInitial: 0.3,
};

export interface GateCheck {
  code: string;
  pass: boolean;
  detail: string;
}

export interface GateResult {
  decision: "PASS" | "FAIL" | "INSUFFICIENT_DATA";
  metrics: Record<string, number | string | boolean | null>;
  checks: GateCheck[];
}

interface Row {
  date: string;
  value_usd: string;
  trades_cum: number;
  simulated_data: boolean;
  loss_from_initial_pct: string;
}

function weekdaysBetween(a: string, b: string): number {
  let n = 0;
  for (let d = new Date(`${a}T12:00:00Z`); d <= new Date(`${b}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/** Pure evaluation (unit-tested). `candidatesTested` drives the multiple-testing correction. */
export function evaluateGate(rows: Row[], bench: Map<string, number>, candidatesTested: number, policy: GatePolicy = DEFAULT_GATE): GateResult {
  const checks: GateCheck[] = [];
  const values = rows.map((r) => Number(r.value_usd));
  const n = rows.length;
  const first = rows[0];
  const last = rows.at(-1);
  const trades = n ? rows.at(-1)!.trades_cum - rows[0]!.trades_cum : 0;
  const excess: number[] = [];
  for (let i = 1; i < n; i++) {
    const b0 = bench.get(rows[i - 1]!.date);
    const b1 = bench.get(rows[i]!.date);
    if (b0 === undefined || b1 === undefined) continue;
    excess.push(values[i]! / values[i - 1]! - 1 - (b1 / b0 - 1));
  }
  const totalReturn = n > 1 ? values.at(-1)! / values[0]! - 1 : 0;
  const bFirst = first ? bench.get(first.date) : undefined;
  const bLast = last ? bench.get(last.date) : undefined;
  const benchReturn = bFirst && bLast ? bLast / bFirst - 1 : null;
  const { mean, sd } = meanStd(excess);
  const tStat = sd > 0 ? mean / (sd / Math.sqrt(excess.length)) : 0;
  const k = Math.max(1, candidatesTested);
  const tCrit = normInv(1 - policy.alpha / k);
  const mdd = maxDrawdown(values);
  const coverage = first && last ? n / Math.max(1, weekdaysBetween(first.date, last.date)) : 0;
  const simulated = rows.some((r) => r.simulated_data);
  const worstLoss = Math.max(0, ...rows.map((r) => Number(r.loss_from_initial_pct)));

  const chunk = Math.max(1, Math.floor(excess.length / policy.subPeriods));
  let stable = 0;
  for (let i = 0; i < policy.subPeriods; i++) {
    const part = excess.slice(i * chunk, i === policy.subPeriods - 1 ? undefined : (i + 1) * chunk);
    if (part.length && part.reduce((a, b) => a + b, 0) > 0) stable++;
  }

  checks.push({ code: "FORWARD_DAYS", pass: n >= policy.minForwardDays, detail: `${n} / ${policy.minForwardDays} days` });
  checks.push({ code: "TRADES", pass: trades >= policy.minTrades, detail: `${trades} / ${policy.minTrades}` });
  checks.push({ code: "REAL_DATA", pass: !policy.requireRealData || !simulated, detail: simulated ? "window contains simulated market data" : "real market data" });
  checks.push({ code: "DATA_COVERAGE", pass: coverage >= policy.minDataCoverage, detail: `${(coverage * 100).toFixed(1)}%` });
  checks.push({ code: "MAX_DRAWDOWN", pass: mdd <= policy.maxDrawdown, detail: `${(mdd * 100).toFixed(1)}% ≤ ${policy.maxDrawdown * 100}%` });
  checks.push({ code: "LOSS_FROM_INITIAL", pass: worstLoss <= policy.maxLossFromInitial, detail: `${(worstLoss * 100).toFixed(1)}%` });
  checks.push({
    code: "EXCESS_RETURN",
    pass: benchReturn !== null && totalReturn - benchReturn > policy.minExcessReturn,
    detail: benchReturn === null ? "no benchmark" : `${((totalReturn - benchReturn) * 100).toFixed(2)}% vs benchmark`,
  });
  checks.push({
    code: "SIGNIFICANCE_MULTIPLE_TESTING",
    pass: tStat >= tCrit,
    detail: `t=${tStat.toFixed(2)} vs critical ${tCrit.toFixed(2)} (alpha ${policy.alpha}/${k} candidates, Bonferroni)`,
  });
  checks.push({ code: "STABILITY", pass: stable >= policy.minStableSubPeriods, detail: `${stable}/${policy.subPeriods} sub-periods beat benchmark` });

  const insufficient = checks.filter((c) => (c.code === "FORWARD_DAYS" || c.code === "TRADES") && !c.pass).length > 0;
  const decision = insufficient ? "INSUFFICIENT_DATA" : checks.every((c) => c.pass) ? "PASS" : "FAIL";
  return {
    decision,
    metrics: {
      days: n,
      trades,
      totalReturn,
      benchReturn,
      excessReturn: benchReturn === null ? null : totalReturn - benchReturn,
      tStat,
      tCrit,
      candidatesTested: k,
      maxDrawdown: mdd,
      coverage,
      simulated,
      worstLossFromInitial: worstLoss,
    },
    checks,
  };
}

/** Evaluates the active version of a paper portfolio over that version's own window. */
export async function evaluatePortfolioGate(db: Db, portfolioId: string, policy: GatePolicy = DEFAULT_GATE): Promise<GateResult & { strategyVersionId: string } | undefined> {
  const assignment = await maybeOne<{ strategy_version_id: string; assigned_at: Date }>(
    db,
    "SELECT strategy_version_id, assigned_at FROM strategy_assignments WHERE portfolio_id = $1 AND unassigned_at IS NULL",
    [portfolioId],
  );
  if (!assignment) return undefined;
  const rows = await query<Row>(
    db,
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, value_usd, trades_cum, simulated_data, loss_from_initial_pct
       FROM performance_daily WHERE portfolio_id = $1 AND strategy_version_id = $2 ORDER BY date`,
    [portfolioId, assignment.strategy_version_id],
  );
  const bench = await query<{ date: string; value_usd: string }>(
    db,
    `SELECT to_char(pd.date, 'YYYY-MM-DD') AS date, pd.value_usd FROM performance_daily pd JOIN portfolios p ON p.id = pd.portfolio_id
      WHERE p.kind = 'BENCHMARK' AND p.status <> 'ARCHIVED' ORDER BY pd.date`,
  );
  const tested = await maybeOne<{ n: number }>(
    db,
    `SELECT (SELECT COUNT(DISTINCT sa.strategy_version_id) FROM strategy_assignments sa JOIN portfolios p ON p.id = sa.portfolio_id WHERE p.kind = 'PAPER')
          + (SELECT COUNT(*) FROM strategy_experiments) AS n`,
  );
  const result = evaluateGate(rows, new Map(bench.map((b) => [b.date, Number(b.value_usd)])), Number(tested?.n ?? 1), policy);
  await query(
    db,
    "INSERT INTO promotion_evaluations (portfolio_id, strategy_version_id, decision, metrics, checks, gate_policy) VALUES ($1,$2,$3,$4,$5,$6)",
    [portfolioId, assignment.strategy_version_id, result.decision, JSON.stringify(result.metrics), JSON.stringify(result.checks), JSON.stringify(policy)],
  );
  return { ...result, strategyVersionId: assignment.strategy_version_id };
}
