import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { query, maybeOne, withAdvisoryLock, LOCKS } from "../../db/pool.js";
import { HttpError, requireMfa, requireOwner } from "../auth.js";
import { audit } from "../../ops/audit.js";
import { getKillSwitch, setState } from "../../ops/systemState.js";
import { enqueueNotification } from "../../notify/outbox.js";
import { pausePortfolio, resumePortfolio } from "../../portfolio/control.js";
import { assignStrategy, createStrategyVersion, getStrategyVersion } from "../../strategies/registry.js";
import { signLivePolicy } from "../../live/policy.js";
import { liveReadiness, transitionLive, type LiveStatus } from "../../live/stateMachine.js";
import { runCycle } from "../../engine/cycle.js";
import { runStoredBacktest } from "../../backtest/service.js";
import { cycleDepsFromConfig } from "../../app/deps.js";
import type { PortfolioRow } from "../../portfolio/state.js";

const Totp = z.string().regex(/^\d{6}$/).optional();

export function registerActionRoutes(app: FastifyInstance, pool: pg.Pool) {
  // ---------------------------------------------------------------- kill switch
  app.post("/api/control/kill-switch", async (req) => {
    const body = z.object({ active: z.boolean(), reason: z.string().min(3), totp: Totp }).parse(req.body);
    // Engaging is always allowed (emergency); releasing requires 2FA.
    const u = body.active ? requireOwner(req) : requireMfa(req, body.totp);
    const before = await getKillSwitch(pool);
    await setState(pool, "kill_switch", { active: body.active, reason: body.reason, by: u.email, at: new Date().toISOString() }, u.email);
    await audit(pool, u.email, body.active ? "kill_switch.engage" : "kill_switch.release", null, { reason: body.reason, before }, req.ip);
    await enqueueNotification(pool, {
      dedupeKey: `kill-switch:${body.active}:${Date.now()}`,
      kind: "kill_switch",
      severity: "CRITICAL",
      subject: body.active ? "עצירת חירום הופעלה — אין פקודות חדשות" : "עצירת החירום שוחררה",
      body: `${body.reason}\nעל ידי ${u.email}. פוזיציות קיימות לא נסגרו אוטומטית.`,
    });
    return { ok: true };
  });

  // --------------------------------------------------------- portfolio control
  app.post<{ Params: { id: string } }>("/api/portfolios/:id/pause", async (req) => {
    const u = requireOwner(req);
    const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);
    await pausePortfolio(pool, req.params.id, reason, u.email, `manual-pause:${req.params.id}:${Date.now()}`);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/portfolios/:id/resume", async (req) => {
    const body = z.object({ reason: z.string().min(3), totp: Totp }).parse(req.body);
    const p = await maybeOne<PortfolioRow>(pool, "SELECT * FROM portfolios WHERE id = $1", [req.params.id]);
    if (!p) throw new HttpError(404, "not found");
    const u = p.kind === "LIVE" ? requireMfa(req, body.totp) : requireOwner(req);
    const status = await resumePortfolio(pool, p.id, u.email, body.reason, p.kind === "LIVE");
    return { ok: true, status };
  });

  app.post<{ Params: { id: string } }>("/api/portfolios/:id/assign", async (req) => {
    const u = requireOwner(req);
    const body = z.object({ strategyVersionId: z.string().uuid(), reason: z.string().min(3) }).parse(req.body);
    const p = await maybeOne<PortfolioRow>(pool, "SELECT * FROM portfolios WHERE id = $1", [req.params.id]);
    if (!p) throw new HttpError(404, "not found");
    if (p.kind !== "PAPER") throw new HttpError(400, "only paper portfolios can be re-assigned here (live follows the promotion flow)");
    const v = await getStrategyVersion(pool, body.strategyVersionId);
    if (v.code === "BENCHMARK_HOLD") throw new HttpError(400, "benchmark strategy is not a candidate");
    await assignStrategy(pool, p.id, v.id, body.reason, u.email);
    await audit(pool, u.email, "strategy.assign", p.id, { version: v.id, code: v.code, v: v.version, reason: body.reason }, req.ip);
    await enqueueNotification(pool, {
      dedupeKey: `assign:${p.id}:${v.id}:${Date.now()}`,
      kind: "strategy.change",
      subject: `שינוי אסטרטגיה: ${p.name} → ${v.code} v${v.version}`,
      body: `${body.reason}\nההון וההיסטוריה של התיק נשמרים; הביצועים נמדדים גם לפי חלון הגרסה.`,
    });
    return { ok: true };
  });

  // ------------------------------------------------------ strategies & research
  app.post<{ Params: { code: string } }>("/api/strategies/:code/versions", async (req) => {
    const u = requireOwner(req);
    const body = z
      .object({ params: z.record(z.string(), z.unknown()), reason: z.string().min(5), universe: z.array(z.string()).optional(), supportingData: z.record(z.string(), z.unknown()).optional() })
      .parse(req.body);
    const v = await createStrategyVersion(pool, { code: req.params.code, params: body.params, universe: body.universe, reason: body.reason, supportingData: body.supportingData, by: u.email });
    await audit(pool, u.email, "strategy.version.create", v.id, { code: v.code, version: v.version, reason: body.reason }, req.ip);
    return v;
  });

  app.post("/api/experiments", async (req) => {
    const u = requireOwner(req);
    const body = z
      .object({ strategyVersionId: z.string().uuid(), hypothesis: z.string().min(10), successCriteria: z.record(z.string(), z.unknown()), dataRange: z.record(z.string(), z.unknown()).optional(), leakageNotes: z.string().optional() })
      .parse(req.body);
    const row = await maybeOne(
      pool,
      `INSERT INTO strategy_experiments (strategy_version_id, hypothesis, success_criteria, data_range, leakage_notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [body.strategyVersionId, body.hypothesis, JSON.stringify(body.successCriteria), JSON.stringify(body.dataRange ?? {}), body.leakageNotes ?? null, u.email],
    );
    return row;
  });

  app.patch<{ Params: { id: string } }>("/api/experiments/:id", async (req) => {
    requireOwner(req);
    const body = z.object({ status: z.enum(["PROPOSED", "TESTING", "PASSED", "FAILED", "ABANDONED"]), results: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    await query(pool, "UPDATE strategy_experiments SET status = $2, results = COALESCE($3, results), updated_at = now() WHERE id = $1", [
      req.params.id,
      body.status,
      body.results ? JSON.stringify(body.results) : null,
    ]);
    return { ok: true };
  });

  app.post("/api/backtests", async (req) => {
    requireOwner(req);
    const body = z
      .object({
        strategyVersionId: z.string().uuid(),
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        split: z.enum(["DEV", "TEST", "FULL"]),
        experimentId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const deps = cycleDepsFromConfig(pool);
    try {
      const { id, result } = await runStoredBacktest(pool, deps.market, body);
      const { equity, ...summary } = result;
      return { id, summary, points: equity.length };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post("/api/lessons", async (req) => {
    const u = requireOwner(req);
    const body = z
      .object({
        text: z.string().min(10),
        tags: z.array(z.string()).default([]),
        supportingDecisionIds: z.array(z.string().uuid()).default([]),
        contradictingDecisionIds: z.array(z.string().uuid()).default([]),
        validityConditions: z.string().optional(),
      })
      .parse(req.body);
    return maybeOne(
      pool,
      `INSERT INTO research_lessons (text, tags, supporting_decision_ids, contradicting_decision_ids, sample_size, validity_conditions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [body.text, body.tags, body.supportingDecisionIds, body.contradictingDecisionIds, body.supportingDecisionIds.length + body.contradictingDecisionIds.length, body.validityConditions ?? null, u.email],
    );
  });

  app.patch<{ Params: { id: string } }>("/api/lessons/:id", async (req) => {
    const u = requireOwner(req);
    const { status } = z.object({ status: z.enum(["CANDIDATE", "APPROVED", "RETIRED"]) }).parse(req.body);
    await query(pool, "UPDATE research_lessons SET status = $2, updated_at = now() WHERE id = $1", [req.params.id, status]);
    await audit(pool, u.email, "lesson.status", req.params.id, { status }, req.ip);
    return { ok: true };
  });

  // --------------------------------------------------------------- assets
  app.patch<{ Params: { id: string } }>("/api/assets/:id", async (req) => {
    const body = z
      .object({ verified: z.boolean(), is_leveraged: z.boolean(), is_inverse: z.boolean(), crypto_exposure: z.boolean(), active: z.boolean(), source: z.string().min(3), totp: Totp })
      .parse(req.body);
    const u = requireMfa(req, body.totp);
    await query(
      pool,
      `UPDATE assets SET verified = $2, is_leveraged = $3, is_inverse = $4, crypto_exposure = $5, active = $6, verified_source = $7, verified_at = now() WHERE id = $1`,
      [req.params.id, body.verified, body.is_leveraged, body.is_inverse, body.crypto_exposure, body.active, `${body.source} (by ${u.email})`],
    );
    await audit(pool, u.email, "asset.classification", req.params.id, body, req.ip);
    return { ok: true };
  });

  // ---------------------------------------------------------------- live
  app.post("/api/live/policy", async (req) => {
    const body = z
      .object({
        maxCapitalUsd: z.number(),
        pilotFraction: z.number(),
        allowedSymbols: z.array(z.string()),
        maxPositionPct: z.number(),
        maxOrderUsd: z.number(),
        riskBudgetPct: z.number(),
        strategySwitchPolicy: z.enum(["MANUAL", "AUTO_WITHIN_GATE"]),
        autoPromote: z.boolean(),
        notes: z.string().optional(),
        totp: Totp,
      })
      .parse(req.body);
    const u = requireMfa(req, body.totp);
    const live = await maybeOne<{ id: string }>(pool, "SELECT id FROM portfolios WHERE kind = 'LIVE' LIMIT 1");
    try {
      const { totp: _t, ...policy } = body;
      const row = await signLivePolicy(pool, live!.id, policy, u.email, true);
      await audit(pool, u.email, "live.policy.sign", live!.id, { version: row.version, ...policy }, req.ip);
      return row;
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.post("/api/live/readiness", async (req) => {
    requireOwner(req);
    const live = await maybeOne<PortfolioRow>(pool, "SELECT * FROM portfolios WHERE kind = 'LIVE' LIMIT 1");
    const deps = cycleDepsFromConfig(pool);
    const { broker } = deps.brokers({ ...live!, status: "PILOT" });
    return liveReadiness(pool, live!.id, broker);
  });

  app.post("/api/live/transition", async (req) => {
    const body = z
      .object({ to: z.enum(["DORMANT", "ELIGIBLE", "ARMED", "PILOT", "ACTIVE", "PAUSED"]), reason: z.string().min(3), totp: Totp, strategyVersionId: z.string().uuid().optional() })
      .parse(req.body);
    const u = body.to === "DORMANT" || body.to === "PAUSED" ? requireOwner(req) : requireMfa(req, body.totp);
    const live = await maybeOne<PortfolioRow>(pool, "SELECT * FROM portfolios WHERE kind = 'LIVE' LIMIT 1");
    try {
      if (body.to === "PAUSED") {
        await pausePortfolio(pool, live!.id, body.reason, u.email, `live-manual-pause:${Date.now()}`);
        return { ok: true };
      }
      const deps = cycleDepsFromConfig(pool);
      const { broker } = deps.brokers({ ...live!, status: "PILOT" });
      const readiness = await liveReadiness(pool, live!.id, broker);
      await transitionLive(pool, { portfolioId: live!.id, to: body.to as LiveStatus, actor: u.email, reason: body.reason, mfaVerified: true, readiness, strategyVersionId: body.strategyVersionId });
      return { ok: true, readiness };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  // ------------------------------------------------------------ operations
  app.post<{ Params: { id: string } }>("/api/incidents/:id/resolve", async (req) => {
    const u = requireOwner(req);
    await query(pool, "UPDATE incidents SET resolved_at = now(), resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL", [req.params.id, u.email]);
    await audit(pool, u.email, "incident.resolve", req.params.id, {}, req.ip);
    return { ok: true };
  });

  app.post("/api/operations/run-cycle", async (req) => {
    const u = requireOwner(req);
    const deps = cycleDepsFromConfig(pool);
    const result = await withAdvisoryLock(LOCKS.DECISION_CYCLE, () => runCycle(deps));
    if (!result) throw new HttpError(409, "a cycle is already running");
    await audit(pool, u.email, "cycle.manual", result.cycleId, { ...result }, req.ip);
    return result;
  });
}
