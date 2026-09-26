import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { freshDb, closePool } from "./helpers.js";
import { buildApp } from "../src/server/app.js";
import { bootstrap } from "../src/setup/bootstrap.js";
import { StaticFx } from "../src/market/fx.js";
import { base32Encode, totpCode } from "../src/lib/crypto.js";

let app: FastifyInstance;
let cookie = "";
let csrf = "";

beforeAll(async () => {
  const pool = await freshDb();
  await bootstrap(pool, new StaticFx(3.7), "simulated");
  app = await buildApp(pool, { serveWeb: false });
});
afterAll(async () => {
  await app.close();
  await closePool();
});

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload, headers: { cookie, ...headers } });

describe("API security", () => {
  it("requires the setup token for the first user and then logs in", async () => {
    expect((await call("POST", "/api/auth/setup", { setupToken: "wrong", email: "o@x.io", password: "long-password-123" })).statusCode).toBe(403);
    const r = await call("POST", "/api/auth/setup", { setupToken: "setup-token", email: "o@x.io", password: "long-password-123" });
    expect(r.statusCode).toBe(200);
    cookie = String(r.headers["set-cookie"]).split(";")[0]!;
    csrf = r.json().csrf;
    expect(String(r.headers["set-cookie"])).toMatch(/HttpOnly/);
    expect((await call("POST", "/api/auth/setup", { setupToken: "setup-token", email: "b@x.io", password: "long-password-123" }, { "x-csrf-token": csrf })).statusCode).toBe(409);
  });

  it("rejects unauthenticated reads", async () => {
    expect((await app.inject({ method: "GET", url: "/api/overview" })).statusCode).toBe(401);
    expect((await call("GET", "/api/overview")).statusCode).toBe(200);
  });

  it("enforces CSRF on state-changing requests", async () => {
    expect((await call("POST", "/api/control/kill-switch", { active: true, reason: "test" })).statusCode).toBe(403);
    expect((await call("POST", "/api/control/kill-switch", { active: true, reason: "test" }, { "x-csrf-token": csrf })).statusCode).toBe(200);
  });

  it("requires 2FA to release the kill switch and to sign a live policy", async () => {
    const release = await call("POST", "/api/control/kill-switch", { active: false, reason: "done" }, { "x-csrf-token": csrf });
    expect(release.statusCode).toBe(403);
    expect(release.json().error).toMatch(/2FA/);
    const setup = await call("POST", "/api/auth/totp/setup", {}, { "x-csrf-token": csrf });
    const secret = setup.json().secret as string;
    expect((await call("POST", "/api/auth/totp/enable", { code: totpCode(secret) }, { "x-csrf-token": csrf })).statusCode).toBe(200);
    expect((await call("POST", "/api/control/kill-switch", { active: false, reason: "done", totp: "000000" }, { "x-csrf-token": csrf })).statusCode).toBe(403);
    expect((await call("POST", "/api/control/kill-switch", { active: false, reason: "done", totp: totpCode(secret) }, { "x-csrf-token": csrf })).statusCode).toBe(200);
    const policy = { maxCapitalUsd: 500, pilotFraction: 0.1, allowedSymbols: ["SPY"], maxPositionPct: 0.4, maxOrderUsd: 100, riskBudgetPct: 0.3, strategySwitchPolicy: "MANUAL", autoPromote: false };
    expect((await call("POST", "/api/live/policy", policy, { "x-csrf-token": csrf })).statusCode).toBe(403);
    const bad = await call("POST", "/api/live/policy", { ...policy, riskBudgetPct: 0.5, totp: totpCode(secret) }, { "x-csrf-token": csrf });
    expect(bad.statusCode).toBe(400);
    const ok = await call("POST", "/api/live/policy", { ...policy, totp: totpCode(secret) }, { "x-csrf-token": csrf });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(1);
    // Login now needs the second factor.
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "o@x.io", password: "long-password-123" } });
    expect(login.json().needTotp).toBe(true);
  });

  it("serves portfolio, decision, strategy, live and operations views", async () => {
    const o = (await call("GET", "/api/overview")).json();
    expect(o.portfolios.length).toBe(5);
    expect((await call("GET", `/api/portfolios/${o.portfolios[0].id}`)).statusCode).toBe(200);
    for (const u of ["/api/strategies", "/api/live", "/api/operations", "/api/assets", "/api/audit", "/api/decisions"]) expect((await call("GET", u)).statusCode).toBe(200);
  });

  it("changes the password only with the current one", async () => {
    expect((await call("POST", "/api/auth/password", { current: "wrong-password", next: "another-long-password" }, { "x-csrf-token": csrf })).statusCode).toBe(403);
    expect((await call("POST", "/api/auth/password", { current: "long-password-123", next: "short" }, { "x-csrf-token": csrf })).statusCode).toBe(400);
    expect((await call("POST", "/api/auth/password", { current: "long-password-123", next: "long-password-123" }, { "x-csrf-token": csrf })).statusCode).toBe(200);
  });

  it("locks out after repeated failed logins", async () => {
    for (let i = 0; i < 5; i++) await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "o@x.io", password: "nope" } });
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "o@x.io", password: "nope" } })).statusCode).toBe(429);
  });

  it("base32 helper round-trips", () => {
    expect(base32Encode(Buffer.from("hi"))).toBe("NBUQ");
  });
});
