import Anthropic from "@anthropic-ai/sdk";

export interface StructuredCallResult {
  ok: boolean;
  json?: unknown;
  refusal?: string;
  error?: string;
  modelServed: string;
  inputTokens: number;
  outputTokens: number;
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

/** Anthropic Messages API with structured JSON output and server-side refusal fallback. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60_000 });
  }

  async structuredCall(args: StructuredCallArgs): Promise<StructuredCallResult> {
    try {
      const stream = this.client.beta.messages.stream({
        model: args.model,
        max_tokens: args.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: args.effort, format: { type: "json_schema", schema: args.schema } },
        system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: args.user }],
      });
      const res = await stream.finalMessage();
      const usage = { modelServed: res.model, inputTokens: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0), outputTokens: res.usage.output_tokens };
      if (res.stop_reason === "refusal") return { ok: false, refusal: res.stop_details?.explanation ?? "refused", ...usage };
      if (res.stop_reason === "max_tokens") return { ok: false, error: "max_tokens reached before a complete decision", ...usage };
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
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
