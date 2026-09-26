import { query, one, type Db } from "../db/pool.js";
import { monthStartUtc } from "../lib/time.js";
import { enqueueNotification } from "../notify/outbox.js";

/** USD per million tokens (first-party API list prices; update when pricing changes). */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
const MOST_EXPENSIVE = { input: 10, output: 50 };

const overrides: Record<string, { input: number; output: number }> = {};

/** Registers the configured price of a model that is not in the built-in table. */
export function setModelPrice(model: string, input: number, output: number): void {
  overrides[model] = { input, output };
}

export function priceOf(model: string) {
  // Unknown model => assume the most expensive (never under-count spend).
  return overrides[model] ?? MODEL_PRICES[model] ?? MOST_EXPENSIVE;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export interface BudgetStatus {
  monthAiIls: number;
  monthTotalIls: number;
  aiBudgetIls: number;
  opsCapIls: number;
  infraEstimateIls: number;
  remainingAiIls: number;
  remainingOpsIls: number;
}

export async function budgetStatus(db: Db, cfg: { aiBudgetIls: number; opsCapIls: number; infraEstimateIls: number }, now = new Date()): Promise<BudgetStatus> {
  const r = await one<{ ai: string; total: string }>(
    db,
    `SELECT COALESCE(SUM(amount_ils) FILTER (WHERE category = 'AI'), 0) AS ai, COALESCE(SUM(amount_ils), 0) AS total
       FROM cost_ledger WHERE occurred_at >= $1`,
    [monthStartUtc(now)],
  );
  const ai = Number(r.ai);
  const total = Number(r.total) + cfg.infraEstimateIls;
  return {
    monthAiIls: ai,
    monthTotalIls: total,
    aiBudgetIls: cfg.aiBudgetIls,
    opsCapIls: cfg.opsCapIls,
    infraEstimateIls: cfg.infraEstimateIls,
    remainingAiIls: cfg.aiBudgetIls - ai,
    remainingOpsIls: cfg.opsCapIls - total,
  };
}

/**
 * Before a paid call: refuse if the worst-case cost would cross either cap.
 * Never downgrades silently to a weaker model — the decision is deferred instead.
 */
export async function reserveAiSpend(
  db: Db,
  cfg: { aiBudgetIls: number; opsCapIls: number; infraEstimateIls: number },
  worstCaseIls: number,
): Promise<{ ok: boolean; status: BudgetStatus; reason?: string }> {
  const status = await budgetStatus(db, cfg);
  const month = monthStartUtc().toISOString().slice(0, 7);
  if (status.monthTotalIls >= 0.8 * status.opsCapIls || status.monthAiIls >= 0.8 * status.aiBudgetIls)
    await enqueueNotification(db, {
      dedupeKey: `budget80:${month}`,
      kind: "budget.threshold",
      severity: "WARNING",
      subject: "עלויות תפעול קרובות לתקרה החודשית",
      body: `AI: ${status.monthAiIls.toFixed(2)}/${status.aiBudgetIls} ₪, סה״כ: ${status.monthTotalIls.toFixed(2)}/${status.opsCapIls} ₪. קריאות מחקר חדשות ייעצרו לפני חריגה; בקרות סיכון ופיוס ממשיכים.`,
    });
  if (worstCaseIls > status.remainingAiIls) return { ok: false, status, reason: "AI monthly budget would be exceeded" };
  if (worstCaseIls > status.remainingOpsIls) return { ok: false, status, reason: "total operating cap would be exceeded" };
  return { ok: true, status };
}

export async function recordCost(
  db: Db,
  args: { category: "AI" | "DATA" | "INFRA" | "EMAIL" | "OTHER"; provider: string; model?: string; usd: number; fxRate: number; units?: Record<string, unknown>; reference?: string },
): Promise<void> {
  await query(
    db,
    `INSERT INTO cost_ledger (category, provider, model, amount_usd, amount_ils, fx_rate, units, reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [args.category, args.provider, args.model ?? null, args.usd, args.usd * args.fxRate, args.fxRate, JSON.stringify(args.units ?? {}), args.reference ?? null],
  );
}
