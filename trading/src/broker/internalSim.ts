import { query, maybeOne, type Db } from "../db/pool.js";
import { D, ZERO } from "../lib/money.js";
import type { MarketSnapshot } from "../market/types.js";
import type { CostModel } from "../risk/policy.js";
import type { Broker, BrokerAccount, BrokerFill, BrokerOrder, BrokerOrderRequest, BrokerPosition } from "./types.js";
import { randomToken } from "../lib/crypto.js";

interface SimRow {
  client_order_id: string;
  broker_order_id: string;
  account: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: string;
  order_type: "MARKET" | "LIMIT";
  limit_price: string | null;
  status: BrokerOrder["status"];
  filled_qty: string;
  fills: { id: string; qty: string; price: string; fee: string; at: string }[];
  session_date: string;
}

function toOrder(r: SimRow): BrokerOrder {
  const fills: BrokerFill[] = r.fills.map((f) => ({ ...f, at: new Date(f.at), feeEstimated: false }));
  const filled = D(r.filled_qty);
  const avg = filled.isZero() ? null : fills.reduce((a, f) => a.plus(D(f.qty).times(f.price)), ZERO).div(filled).toFixed(6);
  return {
    clientOrderId: r.client_order_id,
    brokerOrderId: r.broker_order_id,
    symbol: r.symbol,
    side: r.side,
    qty: r.qty,
    status: r.status,
    filledQty: r.filled_qty,
    avgFillPrice: avg,
    fills,
  };
}

/**
 * Internal paper venue ("סימולטור פנימי"). Fills market orders against the
 * current quote plus slippage; limit orders rest until marketable or the session ends.
 * Its fills are an approximation and are labelled as such everywhere.
 */
export class InternalSimBroker implements Broker {
  readonly venue = "INTERNAL_SIM" as const;
  private snapshot?: MarketSnapshot;
  constructor(
    private db: Db,
    private account: string,
    private costs: CostModel,
    private ledgerPositions: () => Promise<BrokerPosition[]>,
    private ledgerCash: () => Promise<string>,
  ) {}

  setMarket(snapshot: MarketSnapshot): void {
    this.snapshot = snapshot;
  }

  private async tryFill(row: SimRow): Promise<SimRow> {
    const s = this.snapshot;
    if (!s || !s.clock.isOpen) return row;
    if (row.status !== "ACCEPTED" && row.status !== "PARTIALLY_FILLED") return row;
    if (row.session_date !== s.clock.sessionDate) {
      await query(this.db, "UPDATE sim_broker_orders SET status = 'EXPIRED', updated_at = now() WHERE client_order_id = $1", [row.client_order_id]);
      return { ...row, status: "EXPIRED" };
    }
    const q = s.quotes.get(row.symbol);
    if (!q) return row;
    const slip = this.costs.slippageBps / 10_000;
    const base = row.side === "BUY" ? (q.ask ?? q.last) : (q.bid ?? q.last);
    let px = row.side === "BUY" ? base * (1 + slip) : base * (1 - slip);
    if (row.order_type === "LIMIT" && row.limit_price) {
      const lim = Number(row.limit_price);
      if (row.side === "BUY" && base > lim) return row;
      if (row.side === "SELL" && base < lim) return row;
      px = row.side === "BUY" ? Math.min(px, lim) : Math.max(px, lim);
    }
    const remaining = D(row.qty).minus(row.filled_qty);
    const notional = remaining.times(px);
    const fee = D(this.costs.commissionPerOrderUsd).plus(row.side === "SELL" ? notional.times(this.costs.sellRegulatoryFeeBps).div(10_000) : 0);
    const fill = { id: `${row.broker_order_id}-f${row.fills.length + 1}`, qty: remaining.toFixed(8), price: px.toFixed(6), fee: fee.toFixed(6), at: s.asOf.toISOString() };
    const fills = [...row.fills, fill];
    await query(
      this.db,
      "UPDATE sim_broker_orders SET status = 'FILLED', filled_qty = qty, fills = $2, updated_at = now() WHERE client_order_id = $1",
      [row.client_order_id, JSON.stringify(fills)],
    );
    return { ...row, status: "FILLED", filled_qty: row.qty, fills };
  }

  async submit(req: BrokerOrderRequest): Promise<BrokerOrder> {
    const existing = await this.getRow(req.clientOrderId);
    if (existing) return toOrder(existing); // idempotent
    const s = this.snapshot;
    const status = !s || !s.clock.isOpen ? "REJECTED" : "ACCEPTED";
    await query(
      this.db,
      `INSERT INTO sim_broker_orders (client_order_id, broker_order_id, account, symbol, side, qty, order_type, limit_price, status, session_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (client_order_id) DO NOTHING`,
      [
        req.clientOrderId,
        `sim-${randomToken(9)}`,
        this.account,
        req.symbol,
        req.side,
        req.qty,
        req.type,
        req.limitPrice ?? null,
        status,
        s?.clock.sessionDate ?? "1970-01-01",
      ],
    );
    const row = (await this.getRow(req.clientOrderId))!;
    if (status === "REJECTED") return { ...toOrder(row), rejectReason: "market closed (sim)" };
    return toOrder(await this.tryFill(row));
  }

  private async getRow(clientOrderId: string): Promise<SimRow | undefined> {
    return maybeOne<SimRow>(this.db, "SELECT * FROM sim_broker_orders WHERE client_order_id = $1 AND account = $2", [clientOrderId, this.account]);
  }

  async getByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
    const row = await this.getRow(clientOrderId);
    return row ? toOrder(row) : null;
  }

  async cancel(clientOrderId: string): Promise<void> {
    await query(
      this.db,
      "UPDATE sim_broker_orders SET status = 'CANCELED', updated_at = now() WHERE client_order_id = $1 AND status IN ('ACCEPTED', 'PARTIALLY_FILLED')",
      [clientOrderId],
    );
  }

  async listOpenOrders(): Promise<BrokerOrder[]> {
    const rows = await query<SimRow>(
      this.db,
      "SELECT * FROM sim_broker_orders WHERE account = $1 AND status IN ('ACCEPTED', 'PARTIALLY_FILLED')",
      [this.account],
    );
    return rows.map(toOrder);
  }

  async poll(): Promise<void> {
    const rows = await query<SimRow>(
      this.db,
      "SELECT * FROM sim_broker_orders WHERE account = $1 AND status IN ('ACCEPTED', 'PARTIALLY_FILLED')",
      [this.account],
    );
    for (const r of rows) await this.tryFill(r);
  }

  async getAccount(): Promise<BrokerAccount> {
    const cash = await this.ledgerCash();
    return { cash, buyingPower: cash, currency: "USD", tradingBlocked: false, accountBlocked: false, status: "ACTIVE", multiplier: "1" };
  }

  /** The internal venue's custody is the ledger itself. */
  async getPositions(): Promise<BrokerPosition[]> {
    return this.ledgerPositions();
  }
}
