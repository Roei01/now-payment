import { z } from "zod";

const Source = z.object({ claim: z.string(), source_id: z.string() });
const Scenario = z.object({ price: z.number().positive(), description: z.string() });

/** Structured output every AI investment decision must satisfy (validated in code). */
export const ManagerDecisionSchema = z.object({
  symbol: z.string(),
  action: z.enum(["BUY", "SELL", "HOLD"]),
  thesis: z.string(),
  valuation: z.object({
    method: z.string(),
    currency: z.literal("USD"),
    per_share_low: z.number().positive(),
    per_share_base: z.number().positive(),
    per_share_high: z.number().positive(),
    assumptions: z.array(z.string()),
  }),
  scenarios: z.object({ bear: Scenario, base: Scenario, bull: Scenario }),
  evidence_for: z.array(Source),
  evidence_against: z.array(Source),
  target_exposure_pct: z.number().min(0).max(100),
  max_buy_price: z.number().positive().nullable(),
  sell_conditions: z.array(z.string()),
  thesis_invalidation: z.array(z.string()),
  horizon_days: z.number().int().positive(),
  valid_for_minutes: z.number().int().positive().max(24 * 60),
  confidence_label: z.enum(["low", "medium", "high"]),
  missing_material_information: z.array(z.string()),
  add_to_losing_position_reason: z.string().nullable(),
});

export type ManagerDecision = z.infer<typeof ManagerDecisionSchema>;

/**
 * Keywords that constrained-decoding APIs reject or ignore. Anthropic structured outputs
 * do not support numeric (minimum, maximum, exclusiveMinimum, multipleOf) or string-length
 * constraints, nor complex array constraints; OpenAI strict mode rejects several of
 * them too. They are enforced in code by ManagerDecisionSchema.safeParse instead.
 */
const UNPORTABLE_KEYWORDS = new Set([
  "$schema",
  "$id",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "default",
]);

/** Recursively strips keywords that structured-output APIs do not accept. Idempotent. */
export function toPortableJsonSchema(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown, inProperties: boolean): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, false));
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      // Inside "properties" the keys are field names, not keywords.
      if (!inProperties && UNPORTABLE_KEYWORDS.has(k)) continue;
      out[k] = walk(v, !inProperties && k === "properties");
    }
    return out;
  };
  return walk(schema, false) as Record<string, unknown>;
}

/**
 * JSON schema sent as output_config.format / response_format (kept in sync with the zod
 * schema above). Range constraints are dropped here and validated in code.
 */
export const MANAGER_JSON_SCHEMA = toPortableJsonSchema(z.toJSONSchema(ManagerDecisionSchema, { target: "draft-7" }));

export interface ContractCheck {
  ok: boolean;
  problems: string[];
}

/** Semantic checks beyond the schema: cited sources must exist, ranges must be ordered. */
export function checkDecisionSemantics(d: ManagerDecision, allowedSourceIds: Set<string>, expectedSymbol: string): ContractCheck {
  const problems: string[] = [];
  if (d.symbol !== expectedSymbol) problems.push(`symbol mismatch ${d.symbol} != ${expectedSymbol}`);
  const v = d.valuation;
  if (!(v.per_share_low <= v.per_share_base && v.per_share_base <= v.per_share_high)) problems.push("valuation range not ordered");
  const s = d.scenarios;
  if (!(s.bear.price <= s.base.price && s.base.price <= s.bull.price)) problems.push("scenario prices not ordered");
  for (const e of [...d.evidence_for, ...d.evidence_against])
    if (!allowedSourceIds.has(e.source_id)) problems.push(`unknown source_id ${e.source_id} (not in provided data)`);
  if (d.action === "BUY") {
    if (d.evidence_for.length === 0) problems.push("BUY without cited evidence");
    if (d.evidence_against.length === 0) problems.push("BUY without evidence against (required)");
    if (d.max_buy_price === null) problems.push("BUY without max_buy_price");
    if (d.thesis_invalidation.length === 0) problems.push("BUY without thesis invalidation conditions");
  }
  return { ok: problems.length === 0, problems };
}
