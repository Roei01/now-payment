import type { FxProvider, FxQuote } from "./types.js";

/**
 * Frankfurter hosts, tried in order. The documented v1 API lives at api.frankfurter.dev/v1
 * (https://frankfurter.dev/v1/); the legacy api.frankfurter.app host (no /v1 prefix) serves
 * the same ECB data and is kept only as a fallback.
 */
export const FRANKFURTER_BASES = ["https://api.frankfurter.dev/v1", "https://api.frankfurter.app"] as const;

/** Plausibility band for USD/ILS; anything outside is treated as bad data, never used. */
const USD_ILS_SANE = { min: 1, max: 10 };

/** Frankfurter (ECB reference rates, published once per business day around 16:00 CET). */
export class FrankfurterFx implements FxProvider {
  readonly name = "frankfurter-ecb";
  constructor(
    private fetchImpl: typeof fetch = fetch,
    private bases: readonly string[] = FRANKFURTER_BASES,
  ) {}

  async getUsdIls(date?: string): Promise<FxQuote> {
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`frankfurter: bad date ${date}`);
    const path = date ?? "latest";
    const errors: string[] = [];
    for (const base of this.bases) {
      try {
        return await this.fetchFrom(base, path);
      } catch (err) {
        errors.push(`${base}: ${(err as Error).message}`);
      }
    }
    throw new Error(`frankfurter unavailable (${errors.join("; ")})`);
  }

  private async fetchFrom(base: string, path: string): Promise<FxQuote> {
    const res = await this.fetchImpl(`${base}/${path}?base=USD&symbols=ILS`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { base?: string; date?: string; rates?: { ILS?: number } };
    const rate = body.rates?.ILS;
    if (body.base !== undefined && body.base !== "USD") throw new Error(`unexpected base ${body.base}`);
    if (typeof rate !== "number" || !Number.isFinite(rate)) throw new Error("ILS rate missing");
    if (rate < USD_ILS_SANE.min || rate > USD_ILS_SANE.max) throw new Error(`implausible USD/ILS ${rate}`);
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new Error("rate date missing");
    // ECB reference rates are fixed ~14:15 CET and published ~16:00 CET (<= 15:00 UTC).
    return { base: "USD", quote: "ILS", rate, source: `${this.name} (${body.date})`, asOf: new Date(`${body.date}T15:00:00Z`) };
  }
}

/** Fixed rate for development only; flagged in every record that uses it. */
export class StaticFx implements FxProvider {
  readonly name = "static-dev";
  constructor(private rate: number) {}
  async getUsdIls(): Promise<FxQuote> {
    return { base: "USD", quote: "ILS", rate: this.rate, source: "static-dev (NOT a market rate)", asOf: new Date() };
  }
}
