import type pg from "pg";
import { query, maybeOne, type Db } from "../db/pool.js";
import { D, Decimal, floorQty } from "../lib/money.js";
import { errMsg, log } from "../lib/logger.js";
import { loadAssets, type AssetRow } from "../assets/universe.js";
import type { FxProvider, MarketDataProvider, MarketSnapshot } from "../market/types.js";
import { midPrice } from "../market/types.js";
import { buildSnapshot } from "../market/service.js";
import { computeAllRiskStats, type RiskStats } from "../risk/stats.js";
import { checkOrder, executionPrice, type OrderProposal } from "../risk/engine.js";
import type { RiskPolicy } from "../risk/policy.js";
import { listPortfolios, loadState, valuate, type PortfolioRow, type PortfolioState } from "../portfolio/state.js";
import { STRATEGIES, activeStrategyVersion } from "../strategies/registry.js";
import type { AiCandidate, StrategyVersionRow } from "../strategies/types.js";
import { diffToTrades, type TradeIntent } from "./sizing.js";
import type { Broker } from "../broker/types.js";
import type { BrokerFactory } from "../broker/factory.js";
import { placeOrder, reconcileOrders, reconcilePositions } from "../execution/orders.js";
import { tradingBlockers } from "../ops/systemState.js";
import { openIncident, resolveIncidents } from "../ops/incidents.js";
import { recordPerformance } from "../performance/daily.js";
import { recordForecast } from "../learning/forecasts.js";
import { latestLivePolicy, riskPolicyFor } from "../live/policy.js";
import { runManager, type ManagerDeps } from "../ai/manager.js";
import { enqueueNotification } from "../notify/outbox.js";
import { config } from "../config.js";

export interface CycleDeps {
  pool: pg.Pool;
  market: MarketDataProvider;
  fx: FxProvider;
  brokers: BrokerFactory;
  ai: ManagerDeps;
  maxQuoteAgeMinutes: number;
  /** Max AI manager calls per cycle across all portfolios (cost control). */
  maxAiCallsPerCycle: number;
}

export interface CycleResult {
  cycleId: string;
  status: "OK" | "SKIPPED" | "FAILED";
  marketOpen: boolean;
  decisions: number;
  orders: number;
  notes: string[];
}

const TRADEABLE_STATUS: Record<PortfolioRow["kind"], string[]> = {
  PAPER: ["ACTIVE"],
  BENCHMARK: ["ACTIVE"],
  LIVE: ["PILOT", "ACTIVE"],
};

async function insertDecision(
  db: Db,
  d: {
    cycleId: string;
    portfolioId: string;
    strategyVersionId: string | null;
    action: "BUY" | "SELL" | "HOLD" | "REBALANCE";
    status: string;
    dataAsOf: Date;
    rationale: string;
    evidence: Record<string, unknown>;
    aiOutput?: unknown;
    modelVersion?: string | null;
    promptVersionId?: string | null;
    policyVersion: string;
    validUntil?: Date | null;
  },
): Promise<string> {
  const row = await maybeOne<{ id: string }>(
    db,
    `INSERT INTO decisions (cycle_id, portfolio_id, strategy_version_id, action, status, data_as_of, rationale, evidence, ai_output,
        model_version, prompt_version_id, policy_version, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      d.cycleId,
      d.portfolioId,
      d.strategyVersionId,
      d.action,
      d.status,
      d.dataAsOf,
      d.rationale,
      JSON.stringify(d.evidence),
      d.aiOutput === undefined ? null : JSON.stringify(d.aiOutput),
      d.modelVersion ?? null,
      d.promptVersionId ?? null,
      d.policyVersion,
      d.validUntil ?? null,
    ],
  );
  return row!.id;
}

async function setDecisionStatus(db: Db, id: string, status: string) {
  await query(db, "UPDATE decisions SET status = $2 WHERE id = $1", [id, status]);
}

interface PortfolioCtx {
  portfolio: PortfolioRow;
  broker?: Broker;
  brokerIssue?: string;
  version: StrategyVersionRow;
  policy: RiskPolicy;
  blockers: string[];
}

/** Runs trades through the risk gate and the broker. Returns the resulting decision status. */
async function executeTrades(
  deps: CycleDeps,
  ctx: PortfolioCtx,
  decisionId: string,
  trades: (TradeIntent & { orderType?: "MARKET" | "LIMIT"; limitPrice?: number; addToLoserJustification?: string; source: OrderProposal["source"] })[],
  snapshot: MarketSnapshot,
  assets: Map<string, AssetRow>,
  stats: Map<string, RiskStats>,
): Promise<{ status: string; orders: number }> {
  const { pool } = deps;
  let placed = 0;
  let rejected = 0;
  let filled = 0;
  for (const t of trades) {
    // Reload state before every order: earlier fills change cash and holdings.
    const state = await loadState(pool, ctx.portfolio.id);
    const proposal: OrderProposal = {
      symbol: t.symbol,
      side: t.side,
      qty: t.qty,
      orderType: t.orderType ?? "MARKET",
      limitPrice: t.limitPrice,
      addToLoserJustification: t.addToLoserJustification,
      source: t.source,
    };
    const blockers = [...ctx.blockers];
    if (!ctx.broker) blockers.push(`BROKER_UNAVAILABLE: ${ctx.brokerIssue ?? "unknown"}`);
    const risk = checkOrder({ state, snapshot, assets, stats, policy: ctx.policy, blockers }, proposal);
    await query(pool, "INSERT INTO risk_checks (decision_id, proposal, result, reasons, metrics, policy_version) VALUES ($1,$2,$3,$4,$5,$6)", [
      decisionId,
      JSON.stringify({ ...proposal, qty: proposal.qty.toFixed(8) }),
      risk.result,
      JSON.stringify(risk.reasons),
      JSON.stringify(risk.metrics),
      ctx.policy.version,
    ]);
    if (risk.result === "REJECT" || !ctx.broker) {
      rejected++;
      continue;
    }
    const asset = assets.get(t.symbol)!;
    const order = await placeOrder(pool, ctx.broker, {
      portfolioId: ctx.portfolio.id,
      portfolioCode: ctx.portfolio.code,
      decisionId,
      assetId: asset.id,
      symbol: t.symbol,
      side: t.side,
      qty: risk.approvedQty,
      orderType: proposal.orderType,
      limitPrice: proposal.limitPrice,
      estPrice: risk.estPrice,
      reservedCash: risk.reservedCash,
      venue: ctx.broker.venue,
    });
    placed++;
    if (order.status === "FILLED") filled++;
    if (order.status === "UNKNOWN") {
      // Uncertain broker state: the portfolio is paused; stop sending further orders this cycle.
      ctx.blockers.push("BROKER_STATE_UNKNOWN");
    }
  }
  const status =
    placed === 0 ? (rejected > 0 ? "REJECTED" : "NO_ACTION") : filled === placed && rejected === 0 ? "EXECUTED" : filled > 0 || rejected > 0 ? "PARTIAL" : "APPROVED";
  return { status, orders: placed };
}

async function lastTradeAt(db: Db, portfolioId: string): Promise<Date | null> {
  const r = await maybeOne<{ at: Date | null }>(
    db,
    "SELECT MAX(f.occurred_at) AS at FROM fills f JOIN orders o ON o.id = f.order_id WHERE o.portfolio_id = $1",
    [portfolioId],
  );
  return r?.at ?? null;
}

async function recentAiDecision(db: Db, portfolioId: string, symbol: string, days: number, asOf: Date): Promise<{ price: number | null } | undefined> {
  return maybeOne(
    db,
    `SELECT (evidence->>'price')::numeric AS price FROM decisions
      WHERE portfolio_id = $1 AND evidence->>'symbol' = $2 AND evidence->>'kind' = 'AI_MANAGER' AND status <> 'DEFERRED'
        AND data_as_of > $4::timestamptz - ($3 || ' days')::interval AND data_as_of <= $4
      ORDER BY data_as_of DESC LIMIT 1`,
    [portfolioId, symbol, String(days), asOf],
  );
}

async function handleAiCandidate(
  deps: CycleDeps,
  ctx: PortfolioCtx,
  cycleId: string,
  cand: AiCandidate,
  snapshot: MarketSnapshot,
  assets: Map<string, AssetRow>,
  stats: Map<string, RiskStats>,
  otherPortfolios: { code: string; holdings: string[] }[],
): Promise<{ decisions: number; orders: number; aiCalled: boolean }> {
  const { pool } = deps;
  const asset = assets.get(cand.symbol);
  const q = snapshot.quotes.get(cand.symbol);
  if (!asset || !q) return { decisions: 0, orders: 0, aiCalled: false };
  const price = midPrice(q);
  const p = ctx.version.params as { reviewEveryDays: number; marginOfSafety: number; maxWeightPerPosition: number };
  const recent = await recentAiDecision(pool, ctx.portfolio.id, cand.symbol, cand.mode === "REVIEW" ? p.reviewEveryDays : 5, snapshot.asOf);
  if (recent && (!recent.price || Math.abs(price / Number(recent.price) - 1) < 0.05)) return { decisions: 0, orders: 0, aiCalled: false };

  const state = await loadState(pool, ctx.portfolio.id);
  const valuation = valuate(state, snapshot);
  const res = await runManager(pool, deps.ai, {
    candidate: cand,
    asset,
    snapshot,
    state,
    valuation,
    stats,
    version: ctx.version,
    policy: ctx.policy,
    otherPortfolios,
  });
  const evidence: Record<string, unknown> = {
    kind: "AI_MANAGER",
    symbol: cand.symbol,
    mode: cand.mode,
    price,
    screen: cand.screen,
    sources: res.sources,
    costIls: res.costIls,
    managerStatus: res.status,
    managerReason: res.reason,
  };
  const common = {
    cycleId,
    portfolioId: ctx.portfolio.id,
    strategyVersionId: ctx.version.id,
    dataAsOf: snapshot.asOf,
    aiOutput: res.decision ?? res.raw ?? null,
    modelVersion: res.model ?? null,
    promptVersionId: res.promptVersionId ?? null,
    policyVersion: ctx.policy.version,
  };
  if (res.status === "DEFERRED" || !res.decision) {
    await insertDecision(pool, { ...common, action: "HOLD", status: "DEFERRED", rationale: `Deferred: ${res.reason}`, evidence });
    return { decisions: 1, orders: 0, aiCalled: res.costIls > 0 };
  }
  const d = res.decision;
  const validUntil = new Date(snapshot.asOf.getTime() + d.valid_for_minutes * 60_000);
  const pos = state.positions.get(cand.symbol);
  const benchmark = snapshot.quotes.get("SPY");
  let action: "BUY" | "SELL" | "HOLD" = d.action;
  const codeNotes: string[] = [];
  // Code rule: price at/above the model's high value is "expensive" → sell holdings regardless of the verbal call.
  if (pos && price >= d.valuation.per_share_high && action !== "SELL") {
    action = "SELL";
    codeNotes.push(`price ${price.toFixed(2)} ≥ valuation high ${d.valuation.per_share_high} → sell rule`);
  }
  const decisionId = await insertDecision(pool, {
    ...common,
    action,
    status: "PROPOSED",
    rationale: [d.thesis, ...codeNotes].join(" | "),
    evidence: { ...evidence, codeNotes },
    validUntil,
  });
  await recordForecast(pool, {
    decisionId,
    portfolioId: ctx.portfolio.id,
    assetId: asset.id,
    strategyVersionId: ctx.version.id,
    modelVersion: res.model,
    promptVersionId: res.promptVersionId,
    horizonDays: d.horizon_days,
    priceAtForecast: price,
    benchmarkAtForecast: benchmark ? midPrice(benchmark) : null,
    ai: d,
    sources: res.sources,
    dataAsOf: snapshot.asOf,
  });

  if (action === "HOLD") {
    await setDecisionStatus(pool, decisionId, "NO_ACTION");
    return { decisions: 1, orders: 0, aiCalled: true };
  }
  const trades: Parameters<typeof executeTrades>[3] = [];
  if (action === "SELL") {
    if (!pos) {
      await setDecisionStatus(pool, decisionId, "NO_ACTION");
      return { decisions: 1, orders: 0, aiCalled: true };
    }
    const targetPct = Math.min(d.target_exposure_pct / 100, p.maxWeightPerPosition);
    const targetValue = valuation.total.times(targetPct);
    const bid = executionPrice(snapshot, cand.symbol, "SELL") ?? price;
    const currentValue = pos.qty.times(bid);
    const qty = targetPct <= 0.001 ? pos.qty : floorQty(currentValue.minus(targetValue).div(bid), asset.fractionable ? 6 : 0);
    if (qty.gt(0)) trades.push({ symbol: cand.symbol, side: "SELL", qty, price: bid, targetWeight: targetPct, currentWeight: 0, source: "AI_DECISION" });
  } else {
    // BUY: margin of safety computed in code from the model's base value, and never above its max price.
    const ask = executionPrice(snapshot, cand.symbol, "BUY") ?? price;
    const limit = Math.min(d.max_buy_price ?? 0, d.valuation.per_share_base * (1 - p.marginOfSafety));
    if (!(limit > 0) || ask > limit) {
      await query(pool, "UPDATE decisions SET status = 'NO_ACTION', rationale = rationale || $2 WHERE id = $1", [
        decisionId,
        ` | code: ask ${ask.toFixed(2)} above margin-of-safety limit ${limit.toFixed(2)} (base ${d.valuation.per_share_base} × (1 − ${p.marginOfSafety}))`,
      ]);
      return { decisions: 1, orders: 0, aiCalled: true };
    }
    const targetPct = Math.min(d.target_exposure_pct / 100, p.maxWeightPerPosition);
    const current = pos ? pos.qty.times(ask) : D(0);
    const want = valuation.total.times(targetPct).minus(current);
    const qty = floorQty(Decimal.max(want, 0).div(limit), asset.fractionable ? 6 : 0);
    if (qty.gt(0))
      trades.push({
        symbol: cand.symbol,
        side: "BUY",
        qty,
        price: ask,
        targetWeight: targetPct,
        currentWeight: 0,
        orderType: "LIMIT",
        limitPrice: Number(limit.toFixed(2)),
        addToLoserJustification: d.add_to_losing_position_reason ?? undefined,
        source: "AI_DECISION",
      });
  }
  if (trades.length === 0) {
    await setDecisionStatus(pool, decisionId, "NO_ACTION");
    return { decisions: 1, orders: 0, aiCalled: true };
  }
  const r = await executeTrades(deps, ctx, decisionId, trades, snapshot, assets, stats);
  await setDecisionStatus(pool, decisionId, r.status);
  return { decisions: 1, orders: r.orders, aiCalled: true };
}

/**
 * One decision cycle for all portfolios: fresh snapshot → reconcile → strategy →
 * (AI) → hard risk gate → broker → ledger → performance. HOLD is a valid outcome.
 */
export async function runCycle(deps: CycleDeps, now: Date = new Date()): Promise<CycleResult> {
  const { pool } = deps;
  const cycle = await maybeOne<{ id: string }>(pool, "INSERT INTO decision_cycles DEFAULT VALUES RETURNING id");
  const cycleId = cycle!.id;
  const notes: string[] = [];
  let decisions = 0;
  let orders = 0;
  try {
    const assetsMap = await loadAssets(pool);
    const assets = [...assetsMap.values()].filter((a) => a.active);
    let snapshot: MarketSnapshot;
    try {
      snapshot = await buildSnapshot(pool, { provider: deps.market, fx: deps.fx, maxQuoteAgeMinutes: deps.maxQuoteAgeMinutes }, assets, now);
    } catch (err) {
      await openIncident(pool, { severity: "WARNING", kind: "DATA_FEED", message: `market data unavailable: ${errMsg(err)}`, dedupeKey: "data-feed" });
      await query(pool, "UPDATE decision_cycles SET status = 'SKIPPED', finished_at = now(), notes = $2 WHERE id = $1", [cycleId, JSON.stringify({ error: errMsg(err) })]);
      return { cycleId, status: "SKIPPED", marketOpen: false, decisions, orders, notes: [`data failure: ${errMsg(err)}`] };
    }
    await query(pool, "UPDATE decision_cycles SET batch_id = $2, market_open = $3 WHERE id = $1", [cycleId, snapshot.batchId, snapshot.clock.isOpen]);
    const dataOk = snapshot.missingSymbols.length < assets.length && snapshot.quotes.size > 0;
    if (!dataOk) {
      await openIncident(pool, { severity: "WARNING", kind: "DATA_FEED", message: "no usable quotes in this cycle", dedupeKey: "data-feed" });
      notes.push("no usable quotes");
    } else await resolveIncidents(pool, "data-feed", "system");
    if (snapshot.staleSymbols.length) notes.push(`stale: ${snapshot.staleSymbols.join(",")}`);

    const stats = computeAllRiskStats(snapshot.bars);
    const systemBlockers = await tradingBlockers(pool);
    const portfolios = await listPortfolios(pool);
    const holdingsByPortfolio = new Map<string, string[]>();
    for (const p of portfolios) holdingsByPortfolio.set(p.code, [...(await loadState(pool, p.id)).positions.keys()]);
    let aiCalls = 0;

    for (const portfolio of portfolios) {
      try {
        const version = await activeStrategyVersion(pool, portfolio.id);
        if (!version) {
          notes.push(`${portfolio.code}: no strategy assigned`);
          continue;
        }
        const strategy = STRATEGIES[version.code];
        if (!strategy) {
          notes.push(`${portfolio.code}: unknown strategy ${version.code}`);
          continue;
        }
        const live = portfolio.kind === "LIVE" ? await latestLivePolicy(pool, portfolio.id) : undefined;
        const policy = riskPolicyFor(portfolio, live);
        const tradeable = TRADEABLE_STATUS[portfolio.kind].includes(portfolio.status);
        const { broker, reason } = tradeable ? deps.brokers(portfolio) : { broker: undefined, reason: `status ${portfolio.status}` };
        const blockers = [...systemBlockers];
        if (portfolio.kind === "LIVE") {
          if (!config().LIVE_TRADING_ENABLED) blockers.push("LIVE_TRADING_ENABLED=false");
          if (!live) blockers.push("no signed live policy");
        }
        const ctx: PortfolioCtx = { portfolio, broker, brokerIssue: reason, version, policy, blockers };

        if (broker) {
          broker.setMarket?.(snapshot);
          await reconcileOrders(pool, broker, portfolio.id);
          if (broker.venue !== "INTERNAL_SIM" && snapshot.clock.isOpen) await reconcilePositions(pool, broker, portfolio.id);
        }
        // Re-read status: reconciliation may have paused the portfolio.
        const fresh = await maybeOne<{ status: string }>(pool, "SELECT status FROM portfolios WHERE id = $1", [portfolio.id]);
        const state = await loadState(pool, portfolio.id);
        const valuation = valuate(state, snapshot);
        if (!tradeable || !TRADEABLE_STATUS[portfolio.kind].includes(fresh!.status)) {
          await recordPerformance(pool, state, valuation, snapshot, version.id);
          continue;
        }

        const out = strategy.evaluate({ snapshot, state, valuation, assets: assetsMap, stats, version, lastTradeAt: await lastTradeAt(pool, portfolio.id) });
        for (const s of out.signals) {
          await query(
            pool,
            "INSERT INTO signals (cycle_id, portfolio_id, strategy_version_id, asset_id, kind, value, payload, data_as_of) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [cycleId, portfolio.id, version.id, s.symbol ? assetsMap.get(s.symbol)?.id ?? null : null, s.kind, s.value ?? null, JSON.stringify(s.payload ?? {}), snapshot.asOf],
          );
        }

        if (out.targets) {
          const trades = diffToTrades(out.targets, state, valuation, snapshot, assetsMap, { minTradeUsd: policy.minOrderUsd, minTradePctOfValue: 0.02 });
          const decisionId = await insertDecision(pool, {
            cycleId,
            portfolioId: portfolio.id,
            strategyVersionId: version.id,
            action: trades.length ? "REBALANCE" : "HOLD",
            status: "PROPOSED",
            dataAsOf: snapshot.asOf,
            rationale: out.rationale,
            evidence: { ...out.evidence, targets: Object.fromEntries(out.targets), trades: trades.map((t) => ({ ...t, qty: t.qty.toFixed(8) })) },
            policyVersion: policy.version,
          });
          decisions++;
          const benchmark = snapshot.quotes.get("SPY");
          for (const t of trades) {
            const q = snapshot.quotes.get(t.symbol);
            await recordForecast(pool, {
              decisionId,
              portfolioId: portfolio.id,
              assetId: assetsMap.get(t.symbol)?.id ?? null,
              strategyVersionId: version.id,
              horizonDays: version.horizon_days,
              priceAtForecast: q ? midPrice(q) : null,
              benchmarkAtForecast: benchmark ? midPrice(benchmark) : null,
              dataAsOf: snapshot.asOf,
            });
          }
          if (trades.length === 0) await setDecisionStatus(pool, decisionId, "NO_ACTION");
          else {
            const r = await executeTrades(
              deps,
              ctx,
              decisionId,
              trades.map((t) => ({
                ...t,
                source: out.rebalanceByDesign ? "REBALANCE" : "STRATEGY_TARGET",
                addToLoserJustification: out.rebalanceByDesign ? "pre-approved rebalancing policy of this strategy version" : undefined,
              })),
              snapshot,
              assetsMap,
              stats,
            );
            orders += r.orders;
            await setDecisionStatus(pool, decisionId, r.status);
          }
        } else if (!out.aiCandidates?.length) {
          await insertDecision(pool, {
            cycleId,
            portfolioId: portfolio.id,
            strategyVersionId: version.id,
            action: "HOLD",
            status: "NO_ACTION",
            dataAsOf: snapshot.asOf,
            rationale: out.rationale,
            evidence: out.evidence,
            policyVersion: policy.version,
          });
          decisions++;
        }

        let aiDecisions = 0;
        for (const cand of out.aiCandidates ?? []) {
          if (!snapshot.clock.isOpen) break; // research spend only when a decision could be acted on
          if (aiCalls >= deps.maxAiCallsPerCycle) {
            notes.push("AI call limit reached for this cycle");
            break;
          }
          const others = [...holdingsByPortfolio].filter(([c]) => c !== portfolio.code).map(([code, holdings]) => ({ code, holdings }));
          const r = await handleAiCandidate(deps, ctx, cycleId, cand, snapshot, assetsMap, stats, others);
          decisions += r.decisions;
          aiDecisions += r.decisions;
          orders += r.orders;
          if (r.aiCalled) aiCalls++;
        }
        if (out.aiCandidates && aiDecisions === 0) {
          await insertDecision(pool, {
            cycleId,
            portfolioId: portfolio.id,
            strategyVersionId: version.id,
            action: "HOLD",
            status: "NO_ACTION",
            dataAsOf: snapshot.asOf,
            rationale: out.aiCandidates.length ? `${out.rationale}; no AI review due this cycle (recent review or market closed)` : out.rationale,
            evidence: { ...out.evidence, candidates: out.aiCandidates },
            policyVersion: policy.version,
          });
          decisions++;
        }
        const after = await loadState(pool, portfolio.id);
        await recordPerformance(pool, after, valuate(after, snapshot), snapshot, version.id);
      } catch (err) {
        log.error("portfolio cycle failed", { portfolio: portfolio.code, error: errMsg(err) });
        notes.push(`${portfolio.code}: ${errMsg(err)}`);
        await openIncident(pool, {
          severity: "WARNING",
          kind: "CYCLE_ERROR",
          message: `cycle failed for ${portfolio.code}: ${errMsg(err)}`,
          portfolioId: portfolio.id,
          dedupeKey: `cycle-error:${portfolio.id}`,
        });
      }
    }
    await query(pool, "UPDATE decision_cycles SET status = 'OK', finished_at = now(), notes = $2 WHERE id = $1", [cycleId, JSON.stringify({ notes })]);
    return { cycleId, status: "OK", marketOpen: snapshot.clock.isOpen, decisions, orders, notes };
  } catch (err) {
    await query(pool, "UPDATE decision_cycles SET status = 'FAILED', finished_at = now(), notes = $2 WHERE id = $1", [cycleId, JSON.stringify({ error: errMsg(err) })]);
    await enqueueNotification(pool, {
      dedupeKey: `cycle-failed:${cycleId}`,
      kind: "cycle.failed",
      severity: "CRITICAL",
      subject: "מחזור החלטה נכשל",
      body: errMsg(err),
    });
    throw err;
  }
}
