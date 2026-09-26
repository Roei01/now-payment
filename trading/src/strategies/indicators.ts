import type { Bar } from "../market/types.js";

export function sma(bars: Bar[], n: number): number | undefined {
  if (bars.length < n) return undefined;
  const s = bars.slice(-n);
  return s.reduce((a, b) => a + b.close, 0) / n;
}

export function momentum(bars: Bar[], lookback: number, skip = 0): number | undefined {
  if (bars.length < lookback + skip + 1) return undefined;
  const end = bars[bars.length - 1 - skip]!.close;
  const start = bars[bars.length - 1 - skip - lookback]!.close;
  return end / start - 1;
}

export function high(bars: Bar[], n: number): number | undefined {
  if (bars.length === 0) return undefined;
  return Math.max(...bars.slice(-n).map((b) => b.high));
}

export function tradingDaysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / 86_400_000 * (5 / 7));
}
