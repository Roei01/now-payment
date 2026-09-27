import type { AiProvider } from "./provider.js";
import { AnthropicProvider } from "./provider.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";

export interface AiSettings {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  jsonMode?: "json_schema" | "json_object";
}

interface Preset {
  label: string;
  /** How to build the client. Add a new provider by adding one entry here. */
  kind: "anthropic" | "openai-compatible";
  baseUrl?: string;
  jsonMode?: "json_schema" | "json_object";
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  /** json_schema strict flag; hosts that do not implement strict get false. */
  strict?: boolean;
  keyRequired: boolean;
  exampleModel: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Supported AI providers. Model names are passed through as-is (AI_MANAGER_MODEL),
 * so new models need no code change. A new OpenAI-compatible host is one line here,
 * or can be used right away with AI_PROVIDER=openai-compatible + AI_BASE_URL.
 */
export const AI_PRESETS: Record<string, Preset> = {
  anthropic: { label: "Anthropic (Claude)", kind: "anthropic", keyRequired: true, exampleModel: "claude-opus-5" },
  openai: { label: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", jsonMode: "json_schema", maxTokensParam: "max_completion_tokens", keyRequired: true, exampleModel: "<openai model id>" },
  openrouter: {
    label: "OpenRouter (Meta Llama, Mistral, DeepSeek, Qwen, Gemini, Claude, GPT …)",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    jsonMode: "json_schema",
    maxTokensParam: "max_tokens",
    keyRequired: true,
    exampleModel: "meta-llama/<model>",
    extraHeaders: { "X-Title": "paper-live-trading" },
  },
  google: { label: "Google Gemini (OpenAI-compatible endpoint)", kind: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", jsonMode: "json_schema", maxTokensParam: "max_tokens", strict: false, keyRequired: true, exampleModel: "<gemini model id>" },
  groq: { label: "Groq (Llama and others)", kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", jsonMode: "json_object", maxTokensParam: "max_completion_tokens", keyRequired: true, exampleModel: "<groq model id>" },
  together: { label: "Together AI (Llama and others)", kind: "openai-compatible", baseUrl: "https://api.together.xyz/v1", jsonMode: "json_object", maxTokensParam: "max_tokens", keyRequired: true, exampleModel: "meta-llama/<model>" },
  mistral: { label: "Mistral", kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", jsonMode: "json_object", maxTokensParam: "max_tokens", keyRequired: true, exampleModel: "<mistral model id>" },
  deepseek: { label: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", jsonMode: "json_object", maxTokensParam: "max_tokens", keyRequired: true, exampleModel: "<deepseek model id>" },
  xai: { label: "xAI (Grok)", kind: "openai-compatible", baseUrl: "https://api.x.ai/v1", jsonMode: "json_schema", maxTokensParam: "max_tokens", keyRequired: true, exampleModel: "<grok model id>" },
  ollama: { label: "Ollama (local / self-hosted)", kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", jsonMode: "json_object", maxTokensParam: "max_tokens", keyRequired: false, exampleModel: "llama3.1" },
  "openai-compatible": { label: "Any OpenAI-compatible endpoint (set AI_BASE_URL)", kind: "openai-compatible", jsonMode: "json_object", maxTokensParam: "max_tokens", strict: false, keyRequired: false, exampleModel: "<model id>" },
};

export type AiProviderId = keyof typeof AI_PRESETS | "none";

/** Returns the provider, or a reason why AI is off (decisions are then deferred, never guessed). */
export function createAiProvider(s: AiSettings, fetchImpl?: typeof fetch): { provider?: AiProvider; reason?: string } {
  if (s.provider === "none") return { reason: "AI_PROVIDER=none" };
  const preset = AI_PRESETS[s.provider];
  if (!preset) return { reason: `unknown AI_PROVIDER '${s.provider}' (supported: ${Object.keys(AI_PRESETS).join(", ")})` };
  if (preset.keyRequired && !s.apiKey) return { reason: `AI_API_KEY is required for ${preset.label}` };
  if (!s.model) return { reason: "AI_MANAGER_MODEL is required" };
  if (preset.kind === "anthropic") return { provider: new AnthropicProvider(s.apiKey!) };
  const baseUrl = s.baseUrl || preset.baseUrl;
  if (!baseUrl) return { reason: `AI_BASE_URL is required for ${s.provider}` };
  if (s.model.startsWith("claude-") && s.provider !== "openrouter" && s.provider !== "openai-compatible")
    return { reason: `AI_MANAGER_MODEL '${s.model}' is a Claude model; set a model id of ${preset.label}` };
  return {
    provider: new OpenAiCompatibleProvider({
      name: s.provider,
      baseUrl,
      apiKey: s.apiKey,
      jsonMode: s.jsonMode ?? preset.jsonMode ?? "json_object",
      maxTokensParam: preset.maxTokensParam ?? "max_tokens",
      strict: preset.strict,
      extraHeaders: preset.extraHeaders,
      fetchImpl,
    }),
  };
}
