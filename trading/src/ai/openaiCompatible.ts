import type { AiProvider, StructuredCallArgs, StructuredCallResult } from "./provider.js";

export interface OpenAiCompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** "json_schema" = strict structured output; "json_object" = JSON mode with the schema given in the prompt. */
  jsonMode: "json_schema" | "json_object";
  /** OpenAI's newer models take max_completion_tokens; most compatible hosts take max_tokens. */
  maxTokensParam: "max_tokens" | "max_completion_tokens";
  extraHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Any provider that speaks the OpenAI Chat Completions protocol: OpenAI, OpenRouter
 * (Meta Llama, Mistral, DeepSeek, Qwen, …), Google Gemini's OpenAI endpoint, Groq,
 * Together, Mistral, DeepSeek, xAI, a local Ollama, or any other compatible gateway.
 * The output is always re-validated in code against the decision contract.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;
  constructor(private o: OpenAiCompatibleOptions) {
    this.name = o.name;
  }

  async structuredCall(args: StructuredCallArgs): Promise<StructuredCallResult> {
    const fail = (error: string, extra: Partial<StructuredCallResult> = {}): StructuredCallResult => ({
      ok: false,
      error,
      modelServed: args.model,
      inputTokens: 0,
      outputTokens: 0,
      ...extra,
    });
    const { $schema: _ignored, ...schema } = args.schema as Record<string, unknown>;
    const system =
      this.o.jsonMode === "json_object"
        ? `${args.system}\n\nReturn only a JSON object that validates against this JSON Schema:\n${JSON.stringify(schema)}`
        : args.system;
    const body: Record<string, unknown> = {
      model: args.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: args.user },
      ],
      [this.o.maxTokensParam]: args.maxTokens,
      response_format:
        this.o.jsonMode === "json_schema"
          ? { type: "json_schema", json_schema: { name: "investment_decision", schema, strict: false } }
          : { type: "json_object" },
    };
    let res: Response;
    try {
      res = await (this.o.fetchImpl ?? fetch)(`${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.o.apiKey ? { Authorization: `Bearer ${this.o.apiKey}` } : {}),
          ...(this.o.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10 * 60_000),
      });
    } catch (err) {
      return fail(`${this.name} request failed: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) return fail(`${this.name} ${res.status}: ${text.slice(0, 300)}`);
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return fail(`${this.name}: response was not JSON`);
    }
    const usage = {
      modelServed: String(data.model ?? args.model),
      inputTokens: Number(data.usage?.prompt_tokens ?? 0),
      outputTokens: Number(data.usage?.completion_tokens ?? 0),
    };
    const choice = data.choices?.[0];
    if (!choice) return { ok: false, error: `${this.name}: no choices in response`, ...usage };
    if (choice.message?.refusal) return { ok: false, refusal: String(choice.message.refusal), ...usage };
    if (choice.finish_reason === "length") return { ok: false, error: "max tokens reached before a complete decision", ...usage };
    if (choice.finish_reason === "content_filter") return { ok: false, refusal: "content filter", ...usage };
    const content = String(choice.message?.content ?? "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    try {
      return { ok: true, json: JSON.parse(content), ...usage };
    } catch {
      return { ok: false, error: "response was not valid JSON", ...usage };
    }
  }
}
