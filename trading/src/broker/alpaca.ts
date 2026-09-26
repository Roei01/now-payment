import { alpacaFetch, ALPACA_URLS, type AlpacaCreds } from "../market/alpaca.js";
import { D } from "../lib/money.js";
import type { Broker, BrokerAccount, BrokerOrder, BrokerOrderRequest, BrokerPosition, BrokerOrderStatus } from "./types.js";
import { BrokerUncertainError } from "./types.js";

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: string | null;
  status: string;
  filled_qty: string;
  filled_avg_price: string | null;
  updated_at: string;
  filled_at: string | null;
}

function mapStatus(s: string): BrokerOrderStatus {
  switch (s) {
    case "filled":
      return "FILLED";
    case "partially_filled":
      return "PARTIALLY_FILLED";
    case "canceled":
    case "done_for_day":
    case "replaced":
      return "CANCELED";
    case "expired":
      return "EXPIRED";
    case "rejected":
    case "suspended":
      return "REJECTED";
    default:
      return "ACCEPTED"; // new, accepted, pending_new, accepted_for_bidding, pending_cancel, held…
  }
}

/**
 * Alpaca exposes cumulative filled_qty / filled_avg_price per order; the execution
 * layer turns each increase into one synthetic fill (see execution/orders.ts).
 */
export function toBrokerOrder(o: AlpacaOrder): BrokerOrder {
  return {
    clientOrderId: o.client_order_id,
    brokerOrderId: o.id,
    symbol: o.symbol,
    side: o.side === "buy" ? "BUY" : "SELL",
    qty: o.qty ?? "0",
    status: mapStatus(o.status),
    filledQty: D(o.filled_qty || 0).toFixed(8),
    avgFillPrice: o.filled_avg_price,
    fills: [],
    fillsCumulativeOnly: true,
    lastFillAt: new Date(o.filled_at ?? o.updated_at),
  };
}

export class AlpacaBroker implements Broker {
  private base: string;
  constructor(
    readonly venue: "ALPACA_PAPER" | "ALPACA_LIVE",
    private creds: AlpacaCreds,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.base = venue === "ALPACA_LIVE" ? ALPACA_URLS.live : ALPACA_URLS.paper;
  }

  private call<T>(path: string, init: RequestInit = {}) {
    return alpacaFetch<T>(this.base, path, this.creds, init, this.fetchImpl);
  }

  async submit(req: BrokerOrderRequest): Promise<BrokerOrder> {
    const existing = await this.getByClientOrderId(req.clientOrderId);
    if (existing) return existing;
    const body: Record<string, string> = {
      symbol: req.symbol,
      qty: req.qty,
      side: req.side.toLowerCase(),
      type: req.type.toLowerCase(),
      time_in_force: "day",
      client_order_id: req.clientOrderId,
    };
    if (req.limitPrice) body.limit_price = req.limitPrice;
    try {
      const o = await this.call<AlpacaOrder>("/v2/orders", { method: "POST", body: JSON.stringify(body) });
      return toBrokerOrder(o);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        // Definitive rejection by the broker.
        return {
          clientOrderId: req.clientOrderId,
          brokerOrderId: "",
          symbol: req.symbol,
          side: req.side,
          qty: req.qty,
          status: "REJECTED",
          filledQty: "0",
          avgFillPrice: null,
          fills: [],
          rejectReason: (err as Error).message,
        };
      }
      throw new BrokerUncertainError((err as Error).message);
    }
  }

  async getByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
    try {
      const o = await this.call<AlpacaOrder>(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
      return toBrokerOrder(o);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }

  async cancel(clientOrderId: string): Promise<void> {
    const o = await this.getByClientOrderId(clientOrderId);
    if (o?.brokerOrderId) await this.call(`/v2/orders/${o.brokerOrderId}`, { method: "DELETE" });
  }

  async listOpenOrders(): Promise<BrokerOrder[]> {
    const list = await this.call<AlpacaOrder[]>("/v2/orders?status=open&limit=500");
    return list.map((o) => toBrokerOrder(o));
  }

  async getAccount(): Promise<BrokerAccount> {
    const a = await this.call<{
      cash: string;
      buying_power: string;
      currency: string;
      trading_blocked: boolean;
      account_blocked: boolean;
      status: string;
      multiplier: string;
    }>("/v2/account");
    return {
      cash: a.cash,
      buyingPower: a.buying_power,
      currency: a.currency,
      tradingBlocked: a.trading_blocked,
      accountBlocked: a.account_blocked,
      status: a.status,
      multiplier: a.multiplier,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const list = await this.call<{ symbol: string; qty: string }[]>("/v2/positions");
    return list.map((p) => ({ symbol: p.symbol, qty: p.qty }));
  }
}
