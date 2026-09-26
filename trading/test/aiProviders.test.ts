import { describe, expect, it } from "vitest";
import { AI_PRESETS, createAiProvider } from "../src/ai/registry.js";
import { MANAGER_JSON_SCHEMA } from "../src/ai/contract.js";
import { costUsd, setModelPrice } from "../src/ai/budget.js";

function fakeFetch(reply: object, status = 200, capture: { url?: string; body?: any; headers?: any } = {}) {
  return (async (url: string, init: RequestInit) => {
    capture.url = url;
    capture.body = JSON.parse(String(init.body));
    capture.headers = init.headers;
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
}

const args = { model: "m", system: "sys", user: "u", schema: MANAGER_JSON_SCHEMA as Record<string, unknown>, maxTokens: 100, effort: "high" as const };

describe("AI provider registry", () => {
  it("covers Anthropic, OpenAI, Meta Llama hosts, Google and generic endpoints", () => {
    for (const id of ["anthropic", "openai", "openrouter", "google", "groq", "together", "mistral", "deepseek", "xai", "ollama", "openai-compatible"]) expect(AI_PRESETS[id]).toBeDefined();
  });

  it("explains why AI is off instead of failing", () => {
    expect(createAiProvider({ provider: "none", model: "x" }).reason).toMatch(/none/);
    expect(createAiProvider({ provider: "openai", model: "x" }).reason).toMatch(/AI_API_KEY/);
    expect(createAiProvider({ provider: "nope", model: "x", apiKey: "k" }).reason).toMatch(/unknown/);
    expect(createAiProvider({ provider: "openai", model: "claude-opus-5", apiKey: "k" }).reason).toMatch(/Claude model/);
    expect(createAiProvider({ provider: "openai-compatible", model: "x" }).reason).toMatch(/AI_BASE_URL/);
    expect(createAiProvider({ provider: "anthropic", model: "claude-opus-5", apiKey: "k" }).provider?.name).toBe("anthropic");
  });

  it("OpenAI: strict structured output, bearer auth, token usage", async () => {
    const cap: any = {};
    const p = createAiProvider(
      { provider: "openai", model: "gpt-x", apiKey: "sk-test" },
      fakeFetch({ model: "gpt-x-2026", choices: [{ finish_reason: "stop", message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }, 200, cap),
    ).provider!;
    const r = await p.structuredCall(args);
    expect(r).toMatchObject({ ok: true, json: { a: 1 }, modelServed: "gpt-x-2026", inputTokens: 10, outputTokens: 5 });
    expect(cap.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(cap.headers.Authorization).toBe("Bearer sk-test");
    expect(cap.body.response_format.type).toBe("json_schema");
    expect(cap.body.response_format.json_schema.schema.$schema).toBeUndefined();
    expect(cap.body.max_completion_tokens).toBe(100);
  });

  it("Llama via Groq/Together: JSON mode with the schema in the prompt, fenced JSON tolerated", async () => {
    const cap: any = {};
    const p = createAiProvider(
      { provider: "together", model: "meta-llama/x", apiKey: "k" },
      fakeFetch({ choices: [{ finish_reason: "stop", message: { content: '```json\n{"b":2}\n```' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, 200, cap),
    ).provider!;
    const r = await p.structuredCall(args);
    expect(r.json).toEqual({ b: 2 });
    expect(cap.body.response_format).toEqual({ type: "json_object" });
    expect(cap.body.messages[0].content).toMatch(/JSON Schema/);
    expect(cap.body.max_tokens).toBe(100);
  });

  it("reports refusals, truncation and HTTP errors as deferrals (never as decisions)", async () => {
    const mk = (reply: object, status = 200) => createAiProvider({ provider: "openrouter", model: "x", apiKey: "k" }, fakeFetch(reply, status)).provider!;
    expect((await mk({ choices: [{ message: { refusal: "no" } }] }).structuredCall(args)).refusal).toBe("no");
    expect((await mk({ choices: [{ finish_reason: "length", message: { content: "{" } }] }).structuredCall(args)).ok).toBe(false);
    expect((await mk({ error: "bad" }, 401).structuredCall(args)).error).toMatch(/401/);
  });

  it("uses configured prices for models outside the built-in table", () => {
    expect(costUsd("unknown-model", 1_000_000, 0)).toBe(10); // conservative default
    setModelPrice("cheap-llama", 0.2, 0.6);
    expect(costUsd("cheap-llama", 1_000_000, 1_000_000)).toBeCloseTo(0.8, 6);
  });
});
