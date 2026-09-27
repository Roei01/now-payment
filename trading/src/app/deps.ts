import type pg from "pg";
import { config } from "../config.js";
import { getPool } from "../db/pool.js";
import { AlpacaMarketData } from "../market/alpaca.js";
import { SimulatedMarketData } from "../market/simulated.js";
import { FrankfurterFx, StaticFx } from "../market/fx.js";
import type { FxProvider, MarketDataProvider } from "../market/types.js";
import { defaultBrokerFactory } from "../broker/factory.js";
import { DEFAULT_COSTS } from "../risk/policy.js";
import { createAiProvider } from "../ai/registry.js";
import { setModelPrice } from "../ai/budget.js";
import { EdgarFundamentals } from "../research/edgar.js";
import type { CycleDeps } from "../engine/cycle.js";

export function marketFromConfig(): MarketDataProvider {
  const c = config();
  if (c.MARKET_DATA_PROVIDER === "alpaca") {
    if (!c.MARKET_DATA_API_KEY || !c.MARKET_DATA_API_SECRET) throw new Error("MARKET_DATA_PROVIDER=alpaca requires MARKET_DATA_API_KEY and MARKET_DATA_API_SECRET");
    return new AlpacaMarketData({ keyId: c.MARKET_DATA_API_KEY, secret: c.MARKET_DATA_API_SECRET }, c.ALPACA_DATA_FEED);
  }
  return new SimulatedMarketData();
}

export function fxFromConfig(): FxProvider {
  const c = config();
  return c.FX_PROVIDER === "frankfurter" ? new FrankfurterFx() : new StaticFx(c.FX_STATIC_USD_ILS);
}

export function aiFromConfig() {
  const c = config();
  if (c.AI_PRICE_INPUT_PER_MTOK !== undefined && c.AI_PRICE_OUTPUT_PER_MTOK !== undefined)
    setModelPrice(c.AI_MANAGER_MODEL, c.AI_PRICE_INPUT_PER_MTOK, c.AI_PRICE_OUTPUT_PER_MTOK);
  return createAiProvider({ provider: c.AI_PROVIDER, apiKey: c.AI_API_KEY, baseUrl: c.AI_BASE_URL, model: c.AI_MANAGER_MODEL, jsonMode: c.AI_JSON_MODE });
}

export function cycleDepsFromConfig(pool: pg.Pool = getPool()): CycleDeps {
  const c = config();
  return {
    pool,
    market: marketFromConfig(),
    fx: fxFromConfig(),
    brokers: defaultBrokerFactory(pool, DEFAULT_COSTS),
    ai: {
      provider: aiFromConfig().provider,
      edgar: EdgarFundamentals.isValidUserAgent(c.SEC_EDGAR_USER_AGENT) ? new EdgarFundamentals(c.SEC_EDGAR_USER_AGENT!) : undefined,
      model: c.AI_MANAGER_MODEL,
      budget: { aiBudgetIls: c.AI_MONTHLY_BUDGET_ILS, opsCapIls: c.OPS_MONTHLY_CAP_ILS, infraEstimateIls: c.INFRA_MONTHLY_ESTIMATE_ILS },
    },
    maxQuoteAgeMinutes: c.MAX_QUOTE_AGE_MINUTES,
    maxAiCallsPerCycle: 2,
  };
}

/** What is connected and what is not — shown on the Operations screen. */
export function integrationStatus() {
  const c = config();
  return {
    marketData: c.MARKET_DATA_PROVIDER === "alpaca" && c.MARKET_DATA_API_KEY ? `alpaca (${c.ALPACA_DATA_FEED})` : "SIMULATED (not real prices)",
    fx: c.FX_PROVIDER === "frankfurter" ? "frankfurter (ECB reference)" : `STATIC ${c.FX_STATIC_USD_ILS} (dev only)`,
    ai: (() => {
      const r = aiFromConfig();
      return r.provider ? `${c.AI_PROVIDER} · ${c.AI_MANAGER_MODEL}` : `off (${r.reason}) → AI decisions deferred`;
    })(),
    fundamentals: EdgarFundamentals.isValidUserAgent(c.SEC_EDGAR_USER_AGENT)
      ? "SEC EDGAR"
      : c.SEC_EDGAR_USER_AGENT
        ? "misconfigured (SEC_EDGAR_USER_AGENT must be 'Name contact@email')"
        : "not configured",
    paperBroker: c.BROKER_PAPER_KEY ? "alpaca paper keys present" : "internal simulator only",
    liveBroker: c.BROKER_LIVE_KEY ? "alpaca live keys present" : "not configured",
    liveTradingEnabled: c.LIVE_TRADING_ENABLED,
    email: c.NOTIFICATIONS_PROVIDER === "resend" && c.NOTIFICATIONS_API_KEY && c.ALERT_EMAIL_TO && c.ALERT_EMAIL_FROM ? `resend → ${c.ALERT_EMAIL_TO}` : "not configured (alerts visible in the app only)",
  };
}
