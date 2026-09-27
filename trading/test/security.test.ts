process.env.TEST_DATABASE_URL ??= "postgres://postgres@127.0.0.1:5433/sec_test";

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { freshDb, closePool, testConfig } from "./helpers.js";
import { buildApp } from "../src/server/app.js";
import { bootstrap } from "../src/setup/bootstrap.js";
import { StaticFx } from "../src/market/fx.js";
import { query, maybeOne } from "../src/db/pool.js";
import { decryptSecret, hashPassword, hmac, totpCode } from "../src/lib/crypto.js";
import { log } from "../src/lib/logger.js";

const APP_SECRET = "test-secret-test-secret-test-secret-000";
const OWNER_PW = "long-password-123";

let pool: pg.Pool;
let app: FastifyInstance;
let owner = { cookie: "", csrf: "", email: "" };
let viewer = { cookie: "", csrf: "" };
let totpSecret = "";
let paperId = "";
let liveId = "";
let assetId = "";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const sid = (setCookie: unknown) => String(setCookie ?? "").split(";")[0]!;

function call(method: Method, url: string, payload?: unknown, s: { cookie: string; csrf?: string } | undefined = owner, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (s?.cookie) headers.cookie = s.cookie;
  if (s?.csrf && method !== "GET") headers["x-csrf-token"] = s.csrf;
  return app.inject({ method, url, payload: payload as object, headers });
}

async function login(email: string, password: string, totp?: string, extraHeaders: Record<string, string> = {}) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password, totp }, headers: extraHeaders });
  return { r, cookie: sid(r.headers["set-cookie"]), csrf: r.statusCode === 200 ? (r.json().csrf as string) : "" };
}

async function addUser(email: string, password: string, role: "owner" | "viewer" = "viewer") {
  await query(pool, "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)", [email, hashPassword(password), role]);
}

/** Every mutating route declared in src/server (so new routes are covered automatically). */
function mutatingRoutes(): { method: Method; url: string }[] {
  const dir = path.resolve(__dirname, "../src/server");
  const files = [path.join(dir, "auth.ts"), ...fs.readdirSync(path.join(dir, "routes")).map((f) => path.join(dir, "routes", f))];
  const out: { method: Method; url: string }[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/app\.(post|patch|put|delete)(?:<[^>]*>)?\(\s*"([^"]+)"/g)) out.push({ method: m[1]!.toUpperCase() as Method, url: m[2]! });
  }
  return out;
}

const fill = (url: string, id = paperId) => url.replace(":id", id).replace(":code", "TREND_ROTATION");
const clearAttempts = (like: string) => query(pool, "DELETE FROM login_attempts WHERE email LIKE $1", [like]);

beforeAll(async () => {
  pool = await freshDb();
  await bootstrap(pool, new StaticFx(3.7), "simulated");
  app = await buildApp(pool, { serveWeb: false });
  app.get("/api/__boom", async () => {
    throw new Error('relation "secret_table" does not exist\n    at Object.<anonymous> (/srv/app/src/x.ts:1:1)');
  });
  paperId = (await maybeOne(pool, "SELECT id FROM portfolios WHERE code = 'PAPER-1'"))!.id;
  liveId = (await maybeOne(pool, "SELECT id FROM portfolios WHERE kind = 'LIVE'"))!.id;
  assetId = (await maybeOne(pool, "SELECT id FROM assets ORDER BY symbol LIMIT 1"))!.id;
});
afterAll(async () => {
  testConfig();
  await app.close();
  await closePool();
});

describe("setup endpoint", () => {
  it("creates exactly one owner even under concurrent setup calls, and cannot be reused", async () => {
    const rs = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => app.inject({ method: "POST", url: "/api/auth/setup", payload: { setupToken: "setup-token", email: `o${i}@x.io`, password: OWNER_PW } })),
    );
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(rs.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);
    expect((await query(pool, "SELECT 1 FROM users")).length).toBe(1);
    const win = rs.find((r) => r.statusCode === 200)!;
    owner = { cookie: sid(win.headers["set-cookie"]), csrf: win.json().csrf, email: (await maybeOne(pool, "SELECT email FROM users"))!.email };
    const again = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { setupToken: "setup-token", email: "late@x.io", password: OWNER_PW } });
    expect(again.statusCode).toBe(409);
    testConfig({ SETUP_TOKEN: "" });
    const noToken = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { setupToken: "", email: "late@x.io", password: OWNER_PW } });
    expect(noToken.statusCode).toBe(403);
    testConfig();
    await addUser("v@x.io", "viewer-password-1");
    const v = await login("v@x.io", "viewer-password-1");
    expect(v.r.statusCode).toBe(200);
    viewer = { cookie: v.cookie, csrf: v.csrf };
  });
});

describe("sessions and cookies", () => {
  it("sets HttpOnly + SameSite=Strict cookies, and Secure in production", async () => {
    const dev = await login(owner.email, OWNER_PW);
    const c = String(dev.r.headers["set-cookie"]);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=\d+/);
    expect(c).not.toMatch(/Secure/i);
    testConfig({ NODE_ENV: "production", ALLOW_SIMULATED_DATA: "true" });
    try {
      const prod = await login(owner.email, OWNER_PW);
      expect(prod.r.statusCode).toBe(200);
      expect(String(prod.r.headers["set-cookie"])).toMatch(/;\s*Secure/i);
    } finally {
      testConfig();
    }
  });

  it("issues a fresh server-generated session on login (no fixation) and stores only its hash", async () => {
    const fixed = await login(owner.email, OWNER_PW, undefined, { cookie: "sid=attacker-chosen-value" });
    expect(fixed.cookie).toMatch(/^sid=/);
    expect(fixed.cookie).not.toBe("sid=attacker-chosen-value");
    expect((await call("GET", "/api/overview", undefined, { cookie: "sid=attacker-chosen-value" })).statusCode).toBe(401);
    const again = await login(owner.email, OWNER_PW);
    expect(again.cookie).not.toBe(fixed.cookie);
    const raw = fixed.cookie.slice(4);
    expect(await maybeOne(pool, "SELECT 1 FROM sessions WHERE token_hash = $1", [raw])).toBeUndefined();
    expect(await maybeOne(pool, "SELECT 1 FROM sessions WHERE token_hash = $1", [hmac(APP_SECRET, `session:${raw}`)])).toBeDefined();
  });

  it("rejects expired sessions and invalidates the session on logout", async () => {
    const s = await login("v@x.io", "viewer-password-1");
    expect((await call("GET", "/api/overview", undefined, s)).statusCode).toBe(200);
    await query(pool, "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hmac(APP_SECRET, `session:${s.cookie.slice(4)}`)]);
    expect((await call("GET", "/api/overview", undefined, s)).statusCode).toBe(401);

    const t = await login("v@x.io", "viewer-password-1");
    expect((await call("POST", "/api/auth/logout", {}, { cookie: t.cookie })).statusCode).toBe(403); // CSRF
    const out = await call("POST", "/api/auth/logout", {}, t);
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(/sid=;/);
    expect((await call("GET", "/api/overview", undefined, t)).statusCode).toBe(401);
  });

  it("password change signs out every other session", async () => {
    await addUser("pwc@x.io", "first-password-1");
    const a = await login("pwc@x.io", "first-password-1");
    const b = await login("pwc@x.io", "first-password-1");
    expect((await call("POST", "/api/auth/password", { current: "first-password-1", next: "second-password-2" }, a)).statusCode).toBe(200);
    expect((await call("GET", "/api/overview", undefined, a)).statusCode).toBe(200);
    expect((await call("GET", "/api/overview", undefined, b)).statusCode).toBe(401);
    expect((await login("pwc@x.io", "first-password-1")).r.statusCode).toBe(401);
    expect((await login("pwc@x.io", "second-password-2")).r.statusCode).toBe(200);
  });

  it("rate-limits current-password guesses on the password change endpoint", async () => {
    await addUser("pwb@x.io", "real-password-12");
    const s = await login("pwb@x.io", "real-password-12");
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/auth/password", { current: `guess-${i}`, next: "new-password-123" }, s)).statusCode).toBe(403);
    expect((await call("POST", "/api/auth/password", { current: "real-password-12", next: "new-password-123" }, s)).statusCode).toBe(429);
  });
});

describe("login brute force", () => {
  it("counts failures case- and whitespace-insensitively", async () => {
    await addUser("lock@x.io", "lock-password-12");
    for (const e of ["LOCK@x.io", " lock@x.io", "Lock@X.IO ", "lock@x.io", "lOcK@x.io"]) {
      const r = await login(e, "wrong");
      expect([400, 401]).toContain(r.r.statusCode);
    }
    const n = await maybeOne<{ n: number }>(pool, "SELECT COUNT(*)::int AS n FROM login_attempts WHERE email = 'lock@x.io' AND success = false");
    expect(n!.n).toBe(5); // every variant was normalized to the same key
    expect((await login("lock@x.io", "lock-password-12")).r.statusCode).toBe(429);
    expect((await login(" LOCK@X.IO ", "lock-password-12")).r.statusCode).toBe(429);
  });

  it("cannot be bypassed with parallel requests", async () => {
    await addUser("par@x.io", "par-password-123");
    const rs = await Promise.all(Array.from({ length: 20 }, () => login("par@x.io", "wrong")));
    const tried = rs.filter((x) => x.r.statusCode !== 429).length;
    expect(tried).toBeLessThanOrEqual(5);
    expect((await login("par@x.io", "par-password-123")).r.statusCode).toBe(429);
  });

  it("does not reveal whether an e-mail is registered through response time", async () => {
    await addUser("time@x.io", "time-password-12");
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 3; i++) {
      let t = performance.now();
      await login("time@x.io", `wrong-${i}`);
      known.push(performance.now() - t);
      t = performance.now();
      await login(`nobody${i}@x.io`, `wrong-${i}`);
      unknown.push(performance.now() - t);
    }
    expect(median(unknown)).toBeGreaterThan(median(known) * 0.5);
  });
});

describe("role and CSRF enforcement on every mutating route", () => {
  const VIEWER_ALLOWED = new Set(["/api/auth/login", "/api/auth/setup", "/api/auth/logout", "/api/auth/password"]);

  it("finds the mutating routes (sanity)", () => {
    const routes = mutatingRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(20);
    expect(routes.map((r) => r.url)).toContain("/api/live/transition");
    // There is deliberately no API that places an order directly.
    expect(routes.filter((r) => /order/i.test(r.url))).toHaveLength(0);
  });

  it("viewer gets 403 on every mutating route", async () => {
    const failures: string[] = [];
    for (const r of mutatingRoutes()) {
      if (VIEWER_ALLOWED.has(r.url)) continue;
      for (const body of [{}, { active: false, reason: "viewer try", totp: "123456", to: "ARMED" }]) {
        const res = await call(r.method, fill(r.url), body, viewer);
        if (res.statusCode !== 403) failures.push(`${r.method} ${r.url} -> ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
    expect((await call("GET", "/api/overview", undefined, viewer)).json().system.killSwitch.active).toBe(false);
  });

  it("session without (or with a wrong) CSRF header gets 403 on every mutating route", async () => {
    const failures: string[] = [];
    for (const r of mutatingRoutes()) {
      for (const hdr of [undefined, "wrong-token"]) {
        const res = await call(r.method, fill(r.url), { active: true, reason: "csrf test" }, { cookie: owner.cookie, csrf: hdr });
        if (res.statusCode !== 403) failures.push(`${r.method} ${r.url} (${hdr ?? "none"}) -> ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
    expect((await call("GET", "/api/overview")).json().system.killSwitch.active).toBe(false);
  });

  it("unauthenticated callers cannot use any mutating route", async () => {
    const failures: string[] = [];
    for (const r of mutatingRoutes()) {
      if (["/api/auth/login", "/api/auth/setup", "/api/auth/logout"].includes(r.url)) continue;
      const res = await call(r.method, fill(r.url), { active: true, reason: "anon test" }, { cookie: "" }); // no session at all
      if (res.statusCode < 400 || res.statusCode >= 500) failures.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it("form-encoded / text bodies are not accepted as JSON (no simple-request CSRF)", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/control/kill-switch",
      payload: "active=true&reason=csrf",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/x-www-form-urlencoded" },
    });
    expect(r.statusCode).toBe(415);
    const t = await app.inject({ method: "POST", url: "/api/auth/login", payload: '{"email":"o0@x.io"}', headers: { "content-type": "text/plain" } });
    expect(t.statusCode).toBe(400);
  });
});

describe("input validation", () => {
  it("malformed ids and query params are 4xx, never 500", async () => {
    const bad = "not-a-uuid'; DROP TABLE users;--";
    const cases: [Method, string, unknown?][] = [
      ["GET", `/api/portfolios/${encodeURIComponent(bad)}`],
      ["GET", "/api/decisions/xyz"],
      ["GET", "/api/backtests/xyz"],
      ["GET", "/api/decisions?portfolioId=xyz"],
      ["GET", "/api/decisions?limit=abc"],
      ["GET", "/api/decisions?limit=-1"],
      ["GET", "/api/decisions?limit=1e9"],
      ["POST", "/api/portfolios/xyz/pause", { reason: "abc" }],
      ["POST", "/api/portfolios/xyz/resume", { reason: "abc" }],
      ["POST", "/api/portfolios/xyz/assign", { strategyVersionId: "00000000-0000-0000-0000-000000000000", reason: "abc" }],
      ["PATCH", "/api/experiments/xyz", { status: "PASSED" }],
      ["PATCH", "/api/lessons/xyz", { status: "APPROVED" }],
      ["POST", "/api/incidents/xyz/resolve", {}],
      ["POST", "/api/experiments", { strategyVersionId: "00000000-0000-0000-0000-000000000000", hypothesis: "a long enough hypothesis", successCriteria: {} }],
      ["POST", `/api/portfolios/${paperId}/assign`, { strategyVersionId: "00000000-0000-0000-0000-000000000000", reason: "abc" }],
      ["POST", "/api/strategies/NO_SUCH_STRATEGY/versions", { params: {}, reason: "because" }],
      ["POST", "/api/lessons", { text: "a long enough lesson", supportingDecisionIds: ["00000000-0000-0000-0000-000000000000"] }],
      ["POST", "/api/control/kill-switch", { active: "yes", reason: 1 }],
      ["POST", "/api/control/kill-switch", [1, 2, 3]],
      ["POST", "/api/control/kill-switch", "null"],
    ];
    const failures: string[] = [];
    for (const [m, u, b] of cases) {
      const r = await call(m, u, b);
      if (r.statusCode < 400 || r.statusCode >= 500) failures.push(`${m} ${u} -> ${r.statusCode} ${r.body.slice(0, 120)}`);
      if (/violates|syntax for type|relation|postgres|SELECT|INSERT/i.test(r.body)) failures.push(`${m} ${u} leaks DB detail: ${r.body.slice(0, 160)}`);
    }
    expect(failures).toEqual([]);
    expect((await query(pool, "SELECT 1 FROM users")).length).toBeGreaterThan(0);
  });

  it("filter values are parameterized (SQL injection returns no rows, not an error)", async () => {
    const r = await call("GET", `/api/decisions?status=${encodeURIComponent("' OR 1=1 --")}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });

  it("rejects huge bodies and prototype-pollution payloads", async () => {
    const huge = await call("POST", "/api/lessons", { text: "x".repeat(300 * 1024) });
    expect(huge.statusCode).toBe(413);
    for (const raw of ['{"__proto__":{"polluted":true},"active":true,"reason":"abc"}', '{"constructor":{"prototype":{"polluted":true}},"active":true,"reason":"abc"}']) {
      const r = await app.inject({ method: "POST", url: "/api/control/kill-switch", payload: raw, headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json" } });
      expect(r.statusCode).toBe(400);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((await call("GET", "/api/overview")).json().system.killSwitch.active).toBe(false);
  });
});

describe("headers and error handling", () => {
  it("sends security headers on success, 4xx and 5xx responses", async () => {
    for (const [url, s] of [["/api/health", owner], ["/api/overview", undefined], ["/api/nope", owner], ["/api/__boom", owner]] as const) {
      const r = await call("GET", url, undefined, s);
      expect(String(r.headers["content-security-policy"])).toMatch(/frame-ancestors 'none'/);
      expect(String(r.headers["content-security-policy"])).toMatch(/default-src 'self'/);
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["x-frame-options"]).toBe("DENY");
      expect(String(r.headers["strict-transport-security"])).toMatch(/max-age=\d{7,}/);
    }
  });

  it("does not leak stack traces or DB errors", async () => {
    const r = await call("GET", "/api/__boom");
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "internal error" });
    expect(r.body).not.toMatch(/secret_table|\.ts:|at Object/);
  });
});

describe("2FA step-up", () => {
  it("enables 2FA; the TOTP secret is encrypted at rest", async () => {
    const setup = await call("POST", "/api/auth/totp/setup", {});
    totpSecret = setup.json().secret;
    expect((await call("POST", "/api/auth/totp/enable", { code: totpCode(totpSecret) })).statusCode).toBe(200);
    const row = await maybeOne(pool, "SELECT totp_secret_enc FROM users WHERE email = $1", [owner.email]);
    expect(row.totp_secret_enc).toMatch(/^v1\./);
    expect(row.totp_secret_enc).not.toContain(totpSecret);
    expect(decryptSecret(row.totp_secret_enc, APP_SECRET)).toBe(totpSecret);
    expect((await call("POST", "/api/auth/totp/setup", {})).statusCode).toBe(409);
  });

  it("a step-up code cannot be replayed for the same action", async () => {
    const code = totpCode(totpSecret);
    expect((await call("POST", "/api/control/kill-switch", { active: true, reason: "engage 1" })).statusCode).toBe(200);
    expect((await call("POST", "/api/control/kill-switch", { active: false, reason: "release 1", totp: code })).statusCode).toBe(200);
    expect((await call("POST", "/api/control/kill-switch", { active: true, reason: "engage 2" })).statusCode).toBe(200);
    const replay = await call("POST", "/api/control/kill-switch", { active: false, reason: "release 2", totp: code });
    expect(replay.statusCode).toBe(403);
    expect((await call("GET", "/api/overview")).json().system.killSwitch.active).toBe(true);
  });

  it("a code whose action failed validation can be retried (claim is released)", async () => {
    const code = totpCode(totpSecret);
    const policy = { maxCapitalUsd: 500, pilotFraction: 0.1, allowedSymbols: ["SPY"], maxPositionPct: 0.4, maxOrderUsd: 100, riskBudgetPct: 0.3, strategySwitchPolicy: "MANUAL", autoPromote: false };
    expect((await call("POST", "/api/live/policy", { ...policy, riskBudgetPct: 0.5, totp: code })).statusCode).toBe(400);
    expect((await call("POST", "/api/live/policy", { ...policy, totp: code })).statusCode).toBe(200);
    expect((await call("POST", "/api/live/policy", { ...policy, totp: code })).statusCode).toBe(403);
  });

  it("a login code cannot be replayed", async () => {
    const code = totpCode(totpSecret);
    expect((await login(owner.email, OWNER_PW)).r.json().needTotp).toBe(true);
    expect((await login(owner.email, OWNER_PW, code)).r.statusCode).toBe(200);
    expect((await login(owner.email, OWNER_PW, code)).r.statusCode).toBe(401);
    await clearAttempts(owner.email);
  });

  it("never stores the 2FA code in the (viewer-readable) audit log", async () => {
    const a = (await call("GET", `/api/assets`)).json().find((x: { id: string }) => x.id === assetId);
    const body = { verified: a.verified, is_leveraged: a.is_leveraged, is_inverse: a.is_inverse, crypto_exposure: a.crypto_exposure, active: a.active, source: "security test", totp: totpCode(totpSecret) };
    expect((await call("PATCH", `/api/assets/${assetId}`, body)).statusCode).toBe(200);
    const auditRows = (await call("GET", "/api/audit", undefined, viewer)).json() as { action: string; details: Record<string, unknown> }[];
    const ev = auditRows.find((e) => e.action === "asset.classification")!;
    expect(ev).toBeDefined();
    expect(ev.details).not.toHaveProperty("totp");
    expect(JSON.stringify(auditRows)).not.toContain(`"totp"`);
  });

  it("wrong step-up codes are rate limited (TOTP brute force)", async () => {
    await clearAttempts("mfa:%");
    const wrong = (totpCode(totpSecret) === "000000" ? "111111" : "000000");
    for (let i = 0; i < 5; i++) expect((await call("POST", "/api/live/transition", { to: "ARMED", reason: "brute", totp: wrong })).statusCode).toBe(403);
    const locked = await call("POST", `/api/portfolios/${paperId}/new-run`, { reason: "brute", totp: totpCode(totpSecret) });
    expect(locked.statusCode).toBe(429);
    await clearAttempts("mfa:%");
  });
});

describe("business safety", () => {
  const liveStatus = async () => (await maybeOne(pool, "SELECT status FROM portfolios WHERE id = $1", [liveId]))!.status;

  it("the live portfolio cannot be moved to ELIGIBLE/ARMED/PILOT/ACTIVE without 2FA", async () => {
    for (const to of ["ELIGIBLE", "ARMED", "PILOT", "ACTIVE"]) {
      expect((await call("POST", "/api/live/transition", { to, reason: "no mfa" })).statusCode).toBe(403);
      expect((await call("POST", "/api/live/transition", { to, reason: "bad mfa", totp: "123456" === totpCode(totpSecret) ? "654321" : "123456" })).statusCode).toBe(403);
    }
    expect(await liveStatus()).toBe("DORMANT");
    // Even with 2FA, ELIGIBLE is only set by the promotion gate and DORMANT → PILOT is not a legal transition.
    const code = totpCode(totpSecret);
    expect((await call("POST", "/api/live/transition", { to: "ELIGIBLE", reason: "manual", totp: code })).statusCode).toBe(400);
    expect((await call("POST", "/api/live/transition", { to: "PILOT", reason: "manual", totp: code })).statusCode).toBe(400);
    expect(await liveStatus()).toBe("DORMANT");
    await clearAttempts("mfa:%");
  });

  it("resuming the paused live portfolio needs 2FA and never jumps straight back to trading", async () => {
    expect((await call("POST", `/api/portfolios/${liveId}/pause`, { reason: "sec test" })).statusCode).toBe(200);
    expect((await call("POST", `/api/portfolios/${liveId}/resume`, { reason: "sec test" })).statusCode).toBe(403);
    expect(await liveStatus()).toBe("PAUSED");
    const r = await call("POST", `/api/portfolios/${liveId}/resume`, { reason: "sec test", totp: totpCode(totpSecret) });
    expect(r.statusCode).toBe(200);
    expect(["DORMANT", "ELIGIBLE", "ARMED"]).toContain(r.json().status);
  });

  it("portfolio reset needs 2FA and the live portfolio can never be reset", async () => {
    const before = (await query(pool, "SELECT id FROM portfolios WHERE status <> 'ARCHIVED'")).length;
    expect((await call("POST", `/api/portfolios/${paperId}/new-run`, { reason: "no mfa" })).statusCode).toBe(403);
    expect((await call("POST", `/api/portfolios/${liveId}/new-run`, { reason: "reset live", totp: totpCode(totpSecret) })).statusCode).toBe(400);
    expect((await query(pool, "SELECT id FROM portfolios WHERE status <> 'ARCHIVED'")).length).toBe(before);
    expect((await call("POST", `/api/portfolios/${liveId}/assign`, { strategyVersionId: "00000000-0000-0000-0000-000000000000", reason: "live" })).statusCode).toBe(400);
  });

  it("the kill switch cannot be released without 2FA, and a manual cycle places no orders while it is engaged", async () => {
    expect((await call("POST", "/api/control/kill-switch", { active: true, reason: "engage" })).statusCode).toBe(200);
    expect((await call("POST", "/api/control/kill-switch", { active: false, reason: "release" })).statusCode).toBe(403);
    expect((await call("GET", "/api/overview")).json().system.killSwitch.active).toBe(true);
    const before = (await query(pool, "SELECT 1 FROM orders")).length;
    const r = await call("POST", "/api/operations/run-cycle", {});
    expect([200, 409]).toContain(r.statusCode);
    expect((await query(pool, "SELECT 1 FROM orders")).length).toBe(before);
  });
});

describe("secrets", () => {
  const SECRETS = {
    BROKER_PAPER_KEY: "PAPERKEY-SEKRET-AAAA",
    BROKER_PAPER_SECRET: "PAPERSECRET-SEKRET-BBBB",
    BROKER_LIVE_KEY: "LIVEKEY-SEKRET-CCCC",
    BROKER_LIVE_SECRET: "LIVESECRET-SEKRET-DDDD",
    AI_API_KEY: "AIKEY-SEKRET-EEEE",
    NOTIFICATIONS_API_KEY: "NOTIFYKEY-SEKRET-FFFF",
    MARKET_DATA_API_KEY: "MDKEY-SEKRET-GGGG",
    MARKET_DATA_API_SECRET: "MDSECRET-SEKRET-HHHH",
  };

  it("no read endpoint returns API keys, password hashes, TOTP secrets, session tokens or APP_SECRET", async () => {
    testConfig(SECRETS);
    try {
      const users = await query(pool, "SELECT password_hash, totp_secret_enc FROM users");
      const sessions = await query(pool, "SELECT token_hash, csrf_token FROM sessions");
      const forbidden = [
        ...Object.values(SECRETS),
        APP_SECRET,
        totpSecret,
        owner.cookie.slice(4),
        ...users.flatMap((u) => [u.password_hash, u.totp_secret_enc].filter(Boolean)),
        ...sessions.map((s) => s.token_hash),
        "scrypt$",
      ];
      const urls = ["/api/overview", `/api/portfolios/${paperId}`, `/api/portfolios/${liveId}`, "/api/decisions", "/api/strategies", "/api/live", "/api/operations", "/api/assets", "/api/audit", "/api/auth/me"];
      for (const s of [owner, viewer]) {
        for (const u of urls) {
          const r = await call("GET", u, undefined, s);
          expect(r.statusCode, u).toBe(200);
          for (const f of forbidden) expect(r.body.includes(f), `${u} leaks ${f.slice(0, 12)}…`).toBe(false);
        }
      }
    } finally {
      testConfig();
    }
  });

  it("the logger redacts secret-looking fields", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      log.error("probe", { apiKey: "S-1", nested: { password: "S-2", headers: { authorization: "S-3" } }, list: [{ secret: "S-4" }], token: "S-5" });
      const out = spy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain("probe");
      for (const s of ["S-1", "S-2", "S-3", "S-4", "S-5"]) expect(out).not.toContain(s);
    } finally {
      spy.mockRestore();
    }
  });
});
