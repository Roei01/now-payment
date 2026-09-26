import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().finite());

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: num(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: bool,
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  SETUP_TOKEN: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),

  // Market data: "alpaca" (requires keys) or "simulated" (dev/demo only, never promotable).
  MARKET_DATA_PROVIDER: z.enum(["alpaca", "simulated"]).default("simulated"),
  MARKET_DATA_API_KEY: z.string().optional(),
  MARKET_DATA_API_SECRET: z.string().optional(),
  ALPACA_DATA_FEED: z.enum(["iex", "sip"]).default("iex"),
  MAX_QUOTE_AGE_MINUTES: num(20),
  /** Simulated prices / static FX are refused in production unless explicitly allowed. */
  ALLOW_SIMULATED_DATA: bool,

  // FX source for USD/ILS. "frankfurter" (ECB reference rates, no key) or "static" (dev only).
  FX_PROVIDER: z.enum(["frankfurter", "static"]).default("static"),
  FX_STATIC_USD_ILS: num(3.7),

  // Fundamentals from SEC EDGAR (free, requires a descriptive User-Agent with contact e-mail).
  SEC_EDGAR_USER_AGENT: z.string().optional(),

  // AI manager. Provider list: src/ai/registry.ts (anthropic, openai, openrouter, google, groq,
  // together, mistral, deepseek, xai, ollama, openai-compatible). Without one, AI decisions are deferred (HOLD).
  AI_PROVIDER: z.string().default("none"),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_MANAGER_MODEL: z.string().default("claude-opus-5"),
  AI_JSON_MODE: z.enum(["json_schema", "json_object"]).optional(),
  // Price per million tokens (USD) for models not in the built-in table; unknown models are otherwise costed at a conservative maximum.
  AI_PRICE_INPUT_PER_MTOK: z.string().optional().transform((v) => (v ? Number(v) : undefined)),
  AI_PRICE_OUTPUT_PER_MTOK: z.string().optional().transform((v) => (v ? Number(v) : undefined)),
  AI_MONTHLY_BUDGET_ILS: num(60),
  OPS_MONTHLY_CAP_ILS: num(150),
  INFRA_MONTHLY_ESTIMATE_ILS: num(0),

  // Brokers. Keys only in env; the DB stores the variable *name*, never the value.
  BROKER_PAPER_KEY: z.string().optional(),
  BROKER_PAPER_SECRET: z.string().optional(),
  BROKER_LIVE_KEY: z.string().optional(),
  BROKER_LIVE_SECRET: z.string().optional(),
  LIVE_TRADING_ENABLED: bool,

  // Notifications (e-mail).
  NOTIFICATIONS_PROVIDER: z.enum(["resend", "log"]).default("log"),
  NOTIFICATIONS_API_KEY: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  DIGEST_HOUR_IL: num(23),

  // Worker cadence.
  WORKER_TICK_SECONDS: num(60),
  CYCLE_INTERVAL_MINUTES: num(60),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production" && !c.ALLOW_SIMULATED_DATA) {
    if (c.MARKET_DATA_PROVIDER !== "alpaca")
      throw new Error("Invalid configuration: production requires MARKET_DATA_PROVIDER=alpaca (real prices). Set ALLOW_SIMULATED_DATA=true only for a demo.");
    if (c.FX_PROVIDER === "static")
      throw new Error("Invalid configuration: production requires a real USD/ILS source (FX_PROVIDER=frankfurter).");
  }
  return c;
}

export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function setConfigForTests(c: AppConfig): void {
  cached = c;
}
