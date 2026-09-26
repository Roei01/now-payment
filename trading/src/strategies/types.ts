import type { AssetRow } from "../assets/universe.js";
import type { MarketSnapshot } from "../market/types.js";
import type { PortfolioState, Valuation } from "../portfolio/state.js";
import type { RiskStats } from "../risk/stats.js";

export interface StrategyVersionRow {
  id: string;
  strategy_id: string;
  code: string;
  name: string;
  version: number;
  params: Record<string, any>;
  universe: string[];
  horizon_days: number;
  rules: Record<string, any>;
  requires_ai: boolean;
  change_reason: string;
  created_at: Date;
}

export interface StrategySignal {
  symbol?: string;
  kind: string;
  value?: number;
  payload?: Record<string, unknown>;
}

export interface AiCandidate {
  symbol: string;
  mode: "ENTRY" | "REVIEW";
  screen: Record<string, unknown>;
}

export interface StrategyContext {
  snapshot: MarketSnapshot;
  state: PortfolioState;
  valuation: Valuation;
  assets: Map<string, AssetRow>;
  stats: Map<string, RiskStats>;
  version: StrategyVersionRow;
  lastTradeAt: Date | null;
}

export interface StrategyOutput {
  /** Target weights per symbol (remaining = cash). null means "no change". */
  targets: Map<string, number> | null;
  signals: StrategySignal[];
  rationale: string;
  evidence: Record<string, unknown>;
  /** Rebalancing strategies buy positions that are below cost by design (pre-approved policy). */
  rebalanceByDesign?: boolean;
  aiCandidates?: AiCandidate[];
}

export interface Strategy {
  readonly code: string;
  evaluate(ctx: StrategyContext): StrategyOutput;
}
