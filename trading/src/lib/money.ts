import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
export type Num = Decimal.Value;

export const D = (v: Num | null | undefined): Decimal => new Decimal(v ?? 0);
export const ZERO = new Decimal(0);

export function sum(values: Num[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

/** Round quantity down to the given number of decimals (never over-buy / over-sell). */
export function floorQty(qty: Decimal, decimals: number): Decimal {
  return qty.toDecimalPlaces(decimals, Decimal.ROUND_DOWN);
}

export function toFixedStr(v: Num, dp = 6): string {
  return new Decimal(v).toFixed(dp);
}

export function pct(numerator: Num, denominator: Num): Decimal {
  const d = new Decimal(denominator);
  if (d.isZero()) return new Decimal(0);
  return new Decimal(numerator).div(d);
}
