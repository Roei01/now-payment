import { query, maybeOne, type Db } from "../db/pool.js";
import { D } from "../lib/money.js";
import type { MarketSnapshot } from "../market/types.js";
import type { PortfolioState, Valuation } from "../portfolio/state.js";

/** Upserts today's performance row (last snapshot of the session wins) and a positions snapshot. */
export async function recordPerformance(
  db: Db,
  state: PortfolioState,
  valuation: Valuation,
  snapshot: MarketSnapshot,
  strategyVersionId: string | null,
): Promise<void> {
  const p = state.portfolio;
  const initial = D(p.initial_capital_usd);
  if (initial.isZero()) return;
  const date = snapshot.clock.sessionDate;
  const prevPeak = await maybeOne<{ peak: string }>(
    db,
    "SELECT MAX(peak_value_usd) AS peak FROM performance_daily WHERE portfolio_id = $1 AND date < $2",
    [p.id, date],
  );
  const value = valuation.total;
  const peak = D(prevPeak?.peak ?? initial).greaterThan(value) ? D(prevPeak?.peak ?? initial) : value;
  const peakFinal = peak.lessThan(initial) ? initial : peak;
  const fx = D(snapshot.fx.rate);
  const valueIls = value.times(fx);
  const initialIls = D(p.initial_capital_ils ?? initial.times(p.initial_fx_rate ?? fx));
  const lossFromInitial = value.lessThan(initial) ? initial.minus(value).div(initial) : D(0);
  await query(
    db,
    `INSERT INTO performance_daily (portfolio_id, date, strategy_version_id, value_usd, cash_usd, fx_rate, value_ils, invested_pct,
        net_return_pct, return_ils_pct, loss_from_initial_pct, peak_value_usd, drawdown_pct, fees_cum_usd, realized_pnl_usd,
        unrealized_pnl_usd, trades_cum, simulated_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (portfolio_id, date) DO UPDATE SET
        strategy_version_id = EXCLUDED.strategy_version_id, value_usd = EXCLUDED.value_usd, cash_usd = EXCLUDED.cash_usd,
        fx_rate = EXCLUDED.fx_rate, value_ils = EXCLUDED.value_ils, invested_pct = EXCLUDED.invested_pct,
        net_return_pct = EXCLUDED.net_return_pct, return_ils_pct = EXCLUDED.return_ils_pct,
        loss_from_initial_pct = EXCLUDED.loss_from_initial_pct,
        peak_value_usd = GREATEST(performance_daily.peak_value_usd, EXCLUDED.peak_value_usd),
        drawdown_pct = EXCLUDED.drawdown_pct, fees_cum_usd = EXCLUDED.fees_cum_usd, realized_pnl_usd = EXCLUDED.realized_pnl_usd,
        unrealized_pnl_usd = EXCLUDED.unrealized_pnl_usd, trades_cum = EXCLUDED.trades_cum,
        simulated_data = performance_daily.simulated_data OR EXCLUDED.simulated_data, computed_at = now()`,
    [
      p.id,
      date,
      strategyVersionId,
      value.toFixed(6),
      state.cash.toFixed(6),
      fx.toFixed(8),
      valueIls.toFixed(6),
      value.isZero() ? "0" : valuation.positionsValue.div(value).toFixed(4),
      value.div(initial).minus(1).toFixed(6),
      initialIls.isZero() ? "0" : valueIls.div(initialIls).minus(1).toFixed(6),
      lossFromInitial.toFixed(6),
      peakFinal.toFixed(6),
      D(1).minus(value.div(peakFinal)).toFixed(6),
      state.feesCum.toFixed(6),
      state.realizedPnl.toFixed(6),
      valuation.unrealizedPnl.toFixed(6),
      state.trades,
      snapshot.simulated,
    ],
  );
  await query(db, "INSERT INTO positions_snapshots (portfolio_id, as_of, cash_usd, value_usd, positions) VALUES ($1, $2, $3, $4, $5)", [
    p.id,
    snapshot.asOf,
    state.cash.toFixed(6),
    value.toFixed(6),
    JSON.stringify(
      [...state.positions.values()].map((pos) => ({
        symbol: pos.symbol,
        qty: pos.qty.toFixed(8),
        costBasis: pos.costBasis.toFixed(6),
        weight: valuation.weights.get(pos.symbol)?.toFixed(4) ?? null,
      })),
    ),
  ]);
}
