export interface CostModel {
  commissionPerOrderUsd: number;
  sellRegulatoryFeeBps: number;
  slippageBps: number;
  buyCashBufferBps: number;
  /** Documented assumption, shown in the UI next to results. */
  note: string;
}

export interface RiskPolicy {
  version: string;
  mode: "PAPER" | "LIVE";
  riskBudgetPct: number; // estimated worst-case loss vs initial capital, over the whole holding period
  riskReference: "INITIAL_CAPITAL_USD";
  maxPositionPctStock: number;
  maxPositionPctEtf: number;
  maxSectorPct: number;
  minOrderUsd: number;
  maxOrderUsd: number | null;
  maxCapitalUsd: number | null; // live only
  allowedSymbols: string[] | null; // live only (null = registry)
  allowedOrderTypes: ("MARKET" | "LIMIT")[];
  requireMarketOpen: boolean;
  maxQuoteAgeMinutes: number;
  losingPositionThresholdPct: number; // adding to a position below cost by more than this needs explicit justification
  costs: CostModel;
}

export const DEFAULT_COSTS: CostModel = {
  commissionPerOrderUsd: 0,
  sellRegulatoryFeeBps: 0.3,
  slippageBps: 5,
  buyCashBufferBps: 50,
  note:
    "Assumption: commission-free US equities (Alpaca), small regulatory fee on sells, 5 bps slippage. Not verified against a live account; FX conversion cost is recorded separately at portfolio start.",
};

export function paperPolicy(overrides: Partial<RiskPolicy> = {}): RiskPolicy {
  return {
    version: "paper-risk-v1",
    mode: "PAPER",
    riskBudgetPct: 0.3,
    riskReference: "INITIAL_CAPITAL_USD",
    maxPositionPctStock: 0.25,
    maxPositionPctEtf: 0.6,
    maxSectorPct: 0.6,
    minOrderUsd: 1,
    maxOrderUsd: null,
    maxCapitalUsd: null,
    allowedSymbols: null,
    allowedOrderTypes: ["MARKET", "LIMIT"],
    requireMarketOpen: true,
    maxQuoteAgeMinutes: 20,
    losingPositionThresholdPct: 0.05,
    costs: DEFAULT_COSTS,
    ...overrides,
  };
}

export interface StressScenario {
  code: string;
  description: string;
}

export const SCENARIOS: StressScenario[] = [
  { code: "MARKET_CRASH", description: "Broad US equity market −35%, assets move by their beta (bounded), bonds by rates sensitivity" },
  { code: "RATES_SHOCK", description: "Sharp rise in yields: long Treasuries −25%, intermediate −10%, equities −15%" },
  { code: "SINGLE_NAME", description: "Largest single-stock holding −50% (company-specific event)" },
  { code: "CORRELATED_VOL", description: "All holdings fall 2.5× their annual volatility at the same time (correlation → 1)" },
  { code: "COMBINED", description: "Market −20% plus worst single stock an additional −40%" },
];
