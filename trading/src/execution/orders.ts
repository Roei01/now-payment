import { query, maybeOne, one, withTx, type Db } from "../db/pool.js";
import { D, Decimal, ZERO } from "../lib/money.js";
import { sha256 } from "../lib/crypto.js";
import { errMsg, log } from "../lib/logger.js";
import type { Broker, BrokerOrder } from "../broker/types.js";
import { OPEN_ORDER_STATUSES, loadState } from "../portfolio/state.js";
import { pausePortfolio } from "../portfolio/control.js";
import { openIncident } from "../ops/incidents.js";
import type pg from "pg";

export interface OrderRow {
  id: string;
  portfolio_id: string;
  decision_id: string | null;
  asset_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: string;
  order_type: "MARKET" | "LIMIT";
  limit_price: string | null;
  client_order_id: string;
  broker_order_id: string | null;
  venue: string;
  status: string;
  filled_qty: string;
  avg_fill_price: string | null;
  reserved_cash: string;
  est_price: string;
  created_at: Date;
  submitted_at: Date | null;
}

/** Deterministic id: a retry of the same decision+asset+side can never create a second order. */
export function clientOrderIdFor(portfolioCode: string, decisionId: string, symbol: string, side: string): string {
  return `${portfolioCode.slice(0, 12)}-${sha256(`${decisionId}|${symbol}|${side}`).slice(0, 24)}`;
}

const ORDER_SELECT = `SELECT o.*, a.symbol FROM orders o JOIN assets a ON a.id = o.asset_id`;

export async function getOrderByClientId(db: Db, clientOrderId: string): Promise<OrderRow | undefined> {
  return maybeOne<OrderRow>(db, `${ORDER_SELECT} WHERE o.client_order_id = $1`, [clientOrderId]);
}

async function addEvent(db: Db, orderId: string, type: string, payload: Record<string, unknown> = {}) {
  await query(db, "INSERT INTO order_events (order_id, event_type, payload) VALUES ($1, $2, $3)", [orderId, type, JSON.stringify(payload)]);
}

export interface PlaceOrderInput {
  portfolioId: string;
  portfolioCode: string;
  decisionId: string;
  assetId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: Decimal;
  orderType: "MARKET" | "LIMIT";
  limitPrice?: number;
  estPrice: number;
  reservedCash: Decimal;
  venue: string;
}

/**
 * Persist-then-submit. The order row (with its deterministic client id) is
 * committed before contacting the broker, so a crash between submit and
 * acknowledgement is resolved by reconciliation rather than a resubmission.
 */
export async function placeOrder(db: pg.Pool, broker: Broker, input: PlaceOrderInput): Promise<OrderRow> {
  const cid = clientOrderIdFor(input.portfolioCode, input.decisionId, input.symbol, input.side);
  let order = await getOrderByClientId(db, cid);
  if (!order) {
    await withTx(async (tx) => {
      const rows = await query<{ id: string }>(
        tx,
        `INSERT INTO orders (portfolio_id, decision_id, asset_id, side, qty, order_type, limit_price, client_order_id, venue, status, reserved_cash, est_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_SUBMIT', $10, $11)
         ON CONFLICT (client_order_id) DO NOTHING RETURNING id`,
        [
          input.portfolioId,
          input.decisionId,
          input.assetId,
          input.side,
          input.qty.toFixed(8),
          input.orderType,
          input.limitPrice ?? null,
          cid,
          input.venue,
          input.reservedCash.toFixed(6),
          input.estPrice,
        ],
      );
      if (rows[0]) await addEvent(tx, rows[0].id, "PENDING_SUBMIT", { qty: input.qty.toFixed(8), estPrice: input.estPrice });
    });
    order = (await getOrderByClientId(db, cid))!;
  }
  if (order.status !== "PENDING_SUBMIT") return order; // already submitted earlier (retry path)
  return submitPending(db, broker, order);
}

export async function submitPending(db: pg.Pool, broker: Broker, order: OrderRow): Promise<OrderRow> {
  try {
    // Never resubmit blindly: ask the venue first.
    const existing = await broker.getByClientOrderId(order.client_order_id);
    const result =
      existing ??
      (await broker.submit({
        clientOrderId: order.client_order_id,
        symbol: order.symbol,
        side: order.side,
        qty: D(order.qty).toFixed(6),
        type: order.order_type,
        limitPrice: order.limit_price ?? undefined,
        timeInForce: "DAY",
      }));
    await query(db, "UPDATE orders SET submitted_at = COALESCE(submitted_at, now()), status = 'SUBMITTED', updated_at = now() WHERE id = $1 AND status = 'PENDING_SUBMIT'", [
      order.id,
    ]);
    await addEvent(db, order.id, existing ? "FOUND_AT_BROKER" : "SUBMITTED", { brokerOrderId: result.brokerOrderId });
    return applyBrokerOrder(db, order.id, result);
  } catch (err) {
    // Any exception here means we do not know whether the venue has the order (definitive
    // rejections come back as a REJECTED order, not as an exception).
    const uncertain = true;
    await query(db, "UPDATE orders SET status = 'UNKNOWN', updated_at = now() WHERE id = $1", [order.id]);
    await addEvent(db, order.id, "SUBMIT_UNCERTAIN", { error: errMsg(err) });
    if (uncertain) await pausePortfolio(db, order.portfolio_id, `uncertain broker response for ${order.client_order_id}: ${errMsg(err)}`, "system", `broker-uncertain:${order.portfolio_id}`);
    log.error("order submit uncertain", { order: order.client_order_id, error: errMsg(err) });
    return (await getOrderByClientId(db, order.client_order_id))!;
  }
}

/** Idempotently records one fill and its ledger effects. Returns false for a duplicate. */
export async function recordFill(
  db: pg.Pool,
  orderId: string,
  fill: { id: string; qty: string; price: string; fee: string; at: Date; feeEstimated: boolean },
): Promise<boolean> {
  return withTx(async (tx) => {
    const order = await one<OrderRow>(tx, `${ORDER_SELECT} WHERE o.id = $1 FOR UPDATE OF o`, [orderId]);
    const qty = D(fill.qty);
    if (D(order.filled_qty).plus(qty).greaterThan(D(order.qty).plus("1e-8"))) {
      await openIncident(tx, {
        severity: "CRITICAL",
        kind: "OVERFILL",
        message: `fill would exceed order qty for ${order.client_order_id}`,
        details: { fill, orderQty: order.qty, filled: order.filled_qty },
        portfolioId: order.portfolio_id,
        dedupeKey: `overfill:${order.id}:${fill.id}`,
      });
      return false;
    }
    const ins = await query<{ id: string }>(
      tx,
      `INSERT INTO fills (order_id, broker_fill_id, qty, price, fee, occurred_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (order_id, broker_fill_id) DO NOTHING RETURNING id`,
      [orderId, fill.id, fill.qty, fill.price, fill.fee, fill.at],
    );
    if (ins.length === 0) return false;
    const fillId = ins[0]!.id;
    const notional = qty.times(fill.price);
    const sign = order.side === "BUY" ? 1 : -1;
    await query(
      tx,
      `INSERT INTO ledger_entries (portfolio_id, entry_type, asset_id, qty_delta, cash_delta, price, order_id, fill_id, occurred_at, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        order.portfolio_id,
        order.side,
        order.asset_id,
        qty.times(sign).toFixed(8),
        notional.times(-sign).toFixed(6),
        fill.price,
        orderId,
        fillId,
        fill.at,
        `fill ${fill.id}`,
      ],
    );
    if (D(fill.fee).greaterThan(0))
      await query(
        tx,
        `INSERT INTO ledger_entries (portfolio_id, entry_type, asset_id, cash_delta, order_id, reference, occurred_at, memo)
         VALUES ($1, 'FEE', $2, $3, $4, $5, $6, $7)`,
        [order.portfolio_id, order.asset_id, D(fill.fee).neg().toFixed(6), orderId, `fee:${fillId}`, fill.at, fill.feeEstimated ? "estimated fee" : "venue fee"],
      );
    const newFilled = D(order.filled_qty).plus(qty);
    const prevNotional = D(order.filled_qty).times(order.avg_fill_price ?? 0);
    const avg = prevNotional.plus(notional).div(newFilled);
    await query(tx, "UPDATE orders SET filled_qty = $2, avg_fill_price = $3, updated_at = now() WHERE id = $1", [
      orderId,
      newFilled.toFixed(8),
      avg.toFixed(6),
    ]);
    await addEvent(tx, orderId, "FILL", { fillId: fill.id, qty: fill.qty, price: fill.price, fee: fill.fee });
    return true;
  });
}

/** Applies a broker view of an order: new fills (idempotent) and status transitions. */
export async function applyBrokerOrder(db: pg.Pool, orderId: string, b: BrokerOrder): Promise<OrderRow> {
  let order = await one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
  if (b.fillsCumulativeOnly) {
    const prevQty = D(order.filled_qty);
    const cum = D(b.filledQty);
    if (cum.greaterThan(prevQty) && b.avgFillPrice) {
      const qty = cum.minus(prevQty);
      const price = cum.times(b.avgFillPrice).minus(prevQty.times(order.avg_fill_price ?? 0)).div(qty);
      await recordFill(db, orderId, {
        id: `${b.brokerOrderId}:${cum.toFixed(8)}`,
        qty: qty.toFixed(8),
        price: price.toFixed(6),
        fee: "0",
        at: b.lastFillAt ?? new Date(),
        feeEstimated: true,
      });
    }
  } else {
    for (const f of b.fills) await recordFill(db, orderId, f);
  }
  order = await one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
  const status = b.status === "PARTIALLY_FILLED" && D(order.filled_qty).gte(order.qty) ? "FILLED" : b.status;
  if (status !== order.status) {
    await query(db, "UPDATE orders SET status = $2, broker_order_id = COALESCE($3, broker_order_id), updated_at = now() WHERE id = $1", [
      orderId,
      status,
      b.brokerOrderId || null,
    ]);
    await addEvent(db, orderId, status, { brokerOrderId: b.brokerOrderId, filledQty: b.filledQty, rejectReason: b.rejectReason });
  } else if (b.brokerOrderId && !order.broker_order_id) {
    await query(db, "UPDATE orders SET broker_order_id = $2 WHERE id = $1", [orderId, b.brokerOrderId]);
  }
  return one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
}

/**
 * Re-reads every open/uncertain order from the venue. Orders the venue never
 * received are closed; uncertain ones become definite. Safe to run at any time.
 */
export async function reconcileOrders(db: pg.Pool, broker: Broker, portfolioId: string): Promise<{ checked: number; resolved: number }> {
  if (broker.poll) await broker.poll();
  const open = await query<OrderRow>(db, `${ORDER_SELECT} WHERE o.portfolio_id = $1 AND o.status = ANY($2)`, [portfolioId, OPEN_ORDER_STATUSES]);
  let resolved = 0;
  for (const o of open) {
    const b = await broker.getByClientOrderId(o.client_order_id);
    if (!b) {
      if (o.status === "PENDING_SUBMIT" || o.status === "UNKNOWN") {
        await query(db, "UPDATE orders SET status = 'CANCELED', updated_at = now() WHERE id = $1", [o.id]);
        await addEvent(db, o.id, "NOT_FOUND_AT_BROKER", { previous: o.status });
        resolved++;
      }
      continue;
    }
    const after = await applyBrokerOrder(db, o.id, b);
    if (!OPEN_ORDER_STATUSES.includes(after.status) || o.status === "UNKNOWN") resolved++;
  }
  return { checked: open.length, resolved };
}

/**
 * Compares venue custody with the ledger. Any unexplained difference (for example
 * a manual trade at the broker) pauses the portfolio; it is never auto-"fixed".
 */
export async function reconcilePositions(db: pg.Pool, broker: Broker, portfolioId: string): Promise<{ ok: boolean; diffs: { symbol: string; ledger: string; broker: string }[] }> {
  const state = await loadState(db, portfolioId);
  const brokerPositions = await broker.getPositions();
  const bmap = new Map(brokerPositions.map((p) => [p.symbol, D(p.qty)]));
  const symbols = new Set([...bmap.keys(), ...state.positions.keys()]);
  const diffs: { symbol: string; ledger: string; broker: string }[] = [];
  for (const s of symbols) {
    const l = state.positions.get(s)?.qty ?? ZERO;
    const b = bmap.get(s) ?? ZERO;
    if (l.minus(b).abs().greaterThan("1e-6")) diffs.push({ symbol: s, ledger: l.toFixed(8), broker: b.toFixed(8) });
  }
  await query(db, "UPDATE broker_connections SET last_sync_at = now(), status = $2, last_error = $3 WHERE portfolio_id = $1", [
    portfolioId,
    diffs.length ? "ERROR" : "OK",
    diffs.length ? `position mismatch: ${JSON.stringify(diffs)}` : null,
  ]);
  if (diffs.length) {
    await openIncident(db, {
      severity: "CRITICAL",
      kind: "RECONCILIATION_MISMATCH",
      message: "Broker positions differ from the ledger",
      details: { diffs },
      portfolioId,
      dedupeKey: `recon:${portfolioId}`,
    });
    await pausePortfolio(db, portfolioId, "reconciliation mismatch", "system", `recon-pause:${portfolioId}`);
  }
  return { ok: diffs.length === 0, diffs };
}
