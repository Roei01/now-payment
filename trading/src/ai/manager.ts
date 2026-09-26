import { query, maybeOne, type Db } from "../db/pool.js";
import { sha256 } from "../lib/crypto.js";
import { errMsg } from "../lib/logger.js";
import type { AssetRow } from "../assets/universe.js";
import type { MarketSnapshot } from "../market/types.js";
import { midPrice } from "../market/types.js";
import { high } from "../strategies/indicators.js";
import type { AiCandidate, StrategyVersionRow } from "../strategies/types.js";
import type { PortfolioState, Valuation } from "../portfolio/state.js";
import type { RiskStats } from "../risk/stats.js";
import type { RiskPolicy } from "../risk/policy.js";
import { EdgarFundamentals, fundamentalsArtifact } from "../research/edgar.js";
import { ManagerDecisionSchema, MANAGER_JSON_SCHEMA, checkDecisionSemantics, type ManagerDecision } from "./contract.js";
import { costUsd, priceOf, recordCost, reserveAiSpend } from "./budget.js";
import type { AiProvider } from "./provider.js";

export const MANAGER_SYSTEM_PROMPT = `You are the investment manager for a small, rules-constrained PAPER-trading portfolio of US stocks.
Your job: given the data package, decide BUY, SELL or HOLD for exactly one symbol, and return JSON matching the schema.

Hard rules (the execution system enforces them in code; do not try to work around them):
- Long-only, cash-only, regular stocks/ETFs. No leverage, shorting, options, margin or inverse exposure.
- Use ONLY the data in the package. Every item in evidence_for / evidence_against must cite a source_id that appears in the package's "sources" list. Never invent figures, news or dates. If something material is missing, list it in missing_material_information and prefer HOLD.
- "Cheap" means priced below your estimated per-share value range with a margin of safety — never merely "the price fell". A falling price alone is not a reason to buy, and a position being at a loss is not a reason to add to it.
- Valuation is an estimate that depends on assumptions: give a low/base/high per-share range, the method, and the assumptions. Consider a genuinely adverse bear scenario.
- Selling at a gain is a goal, not a requirement: recommend SELL if the thesis is broken even at a loss.
- confidence_label is a verbal label, not a probability of profit.
- target_exposure_pct is the share of this portfolio's total value you would hold in the symbol (the risk engine may reduce it). For HOLD/SELL, give the exposure you think appropriate after the action.
- max_buy_price: the highest price at which the BUY remains valid (null unless BUY).
- valid_for_minutes: how long the decision stays valid if the price and information do not change.
Be concise and concrete.`;

export interface ManagerDeps {
  provider?: AiProvider;
  edgar?: EdgarFundamentals;
  model: string;
  budget: { aiBudgetIls: number; opsCapIls: number; infraEstimateIls: number };
}

export interface ManagerResult {
  status: "DECIDED" | "DEFERRED";
  reason: string;
  decision?: ManagerDecision;
  promptVersionId?: string;
  model?: string;
  sources: { id: string; kind: string; title: string; published_at: string | null }[];
  costIls: number;
  raw?: unknown;
}

async function promptVersion(db: Db, model: string): Promise<string> {
  const hash = sha256(MANAGER_SYSTEM_PROMPT + JSON.stringify(MANAGER_JSON_SCHEMA));
  await query(
    db,
    `INSERT INTO model_prompt_versions (role, model, prompt_hash, prompt_text) VALUES ('manager', $1, $2, $3)
     ON CONFLICT (role, model, prompt_hash) DO NOTHING`,
    [model, hash, MANAGER_SYSTEM_PROMPT],
  );
  const row = await maybeOne<{ id: string }>(db, "SELECT id FROM model_prompt_versions WHERE role = 'manager' AND model = $1 AND prompt_hash = $2", [model, hash]);
  return row!.id;
}

export async function relevantLessons(db: Db, tags: string[]): Promise<{ id: string; text: string; sample_size: number; validity_conditions: string | null }[]> {
  return query(
    db,
    `SELECT id, text, sample_size, validity_conditions FROM research_lessons
      WHERE status = 'APPROVED' AND tags && $1 ORDER BY updated_at DESC LIMIT 5`,
    [tags],
  );
}

export async function runManager(
  db: Db,
  deps: ManagerDeps,
  args: {
    candidate: AiCandidate;
    asset: AssetRow;
    snapshot: MarketSnapshot;
    state: PortfolioState;
    valuation: Valuation;
    stats: Map<string, RiskStats>;
    version: StrategyVersionRow;
    policy: RiskPolicy;
    otherPortfolios: { code: string; holdings: string[] }[];
  },
): Promise<ManagerResult> {
  const { candidate, asset, snapshot, state, valuation, version } = args;
  const sources: ManagerResult["sources"] = [];
  if (!deps.provider) return { status: "DEFERRED", reason: "ספק AI לא מוגדר (AI_PROVIDER / AI_API_KEY)", sources, costIls: 0 };

  const quote = snapshot.quotes.get(asset.symbol);
  const bars = snapshot.bars.get(asset.symbol) ?? [];
  if (!quote || bars.length < 200) return { status: "DEFERRED", reason: "אין מספיק נתוני מחיר", sources, costIls: 0 };

  let fundamentals;
  try {
    fundamentals = await fundamentalsArtifact(db, deps.edgar, asset, snapshot.asOf);
  } catch (err) {
    return { status: "DEFERRED", reason: `דוחות החברה לא זמינים: ${errMsg(err)}`, sources, costIls: 0 };
  }
  if (!fundamentals || Object.keys(fundamentals.snapshot.annual).length < 3)
    return { status: "DEFERRED", reason: "חסרים נתוני דוחות מהותיים (SEC EDGAR לא מוגדר או חלקי)", sources, costIls: 0 };

  const priceSourceId = `price:${snapshot.batchId}:${asset.symbol}`;
  sources.push({ id: priceSourceId, kind: "MARKET_DATA", title: `${snapshot.provider} quote + daily bars`, published_at: quote.publishedAt.toISOString() });
  sources.push({ id: fundamentals.id, kind: "FUNDAMENTALS", title: `SEC EDGAR companyfacts ${asset.symbol}`, published_at: null });

  const lessons = await relevantLessons(db, [asset.symbol, asset.sector, version.code]);
  for (const l of lessons) sources.push({ id: `lesson:${l.id}`, kind: "LESSON", title: l.text.slice(0, 80), published_at: null });

  const last = midPrice(quote);
  const pos = state.positions.get(asset.symbol);
  const pkg = {
    as_of: snapshot.asOf.toISOString(),
    mode: candidate.mode,
    symbol: asset.symbol,
    name: asset.name,
    sector: asset.sector,
    strategy: { code: version.code, version: version.version, rules: version.rules, params: version.params },
    sources,
    market: {
      source_id: priceSourceId,
      price: last,
      bid: quote.bid,
      ask: quote.ask,
      quote_time: quote.publishedAt.toISOString(),
      high_52w: high(bars, 252),
      low_52w: Math.min(...bars.slice(-252).map((b) => b.low)),
      return_1y: bars.length > 252 ? bars.at(-1)!.close / bars.at(-253)!.close - 1 : null,
      annual_volatility: args.stats.get(asset.symbol)?.annualVol ?? null,
      beta_vs_spy: args.stats.get(asset.symbol)?.beta ?? null,
      data_simulated: snapshot.simulated,
    },
    fundamentals: { source_id: fundamentals.id, ...fundamentals.snapshot },
    screen: candidate.screen,
    portfolio: {
      total_value_usd: valuation.total.toFixed(2),
      cash_usd: state.cash.toFixed(2),
      initial_capital_usd: state.initialCapitalUsd.toFixed(2),
      holdings: [...state.positions.values()].map((p) => ({
        symbol: p.symbol,
        qty: p.qty.toFixed(6),
        avg_cost: p.qty.isZero() ? null : p.costBasis.div(p.qty).toFixed(4),
        weight: valuation.weights.get(p.symbol)?.toFixed(4),
      })),
      this_position: pos ? { qty: pos.qty.toFixed(6), avg_cost: pos.costBasis.div(pos.qty).toFixed(4), opened_at: pos.openedAt } : null,
      risk_budget: `estimated worst-case loss must stay within ${args.policy.riskBudgetPct * 100}% of initial capital over the holding period`,
      max_weight_per_position: version.params.maxWeightPerPosition,
    },
    other_portfolios_overlap: args.otherPortfolios,
    lessons: lessons.map((l) => ({ source_id: `lesson:${l.id}`, text: l.text, sample_size: l.sample_size, valid_when: l.validity_conditions })),
  };
  const user = `Data package (JSON):\n${JSON.stringify(pkg)}`;

  const maxTokens = 8000;
  const estInputTokens = Math.ceil((MANAGER_SYSTEM_PROMPT.length + user.length) / 3) + 1500;
  const worstUsd = costUsd(deps.model, estInputTokens, maxTokens);
  const worstIls = worstUsd * snapshot.fx.rate;
  const reserve = await reserveAiSpend(db, deps.budget, worstIls);
  if (!reserve.ok) return { status: "DEFERRED", reason: `תקציב: ${reserve.reason === "AI monthly budget would be exceeded" ? "תקרת ה־AI החודשית תיחרג" : "תקרת התפעול החודשית תיחרג"}`, sources, costIls: 0 };

  const pvId = await promptVersion(db, deps.model);
  const res = await deps.provider.structuredCall({
    model: deps.model,
    system: MANAGER_SYSTEM_PROMPT,
    user,
    schema: MANAGER_JSON_SCHEMA as Record<string, unknown>,
    maxTokens,
    effort: "high",
  });
  const usd = costUsd(res.modelServed, res.inputTokens, res.outputTokens);
  if (res.inputTokens + res.outputTokens > 0)
    await recordCost(db, {
      category: "AI",
      provider: deps.provider.name,
      model: res.modelServed,
      usd,
      fxRate: snapshot.fx.rate,
      units: { input_tokens: res.inputTokens, output_tokens: res.outputTokens, price: priceOf(res.modelServed) },
      reference: `manager:${asset.symbol}`,
    });
  const costIls = usd * snapshot.fx.rate;
  const base = { promptVersionId: pvId, model: res.modelServed, sources, costIls };
  if (!res.ok) return { status: "DEFERRED", reason: res.refusal ? `המודל סירב: ${res.refusal}` : `קריאה למודל נכשלה: ${res.error}`, ...base };

  const parsed = ManagerDecisionSchema.safeParse(res.json);
  if (!parsed.success) return { status: "DEFERRED", reason: `הפלט לא עמד בחוזה: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join("; ")}`, raw: res.json, ...base };
  const semantic = checkDecisionSemantics(parsed.data, new Set(sources.map((s) => s.id)), asset.symbol);
  if (!semantic.ok) return { status: "DEFERRED", reason: `הפלט נפסל: ${semantic.problems.join("; ")}`, decision: parsed.data, ...base };
  if (parsed.data.action === "BUY" && parsed.data.missing_material_information.length > 0)
    return { status: "DEFERRED", reason: `המודל מדווח על מידע מהותי חסר: ${parsed.data.missing_material_information.join("; ")}`, decision: parsed.data, ...base };
  return { status: "DECIDED", reason: parsed.data.thesis, decision: parsed.data, ...base };
}
