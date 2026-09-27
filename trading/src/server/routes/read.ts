import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { query, maybeOne } from "../../db/pool.js";
import { HttpError, requireUser } from "../auth.js";
import { getKillSwitch, getMaintenance } from "../../ops/systemState.js";
import { integrationStatus } from "../../app/deps.js";
import { budgetStatus } from "../../ai/budget.js";
import { config } from "../../config.js";
import { SCENARIOS, DEFAULT_COSTS } from "../../risk/policy.js";
import { DEFAULT_GATE } from "../../promotion/gate.js";
import { TRANSITIONS } from "../../live/stateMachine.js";

const LATEST_PERF = `
  SELECT DISTINCT ON (portfolio_id) portfolio_id, to_char(date, 'YYYY-MM-DD') AS date, value_usd, value_ils, cash_usd, fx_rate, invested_pct,
         net_return_pct, return_ils_pct, loss_from_initial_pct, drawdown_pct, peak_value_usd, fees_cum_usd, realized_pnl_usd,
         unrealized_pnl_usd, trades_cum, simulated_data, computed_at
    FROM performance_daily ORDER BY portfolio_id, date DESC`;

export function registerReadRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get("/api/overview", async (req) => {
    requireUser(req);
    const portfolios = await query(
      pool,
      `SELECT p.id, p.code, p.name, p.kind, p.status, p.execution_venue, p.initial_capital_ils, p.initial_capital_usd, p.initial_fx_rate,
              p.fx_rate_source, p.risk_budget_pct, p.started_at, s.code AS strategy_code, s.name AS strategy_name, v.version AS strategy_version,
              row_to_json(perf) AS perf,
              (SELECT row_to_json(d) FROM (SELECT id, action, status, rationale, created_at FROM decisions WHERE portfolio_id = p.id ORDER BY created_at DESC LIMIT 1) d) AS last_decision
         FROM portfolios p
         LEFT JOIN strategy_assignments sa ON sa.portfolio_id = p.id AND sa.unassigned_at IS NULL
         LEFT JOIN strategy_versions v ON v.id = sa.strategy_version_id
         LEFT JOIN strategies s ON s.id = v.strategy_id
         LEFT JOIN (${LATEST_PERF}) perf ON perf.portfolio_id = p.id
        WHERE p.status <> 'ARCHIVED'
        ORDER BY CASE p.kind WHEN 'PAPER' THEN 0 WHEN 'BENCHMARK' THEN 1 ELSE 2 END, p.code`,
    );
    const lastCycle = await maybeOne(pool, "SELECT id, started_at, finished_at, status, market_open, notes FROM decision_cycles ORDER BY started_at DESC LIMIT 1");
    const heartbeat = await maybeOne(pool, "SELECT last_beat_at FROM heartbeats WHERE component = 'worker'");
    const lastBatch = await maybeOne(pool, "SELECT provider, feed, as_of, ingested_at, status, simulated FROM market_data_batches ORDER BY ingested_at DESC LIMIT 1");
    const openIncidents = await query(pool, "SELECT id, severity, kind, message, opened_at FROM incidents WHERE resolved_at IS NULL ORDER BY opened_at DESC LIMIT 5");
    const c = config();
    return {
      portfolios,
      system: {
        killSwitch: await getKillSwitch(pool),
        maintenance: await getMaintenance(pool),
        lastCycle,
        workerHeartbeat: heartbeat?.last_beat_at ?? null,
        lastBatch,
        openIncidents,
        integrations: integrationStatus(),
      },
      budget: await budgetStatus(pool, { aiBudgetIls: c.AI_MONTHLY_BUDGET_ILS, opsCapIls: c.OPS_MONTHLY_CAP_ILS, infraEstimateIls: c.INFRA_MONTHLY_ESTIMATE_ILS }),
    };
  });

  app.get<{ Params: { id: string } }>("/api/portfolios/:id", async (req) => {
    requireUser(req);
    const p = await maybeOne(pool, "SELECT * FROM portfolios WHERE id = $1", [req.params.id]);
    if (!p) throw new HttpError(404, "portfolio not found");
    const performance = await query(
      pool,
      `SELECT to_char(date, 'YYYY-MM-DD') AS date, value_usd, value_ils, cash_usd, net_return_pct, return_ils_pct, loss_from_initial_pct,
              drawdown_pct, fees_cum_usd, realized_pnl_usd, unrealized_pnl_usd, trades_cum, strategy_version_id, simulated_data
         FROM performance_daily WHERE portfolio_id = $1 ORDER BY date`,
      [p.id],
    );
    const benchmark = await query(
      pool,
      `SELECT to_char(pd.date, 'YYYY-MM-DD') AS date, pd.net_return_pct FROM performance_daily pd JOIN portfolios b ON b.id = pd.portfolio_id
        WHERE b.kind = 'BENCHMARK' AND b.status <> 'ARCHIVED' ORDER BY pd.date`,
    );
    const runs = await query(
      pool,
      `SELECT id, code, run_number, status, data_source, initial_capital_ils, started_at, archived_at FROM portfolios
        WHERE kind = $1 AND (code = $2 OR code LIKE $2 || '#run%') ORDER BY run_number DESC`,
      [p.kind, String(p.code).split("#")[0]],
    );
    const dataSourceIncident = await maybeOne(pool, "SELECT message FROM incidents WHERE dedupe_key = $1 AND resolved_at IS NULL", [`data-source:${p.id}`]);
    const snapshot = await maybeOne(pool, "SELECT as_of, cash_usd, value_usd, positions FROM positions_snapshots WHERE portfolio_id = $1 ORDER BY as_of DESC LIMIT 1", [p.id]);
    const trades = await query(
      pool,
      `SELECT f.occurred_at, a.symbol, o.side, f.qty, f.price, f.fee, o.client_order_id, o.venue, o.decision_id
         FROM fills f JOIN orders o ON o.id = f.order_id JOIN assets a ON a.id = o.asset_id
        WHERE o.portfolio_id = $1 ORDER BY f.occurred_at DESC LIMIT 200`,
      [p.id],
    );
    const openOrders = await query(
      pool,
      `SELECT o.id, a.symbol, o.side, o.qty, o.filled_qty, o.order_type, o.limit_price, o.status, o.created_at
         FROM orders o JOIN assets a ON a.id = o.asset_id
        WHERE o.portfolio_id = $1 AND o.status IN ('PENDING_SUBMIT','SUBMITTED','ACCEPTED','PARTIALLY_FILLED','UNKNOWN')`,
      [p.id],
    );
    const decisions = await query(
      pool,
      "SELECT id, action, status, rationale, created_at, model_version FROM decisions WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT 50",
      [p.id],
    );
    const assignments = await query(
      pool,
      `SELECT sa.assigned_at, sa.unassigned_at, sa.reason, sa.assigned_by, s.code, s.name, v.version, v.id AS version_id
         FROM strategy_assignments sa JOIN strategy_versions v ON v.id = sa.strategy_version_id JOIN strategies s ON s.id = v.strategy_id
        WHERE sa.portfolio_id = $1 ORDER BY sa.assigned_at`,
      [p.id],
    );
    const ledger = await query(
      pool,
      `SELECT l.id, l.entry_type, a.symbol, l.qty_delta, l.cash_delta, l.price, l.memo, l.occurred_at
         FROM ledger_entries l LEFT JOIN assets a ON a.id = l.asset_id WHERE l.portfolio_id = $1 ORDER BY l.id DESC LIMIT 200`,
      [p.id],
    );
    const pnlBySymbol = await query(
      pool,
      `SELECT a.symbol, SUM(l.cash_delta) FILTER (WHERE l.entry_type IN ('BUY','SELL')) AS trade_cash,
              SUM(l.cash_delta) FILTER (WHERE l.entry_type = 'FEE') AS fees, SUM(l.qty_delta) AS qty
         FROM ledger_entries l JOIN assets a ON a.id = l.asset_id WHERE l.portfolio_id = $1 GROUP BY a.symbol ORDER BY a.symbol`,
      [p.id],
    );
    const gate = await maybeOne(pool, "SELECT * FROM promotion_evaluations WHERE portfolio_id = $1 ORDER BY evaluated_at DESC LIMIT 1", [p.id]);
    return { portfolio: p, runs, dataSourceIncident, performance, benchmark, snapshot, trades, openOrders, decisions, assignments, ledger, pnlBySymbol, gate };
  });

  const DecisionsQuery = z.object({
    portfolioId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    status: z.string().max(40).optional(),
  });

  app.get("/api/decisions", async (req) => {
    requireUser(req);
    const q = DecisionsQuery.parse(req.query);
    const limit = q.limit;
    return query(
      pool,
      `SELECT d.id, d.action, d.status, d.rationale, d.created_at, d.model_version, p.code AS portfolio_code, p.name AS portfolio_name
         FROM decisions d JOIN portfolios p ON p.id = d.portfolio_id
        WHERE ($1::uuid IS NULL OR d.portfolio_id = $1) AND ($2::text IS NULL OR d.status = $2)
        ORDER BY d.created_at DESC LIMIT $3`,
      [q.portfolioId ?? null, q.status ?? null, limit],
    );
  });

  app.get<{ Params: { id: string } }>("/api/decisions/:id", async (req) => {
    requireUser(req);
    const d = await maybeOne(
      pool,
      `SELECT d.*, p.code AS portfolio_code, p.name AS portfolio_name, s.code AS strategy_code, v.version AS strategy_version, v.params AS strategy_params
         FROM decisions d JOIN portfolios p ON p.id = d.portfolio_id
         LEFT JOIN strategy_versions v ON v.id = d.strategy_version_id LEFT JOIN strategies s ON s.id = v.strategy_id
        WHERE d.id = $1`,
      [req.params.id],
    );
    if (!d) throw new HttpError(404, "decision not found");
    const cycle = d.cycle_id
      ? await maybeOne(
          pool,
          `SELECT c.*, b.provider, b.feed, b.as_of AS data_as_of, b.ingested_at, b.status AS batch_status, b.simulated, b.stats
             FROM decision_cycles c LEFT JOIN market_data_batches b ON b.id = c.batch_id WHERE c.id = $1`,
          [d.cycle_id],
        )
      : null;
    const signals = d.cycle_id
      ? await query(
          pool,
          `SELECT s.kind, a.symbol, s.value, s.payload FROM signals s LEFT JOIN assets a ON a.id = s.asset_id
            WHERE s.cycle_id = $1 AND s.portfolio_id = $2 ORDER BY s.id`,
          [d.cycle_id, d.portfolio_id],
        )
      : [];
    const riskChecks = await query(pool, "SELECT * FROM risk_checks WHERE decision_id = $1 ORDER BY id", [d.id]);
    const orders = await query(
      pool,
      `SELECT o.*, a.symbol,
              (SELECT json_agg(e ORDER BY e.id) FROM order_events e WHERE e.order_id = o.id) AS events,
              (SELECT json_agg(f ORDER BY f.occurred_at) FROM fills f WHERE f.order_id = o.id) AS fills
         FROM orders o JOIN assets a ON a.id = o.asset_id WHERE o.decision_id = $1`,
      [d.id],
    );
    const forecasts = await query(
      pool,
      `SELECT f.*, a.symbol, row_to_json(o) AS outcome FROM forecast_snapshots f LEFT JOIN assets a ON a.id = f.asset_id
         LEFT JOIN forecast_outcomes o ON o.forecast_id = f.id WHERE f.decision_id = $1`,
      [d.id],
    );
    const prompt = d.prompt_version_id ? await maybeOne(pool, "SELECT id, role, model, prompt_hash, prompt_text, created_at FROM model_prompt_versions WHERE id = $1", [d.prompt_version_id]) : null;
    return { decision: d, cycle, signals, riskChecks, orders, forecasts, prompt };
  });

  app.get("/api/strategies", async (req) => {
    requireUser(req);
    const strategies = await query(
      pool,
      `SELECT s.*, (SELECT json_agg(v ORDER BY v.version) FROM (
                 SELECT id, version, parent_version_id, params, universe, horizon_days, rules, requires_ai, change_reason, created_by, created_at
                   FROM strategy_versions WHERE strategy_id = s.id) v) AS versions
         FROM strategies s ORDER BY s.code`,
    );
    const assignments = await query(
      pool,
      `SELECT sa.portfolio_id, p.code AS portfolio_code, p.kind, sa.strategy_version_id, sa.assigned_at, sa.unassigned_at, sa.reason
         FROM strategy_assignments sa JOIN portfolios p ON p.id = sa.portfolio_id ORDER BY sa.assigned_at`,
    );
    const gates = await query(
      pool,
      `SELECT DISTINCT ON (portfolio_id, strategy_version_id) pe.*, p.code AS portfolio_code
         FROM promotion_evaluations pe JOIN portfolios p ON p.id = pe.portfolio_id ORDER BY portfolio_id, strategy_version_id, evaluated_at DESC`,
    );
    const backtests = await query(
      pool,
      `SELECT id, strategy_version_id, split, start_date, end_date, simulated_data, result_hash, created_at,
              result - 'equity' AS summary FROM backtest_runs ORDER BY created_at DESC LIMIT 50`,
    );
    const experiments = await query(pool, "SELECT * FROM strategy_experiments ORDER BY created_at DESC LIMIT 100");
    const versionWindows = await query(
      pool,
      `SELECT pd.portfolio_id, pd.strategy_version_id, MIN(pd.date)::text AS start, MAX(pd.date)::text AS end, COUNT(*)::int AS days,
              (array_agg(pd.value_usd ORDER BY pd.date))[1] AS start_value, (array_agg(pd.value_usd ORDER BY pd.date DESC))[1] AS end_value
         FROM performance_daily pd GROUP BY 1, 2`,
    );
    const lessons = await query(pool, "SELECT * FROM research_lessons ORDER BY updated_at DESC LIMIT 100");
    const forecastStats = await query(
      pool,
      `SELECT f.strategy_version_id, COUNT(*)::int AS forecasts, COUNT(o.id)::int AS matured,
              COUNT(*) FILTER (WHERE o.classification = 'THESIS_SUPPORTED')::int AS supported,
              COUNT(*) FILTER (WHERE o.classification = 'THESIS_CONTRADICTED')::int AS contradicted,
              AVG(o.excess_return_pct) AS avg_excess
         FROM forecast_snapshots f LEFT JOIN forecast_outcomes o ON o.forecast_id = f.id GROUP BY 1`,
    );
    return { strategies, assignments, gates, backtests, experiments, versionWindows, lessons, forecastStats, gatePolicy: DEFAULT_GATE };
  });

  app.get<{ Params: { id: string } }>("/api/backtests/:id", async (req) => {
    requireUser(req);
    const r = await maybeOne(pool, "SELECT * FROM backtest_runs WHERE id = $1", [req.params.id]);
    if (!r) throw new HttpError(404, "not found");
    return r;
  });

  app.get("/api/live", async (req) => {
    requireUser(req);
    const live = await maybeOne(pool, "SELECT * FROM portfolios WHERE kind = 'LIVE' LIMIT 1");
    if (!live) throw new HttpError(404, "live portfolio missing");
    const transitions = await query(pool, "SELECT * FROM live_state_transitions WHERE portfolio_id = $1 ORDER BY at DESC LIMIT 50", [live.id]);
    const policies = await query(pool, "SELECT * FROM live_policy_versions WHERE portfolio_id = $1 ORDER BY version DESC", [live.id]);
    const gates = await query(
      pool,
      `SELECT DISTINCT ON (pe.portfolio_id) pe.*, p.code AS portfolio_code, s.code AS strategy_code, v.version
         FROM promotion_evaluations pe JOIN portfolios p ON p.id = pe.portfolio_id
         JOIN strategy_versions v ON v.id = pe.strategy_version_id JOIN strategies s ON s.id = v.strategy_id
        ORDER BY pe.portfolio_id, pe.evaluated_at DESC`,
    );
    const broker = await maybeOne(pool, "SELECT provider, environment, key_env_var, status, last_sync_at, last_error FROM broker_connections WHERE portfolio_id = $1", [live.id]);
    const assignment = await maybeOne(
      pool,
      `SELECT s.code, s.name, v.version FROM strategy_assignments sa JOIN strategy_versions v ON v.id = sa.strategy_version_id
         JOIN strategies s ON s.id = v.strategy_id WHERE sa.portfolio_id = $1 AND sa.unassigned_at IS NULL`,
      [live.id],
    );
    return {
      portfolio: live,
      transitions,
      policies,
      gates,
      broker,
      assignment,
      allowedTransitions: (TRANSITIONS[live.status as keyof typeof TRANSITIONS] ?? []).filter((t) => t !== "ELIGIBLE"),
      liveTradingEnabled: config().LIVE_TRADING_ENABLED,
    };
  });

  app.get("/api/operations", async (req) => {
    requireUser(req);
    const c = config();
    return {
      integrations: integrationStatus(),
      heartbeats: await query(pool, "SELECT * FROM heartbeats ORDER BY component"),
      jobs: await query(pool, "SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 30"),
      cycles: await query(pool, "SELECT id, started_at, finished_at, status, market_open, notes FROM decision_cycles ORDER BY started_at DESC LIMIT 30"),
      incidents: await query(pool, "SELECT * FROM incidents ORDER BY resolved_at IS NULL DESC, opened_at DESC LIMIT 50"),
      notifications: await query(pool, "SELECT id, kind, severity, subject, status, attempts, last_error, created_at, sent_at FROM notifications ORDER BY created_at DESC LIMIT 50"),
      notificationQueue: await query(pool, "SELECT status, COUNT(*)::int AS n FROM notifications GROUP BY status"),
      batches: await query(pool, "SELECT id, provider, feed, as_of, ingested_at, status, simulated, stats->'missing' AS missing, stats->'stale' AS stale FROM market_data_batches ORDER BY ingested_at DESC LIMIT 20"),
      brokers: await query(pool, "SELECT b.*, p.code FROM broker_connections b LEFT JOIN portfolios p ON p.id = b.portfolio_id"),
      costs: await query(pool, "SELECT category, provider, model, SUM(amount_ils) AS ils, SUM(amount_usd) AS usd, COUNT(*)::int AS n FROM cost_ledger WHERE occurred_at >= date_trunc('month', now()) GROUP BY 1, 2, 3"),
      budget: await budgetStatus(pool, { aiBudgetIls: c.AI_MONTHLY_BUDGET_ILS, opsCapIls: c.OPS_MONTHLY_CAP_ILS, infraEstimateIls: c.INFRA_MONTHLY_ESTIMATE_ILS }),
      riskModel: { scenarios: SCENARIOS, costs: DEFAULT_COSTS, riskReference: "INITIAL_CAPITAL_USD (provisional — pending owner decision)" },
    };
  });

  app.get("/api/assets", async (req) => {
    requireUser(req);
    return query(pool, "SELECT * FROM assets ORDER BY market, symbol");
  });

  app.get("/api/audit", async (req) => {
    requireUser(req);
    return query(pool, "SELECT * FROM audit_events ORDER BY at DESC LIMIT 200");
  });
}
