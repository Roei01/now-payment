import { query, maybeOne, type Db } from "../db/pool.js";
import { config } from "../config.js";
import { audit } from "../ops/audit.js";
import { enqueueNotification } from "../notify/outbox.js";
import { latestLivePolicy } from "./policy.js";
import { assignStrategy, getStrategyVersion } from "../strategies/registry.js";
import type { Broker } from "../broker/types.js";

export type LiveStatus = "DORMANT" | "ELIGIBLE" | "ARMED" | "PILOT" | "ACTIVE" | "PAUSED";

/** Allowed transitions. PAUSED is reachable from anywhere; leaving it goes through resumePortfolio. */
export const TRANSITIONS: Record<LiveStatus, LiveStatus[]> = {
  DORMANT: ["ELIGIBLE", "PAUSED"],
  ELIGIBLE: ["DORMANT", "ARMED", "PAUSED"],
  ARMED: ["PILOT", "DORMANT", "PAUSED"],
  PILOT: ["ACTIVE", "ARMED", "DORMANT", "PAUSED"],
  ACTIVE: ["ARMED", "DORMANT", "PAUSED"],
  PAUSED: [],
};

export interface ReadinessReport {
  ready: boolean;
  checks: { code: string; pass: boolean; detail: string }[];
}

/** Live readiness: explicit flag, signed policy, broker account state (cash account, not blocked). */
export async function liveReadiness(db: Db, portfolioId: string, broker: Broker | undefined): Promise<ReadinessReport> {
  const c = config();
  const checks: ReadinessReport["checks"] = [];
  checks.push({ code: "LIVE_FLAG", pass: c.LIVE_TRADING_ENABLED, detail: `LIVE_TRADING_ENABLED=${c.LIVE_TRADING_ENABLED}` });
  const policy = await latestLivePolicy(db, portfolioId);
  checks.push({ code: "SIGNED_POLICY", pass: !!policy?.mfa_verified, detail: policy ? `v${policy.version} signed by ${policy.signed_by}` : "no signed live policy" });
  if (!broker) {
    checks.push({ code: "BROKER", pass: false, detail: "live broker not configured (BROKER_LIVE_KEY/SECRET)" });
  } else {
    try {
      const acct = await broker.getAccount();
      checks.push({ code: "BROKER_ACCOUNT", pass: acct.status === "ACTIVE" && !acct.tradingBlocked && !acct.accountBlocked, detail: `status ${acct.status}` });
      checks.push({ code: "CASH_ACCOUNT", pass: Number(acct.multiplier) <= 1, detail: `multiplier ${acct.multiplier} (server rules forbid credit regardless)` });
      checks.push({ code: "CURRENCY", pass: acct.currency === "USD", detail: acct.currency });
      if (policy) checks.push({ code: "FUNDS", pass: Number(acct.cash) >= Number(policy.max_capital_usd) * Number(policy.pilot_fraction), detail: `cash ${acct.cash}` });
      const open = await broker.listOpenOrders();
      checks.push({ code: "NO_FOREIGN_OPEN_ORDERS", pass: open.length === 0, detail: `${open.length} open orders at broker` });
    } catch (err) {
      checks.push({ code: "BROKER_ACCOUNT", pass: false, detail: (err as Error).message });
    }
  }
  const incidents = await maybeOne<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM incidents WHERE resolved_at IS NULL AND severity = 'CRITICAL'");
  checks.push({ code: "NO_CRITICAL_INCIDENTS", pass: (incidents?.n ?? 0) === 0, detail: `${incidents?.n ?? 0} open` });
  return { ready: checks.every((x) => x.pass), checks };
}

export async function transitionLive(
  db: Db,
  args: { portfolioId: string; to: LiveStatus; actor: string; reason: string; mfaVerified: boolean; readiness?: ReadinessReport; strategyVersionId?: string },
): Promise<void> {
  const p = await maybeOne<{ kind: string; status: LiveStatus; auto_promote: boolean }>(db, "SELECT kind, status, auto_promote FROM portfolios WHERE id = $1", [args.portfolioId]);
  if (!p || p.kind !== "LIVE") throw new Error("not a live portfolio");
  if (!TRANSITIONS[p.status].includes(args.to)) throw new Error(`transition ${p.status} → ${args.to} is not allowed`);
  const isSystem = args.actor === "system";
  if (args.to === "ELIGIBLE" && !isSystem) throw new Error("ELIGIBLE is set only by the promotion gate");
  const riskIncreasing = args.to === "ARMED" && p.status === "ELIGIBLE" || args.to === "PILOT" || args.to === "ACTIVE";
  if (riskIncreasing) {
    const autoAllowed = isSystem && p.auto_promote && (args.to === "PILOT" || args.to === "ACTIVE");
    if (!autoAllowed && !args.mfaVerified) throw new Error("this transition requires a 2FA-verified user action");
    if (!args.readiness?.ready) throw new Error(`live readiness failed: ${args.readiness?.checks.filter((c) => !c.pass).map((c) => c.code).join(", ") ?? "not checked"}`);
  }
  if (args.to === "ARMED" && p.status === "ELIGIBLE") {
    const eligible = await maybeOne<{ strategy_version_id: string }>(
      db,
      `SELECT strategy_version_id FROM promotion_evaluations
        WHERE decision = 'PASS' AND evaluated_at > now() - interval '7 days' AND ($1::uuid IS NULL OR strategy_version_id = $1)
        ORDER BY evaluated_at DESC LIMIT 1`,
      [args.strategyVersionId ?? null],
    );
    if (!eligible) throw new Error("no strategy version passed the promotion gate in the last 7 days");
    const v = await getStrategyVersion(db, eligible.strategy_version_id);
    // Copy strategy_id + version + parameters; targets are recomputed on the live state (no trade history is copied).
    await assignStrategy(db, args.portfolioId, v.id, `promoted ${v.code} v${v.version} from paper`, args.actor);
  }
  await query(db, "UPDATE portfolios SET status = $2 WHERE id = $1", [args.portfolioId, args.to]);
  await query(
    db,
    "INSERT INTO live_state_transitions (portfolio_id, from_status, to_status, reason, actor, mfa_verified) VALUES ($1,$2,$3,$4,$5,$6)",
    [args.portfolioId, p.status, args.to, args.reason, args.actor, args.mfaVerified],
  );
  await audit(db, args.actor, "live.transition", args.portfolioId, { from: p.status, to: args.to, reason: args.reason, mfa: args.mfaVerified });
  await enqueueNotification(db, {
    dedupeKey: `live-transition:${args.portfolioId}:${p.status}:${args.to}:${Date.now()}`,
    kind: "live.transition",
    severity: riskIncreasing ? "WARNING" : "INFO",
    subject: `תיק חי: ${p.status} → ${args.to}`,
    body: `${args.reason}\nבוצע על ידי: ${args.actor}`,
  });
}

/** System-driven: DORMANT ⇄ ELIGIBLE follows the latest gate results. Never arms or trades by itself. */
export async function refreshEligibility(db: Db): Promise<void> {
  const live = await maybeOne<{ id: string; status: LiveStatus }>(db, "SELECT id, status FROM portfolios WHERE kind = 'LIVE' LIMIT 1");
  if (!live) return;
  const pass = await maybeOne(db, "SELECT 1 FROM promotion_evaluations WHERE decision = 'PASS' AND evaluated_at > now() - interval '7 days' LIMIT 1");
  if (live.status === "DORMANT" && pass)
    await transitionLive(db, { portfolioId: live.id, to: "ELIGIBLE", actor: "system", reason: "a paper strategy passed the promotion gate", mfaVerified: false });
  if (live.status === "ELIGIBLE" && !pass)
    await transitionLive(db, { portfolioId: live.id, to: "DORMANT", actor: "system", reason: "no current gate pass", mfaVerified: false });
}
