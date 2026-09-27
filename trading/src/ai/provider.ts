import Anthropic from "@anthropic-ai/sdk";
import { toPortableJsonSchema } from "./contract.js";

/** Tokens consumed by one model during a call (a fallback chain can involve several). */
export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredCallResult {
  ok: boolean;
  json?: unknown;
  refusal?: string;
  error?: string;
  modelServed: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Per-model breakdown when more than one model was billed (e.g. a refusal fallback).
   * When present, cost must be computed per entry; inputTokens/outputTokens are the totals.
   */
  usageByModel?: ModelUsage[];
}

export interface StructuredCallArgs {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

/** One method is all a provider needs; see ai/registry.ts for the list of providers. */
export interface AiProvider {
  readonly name: string;
  structuredCall(args: StructuredCallArgs): Promise<StructuredCallResult>;
}

type FinalMessage = Anthropic.Beta.BetaMessage;

/** Sums usage per model, preferring usage.iterations (the per-attempt source of truth with fallbacks). */
export function anthropicUsage(res: FinalMessage): Pick<StructuredCallResult, "modelServed" | "inputTokens" | "outputTokens" | "usageByModel"> {
  const iterations = (res.usage.iterations ?? []) as { model?: string | null; input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }[];
  const rows: ModelUsage[] = [];
  if (iterations.length > 0) {
    const byModel = new Map<string, ModelUsage>();
    for (const it of iterations) {
      const model = it.model ?? res.model;
      const row = byModel.get(model) ?? { model, inputTokens: 0, outputTokens: 0 };
      row.inputTokens += (it.input_tokens ?? 0) + (it.cache_creation_input_tokens ?? 0) + (it.cache_read_input_tokens ?? 0);
      row.outputTokens += it.output_tokens ?? 0;
      byModel.set(model, row);
    }
    rows.push(...byModel.values());
  } else {
    rows.push({
      model: res.model,
      inputTokens: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0),
      outputTokens: res.usage.output_tokens,
    });
  }
  return {
    modelServed: res.model,
    inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    usageByModel: rows.length > 1 ? rows : undefined,
  };
}

/**
 * Text of the final answer. With server-side fallbacks, a model that declines mid-stream
 * leaves its partial text before a `fallback` block; only text after the last switch
 * point belongs to the model that produced the returned message.
 */
export function anthropicFinalText(content: FinalMessage["content"]): string {
  let start = 0;
  content.forEach((b, i) => {
    if ((b as { type: string }).type === "fallback") start = i + 1;
  });
  return content
    .slice(start)
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("");
}

/** Anthropic Messages API with structured JSON output and server-side refusal fallback. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, opts: { baseURL?: string; fetch?: typeof fetch } = {}) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60_000, ...opts });
  }

  async structuredCall(args: StructuredCallArgs): Promise<StructuredCallResult> {
    try {
      const stream = this.client.beta.messages.stream({
        model: args.model,
        max_tokens: args.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        // Structured outputs reject numeric/string-length constraints; they are validated in code.
        output_config: { effort: args.effort, format: { type: "json_schema", schema: toPortableJsonSchema(args.schema) } },
        system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: args.user }],
      });
      const res = await stream.finalMessage();
      const usage = anthropicUsage(res);
      if (res.stop_reason === "refusal") {
        const d = res.stop_details;
        const why = [d?.category, d?.explanation].filter(Boolean).join(": ");
        return { ok: false, refusal: why || "refused", ...usage };
      }
      if (res.stop_reason === "max_tokens") return { ok: false, error: "max_tokens reached before a complete decision", ...usage };
      if (res.stop_reason !== "end_turn") return { ok: false, error: `unexpected stop_reason ${res.stop_reason}`, ...usage };
      const text = anthropicFinalText(res.content);
      try {
        return { ok: true, json: JSON.parse(text), ...usage };
      } catch {
        return { ok: false, error: "response was not valid JSON", ...usage };
      }
    } catch (err) {
      if (err instanceof Anthropic.APIError) return { ok: false, error: `anthropic ${err.status}: ${err.message}`, modelServed: args.model, inputTokens: 0, outputTokens: 0 };
      return { ok: false, error: (err as Error).message, modelServed: args.model, inputTokens: 0, outputTokens: 0 };
    }
  }
}
