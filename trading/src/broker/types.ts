import type { MarketSnapshot } from "../market/types.js";

export type BrokerOrderStatus = "ACCEPTED" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";

export interface BrokerOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: string;
  type: "MARKET" | "LIMIT";
  limitPrice?: string;
  timeInForce: "DAY";
}

export interface BrokerFill {
  id: string;
  qty: string;
  price: string;
  fee: string;
  at: Date;
  feeEstimated: boolean;
}

export interface BrokerOrder {
  clientOrderId: string;
  brokerOrderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: string;
  status: BrokerOrderStatus;
  filledQty: string;
  avgFillPrice: string | null;
  fills: BrokerFill[];
  /** Venue reports only cumulative filled qty/avg price (no per-fill records). */
  fillsCumulativeOnly?: boolean;
  lastFillAt?: Date;
  rejectReason?: string;
}

export interface BrokerAccount {
  cash: string;
  buyingPower: string;
  currency: string;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  status: string;
  multiplier: string; // >1 means margin account
}

export interface BrokerPosition {
  symbol: string;
  qty: string;
}

export interface Broker {
  readonly venue: "INTERNAL_SIM" | "ALPACA_PAPER" | "ALPACA_LIVE";
  /** Provides the current market to venues that simulate fills. */
  setMarket?(snapshot: MarketSnapshot): void;
  submit(req: BrokerOrderRequest): Promise<BrokerOrder>;
  getByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null>;
  cancel(clientOrderId: string): Promise<void>;
  listOpenOrders(): Promise<BrokerOrder[]>;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  /** Advances resting orders (sim only). */
  poll?(): Promise<void>;
}

/** Thrown when we cannot tell whether the broker accepted an order. */
export class BrokerUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerUncertainError";
  }
}
