import type { FxProvider, FxQuote } from "./types.js";

/** Frankfurter (ECB reference rates, published once per business day). */
export class FrankfurterFx implements FxProvider {
  readonly name = "frankfurter-ecb";
  constructor(private fetchImpl: typeof fetch = fetch) {}
  async getUsdIls(date?: string): Promise<FxQuote> {
    const path = date ? date : "latest";
    const res = await this.fetchImpl(`https://api.frankfurter.dev/v1/${path}?base=USD&symbols=ILS`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const body = (await res.json()) as { date: string; rates: { ILS?: number } };
    if (!body.rates.ILS) throw new Error("frankfurter: ILS rate missing");
    return { base: "USD", quote: "ILS", rate: body.rates.ILS, source: `${this.name} (${body.date})`, asOf: new Date(`${body.date}T16:00:00Z`) };
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
