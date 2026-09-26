import { query, maybeOne, withAdvisoryLock, LOCKS } from "../db/pool.js";
import { errMsg, log } from "../lib/logger.js";
import { zonedParts } from "../lib/time.js";
import { runCycle, type CycleDeps } from "../engine/cycle.js";
import { beat, finishJob, startJob } from "../ops/heartbeat.js";
import { getState, setState } from "../ops/systemState.js";
import { openIncident, resolveIncidents } from "../ops/incidents.js";
import { dispatchNotifications } from "../notify/email.js";
import { queueDailyDigest } from "../notify/digest.js";
import { evaluateMaturedForecasts } from "../learning/forecasts.js";
import { evaluatePortfolioGate } from "../promotion/gate.js";
import { refreshEligibility } from "../live/stateMachine.js";
import { listPortfolios } from "../portfolio/state.js";
import { reconcileOrders } from "../execution/orders.js";
import { config } from "../config.js";

async function timed(deps: CycleDeps, job: string, fn: () => Promise<Record<string, unknown> | void>) {
  const id = await startJob(deps.pool, job);
  try {
    const details = (await fn()) ?? {};
    await finishJob(deps.pool, id, "OK", details);
  } catch (err) {
    await finishJob(deps.pool, id, "FAILED", { error: errMsg(err) });
    log.error(`job ${job} failed`, { error: errMsg(err) });
    await openIncident(deps.pool, { severity: "WARNING", kind: "JOB_FAILED", message: `${job}: ${errMsg(err)}`, dedupeKey: `job:${job}` });
  }
}

/** One scheduler tick. Idempotent and safe to run from several workers (advisory locks). */
export async function tick(deps: CycleDeps, now: Date = new Date()): Promise<void> {
  const { pool } = deps;
  const c = config();
  await beat(pool, "worker", { at: now.toISOString() });
  let clock;
  try {
    clock = await deps.market.getClock(now);
    await resolveIncidents(pool, "clock", "system");
  } catch (err) {
    await openIncident(pool, { severity: "WARNING", kind: "MARKET_CLOCK", message: `cannot read market clock: ${errMsg(err)}`, dedupeKey: "clock" });
    return;
  }

  await withAdvisoryLock(LOCKS.DECISION_CYCLE, async () => {
    const last = await maybeOne<{ started_at: Date }>(pool, "SELECT started_at FROM decision_cycles WHERE status IN ('OK', 'RUNNING') ORDER BY started_at DESC LIMIT 1");
    const minutesSince = last ? (now.getTime() - last.started_at.getTime()) / 60_000 : Infinity;
    const closeDone = await getState<{ date?: string }>(pool, "post_close_cycle", {});
    const afterClose = !clock.isOpen && closeDone.date !== clock.sessionDate && zonedParts(now, "America/New_York").hour >= 16;
    const weekday = !["Sat", "Sun"].includes(zonedParts(now, "America/New_York").weekday);
    if ((clock.isOpen && minutesSince >= c.CYCLE_INTERVAL_MINUTES) || (afterClose && weekday)) {
      await timed(deps, "decision_cycle", async () => {
        const r = await runCycle(deps, now);
        if (afterClose) await setState(pool, "post_close_cycle", { date: clock.sessionDate }, "worker");
        return { ...r };
      });
    }
  });

  // Keep resting orders in sync between cycles.
  if (clock.isOpen)
    await withAdvisoryLock(LOCKS.RECONCILE, async () => {
      const open = await query<{ portfolio_id: string }>(
        pool,
        "SELECT DISTINCT portfolio_id FROM orders WHERE status IN ('PENDING_SUBMIT','SUBMITTED','ACCEPTED','PARTIALLY_FILLED','UNKNOWN')",
      );
      if (!open.length) return;
      const portfolios = await listPortfolios(pool);
      for (const { portfolio_id } of open) {
        const p = portfolios.find((x) => x.id === portfolio_id);
        const b = p ? deps.brokers(p).broker : undefined;
        if (b) await reconcileOrders(pool, b, portfolio_id).catch((err) => log.warn("reconcile failed", { error: errMsg(err) }));
      }
    });

  // Stale-data watchdog while the market is open.
  if (clock.isOpen) {
    const lastOk = await maybeOne<{ ingested_at: Date }>(pool, "SELECT ingested_at FROM market_data_batches WHERE status IN ('OK','PARTIAL') ORDER BY ingested_at DESC LIMIT 1");
    const age = lastOk ? (now.getTime() - lastOk.ingested_at.getTime()) / 60_000 : Infinity;
    if (age > c.CYCLE_INTERVAL_MINUTES * 2 + 10)
      await openIncident(pool, { severity: "WARNING", kind: "STALE_DATA", message: `last good market data is ${Number.isFinite(age) ? age.toFixed(0) : "∞"} min old`, dedupeKey: "stale-data" });
    else await resolveIncidents(pool, "stale-data", "system");
  }

  // Daily jobs after the close (once per session date).
  await withAdvisoryLock(LOCKS.DAILY, async () => {
    const ny = zonedParts(now, "America/New_York");
    const done = await getState<{ date?: string }>(pool, "daily_jobs", {});
    if (!clock.isOpen && ny.hour >= 17 && done.date !== ny.dateStr) {
      await timed(deps, "daily", async () => {
        const matured = await evaluateMaturedForecasts(pool, now);
        const gates: Record<string, string> = {};
        for (const p of await listPortfolios(pool)) {
          if (p.kind !== "PAPER") continue;
          const g = await evaluatePortfolioGate(pool, p.id);
          if (g) gates[p.code] = g.decision;
        }
        await refreshEligibility(pool);
        return { matured, gates };
      });
      await setState(pool, "daily_jobs", { date: ny.dateStr }, "worker");
    }
    const il = zonedParts(now, "Asia/Jerusalem");
    const digest = await getState<{ date?: string }>(pool, "daily_digest", {});
    if (il.hour >= c.DIGEST_HOUR_IL && digest.date !== il.dateStr) {
      await queueDailyDigest(pool, ny.dateStr);
      await setState(pool, "daily_digest", { date: il.dateStr }, "worker");
    }
  });

  await withAdvisoryLock(LOCKS.NOTIFY, async () => {
    await dispatchNotifications(pool);
  });
}
