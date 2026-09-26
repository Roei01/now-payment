import type pg from "pg";
import { config } from "../config.js";
import type { PortfolioRow } from "../portfolio/state.js";
import { loadState } from "../portfolio/state.js";
import type { CostModel } from "../risk/policy.js";
import { AlpacaBroker } from "./alpaca.js";
import { InternalSimBroker } from "./internalSim.js";
import type { Broker } from "./types.js";

export type BrokerFactory = (p: PortfolioRow) => { broker?: Broker; reason?: string };

export function defaultBrokerFactory(pool: pg.Pool, costs: CostModel): BrokerFactory {
  return (p) => {
    const c = config();
    switch (p.execution_venue) {
      case "INTERNAL_SIM":
        return {
          broker: new InternalSimBroker(
            pool,
            p.code,
            costs,
            async () => [...(await loadState(pool, p.id)).positions.values()].map((x) => ({ symbol: x.symbol, qty: x.qty.toFixed(8) })),
            async () => (await loadState(pool, p.id)).cash.toFixed(6),
          ),
        };
      case "ALPACA_PAPER":
        if (!c.BROKER_PAPER_KEY || !c.BROKER_PAPER_SECRET) return { reason: "BROKER_PAPER_KEY/SECRET not configured" };
        return { broker: new AlpacaBroker("ALPACA_PAPER", { keyId: c.BROKER_PAPER_KEY, secret: c.BROKER_PAPER_SECRET }) };
      case "ALPACA_LIVE":
        if (!c.LIVE_TRADING_ENABLED) return { reason: "LIVE_TRADING_ENABLED is false" };
        if (!c.BROKER_LIVE_KEY || !c.BROKER_LIVE_SECRET) return { reason: "BROKER_LIVE_KEY/SECRET not configured" };
        return { broker: new AlpacaBroker("ALPACA_LIVE", { keyId: c.BROKER_LIVE_KEY, secret: c.BROKER_LIVE_SECRET }) };
      default:
        return { reason: "no execution venue" };
    }
  };
}
