import type { Bar } from "../market/types.js";

export interface RiskStats {
  symbol: string;
  observations: number;
  annualVol: number;
  beta: number;
  maxDrawdown1y: number;
}

function returns(bars: Bar[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    out.set(bars[i]!.ts.toISOString().slice(0, 10), bars[i]!.close / prev - 1);
  }
  return out;
}

export const MIN_RISK_OBSERVATIONS = 60;

/** Volatility, beta to the market proxy and 1y drawdown from point-in-time daily bars. */
export function computeRiskStats(symbol: string, bars: Bar[], marketBars: Bar[]): RiskStats | undefined {
  const recent = bars.slice(-253);
  const r = returns(recent);
  const m = returns(marketBars.slice(-253));
  const paired: [number, number][] = [];
  for (const [d, v] of r) {
    const mv = m.get(d);
    if (mv !== undefined) paired.push([v, mv]);
  }
  if (r.size < MIN_RISK_OBSERVATIONS || paired.length < MIN_RISK_OBSERVATIONS) return undefined;
  const vals = [...r.values()];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1);
  const ma = paired.reduce((a, [, y]) => a + y, 0) / paired.length;
  const aa = paired.reduce((a, [x]) => a + x, 0) / paired.length;
  let cov = 0;
  let mvar = 0;
  for (const [x, y] of paired) {
    cov += (x - aa) * (y - ma);
    mvar += (y - ma) ** 2;
  }
  let peak = -Infinity;
  let mdd = 0;
  for (const b of recent) {
    peak = Math.max(peak, b.close);
    mdd = Math.max(mdd, 1 - b.close / peak);
  }
  return {
    symbol,
    observations: vals.length,
    annualVol: Math.sqrt(variance) * Math.sqrt(252),
    beta: mvar > 0 ? cov / mvar : 1,
    maxDrawdown1y: mdd,
  };
}

export function computeAllRiskStats(bars: Map<string, Bar[]>, marketSymbol = "SPY"): Map<string, RiskStats> {
  const market = bars.get(marketSymbol) ?? [];
  const out = new Map<string, RiskStats>();
  for (const [symbol, list] of bars) {
    const s = computeRiskStats(symbol, list, market);
    if (s) out.set(symbol, s);
  }
  return out;
}
