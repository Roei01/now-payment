import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query, maybeOne } from "../db/pool.js";
import type pg from "pg";
import { config } from "../config.js";
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  hmac,
  matchTotp,
  randomToken,
  safeEqual,
  totpUri,
  verifyPassword,
  verifyTotp,
} from "../lib/crypto.js";
import { audit } from "../ops/audit.js";

export interface SessionUser {
  id: string;
  email: string;
  role: "owner" | "viewer";
  totp_enabled: boolean;
  totp_secret_enc: string | null;
  csrf_token: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
    /** A TOTP time-step claimed by requireMfa; released again if the request fails. */
    mfaClaim?: { key: string; counter: number; prev: unknown };
  }
}

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 7;
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];
/** Failed attempts (password, login 2FA, step-up 2FA) allowed per key in the window. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW = "15 minutes";
const SETUP_LOCK = 7_100_010;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function tokenHash(token: string) {
  return hmac(config().APP_SECRET, `session:${token}`);
}

let dummyHash: string | undefined;
/** Verifies against a throw-away hash when the user does not exist, so response time does not reveal registered e-mails. */
function verifyPasswordConstantTime(password: string, stored: string | undefined): boolean {
  if (stored) return verifyPassword(password, stored);
  dummyHash ??= hashPassword(randomToken(16));
  verifyPassword(password, dummyHash);
  return false;
}

/**
 * Records an attempt as failed *before* checking the credential, then counts failures up to and including it.
 * Concurrent requests therefore cannot all slip under the limit (check-then-insert race). Returns the attempt id.
 */
async function beginAttempt(pool: pg.Pool, key: string, ip: string): Promise<number> {
  const row = await maybeOne<{ id: number }>(pool, "INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, false) RETURNING id", [key, ip]);
  const fails = await maybeOne<{ n: number }>(
    pool,
    `SELECT COUNT(*)::int AS n FROM login_attempts WHERE email = $1 AND success = false AND at > now() - interval '${FAILURE_WINDOW}' AND id <= $2`,
    [key, row!.id],
  );
  if ((fails?.n ?? 0) > MAX_FAILURES) {
    await query(pool, "DELETE FROM login_attempts WHERE id = $1", [row!.id]);
    throw new HttpError(429, "too many failed attempts, try again later");
  }
  return row!.id;
}

const markAttempt = (pool: pg.Pool, id: number, success: boolean) =>
  success ? query(pool, "UPDATE login_attempts SET success = true WHERE id = $1", [id]) : Promise.resolve([]);
const dropAttempt = (pool: pg.Pool, id: number) => query(pool, "DELETE FROM login_attempts WHERE id = $1", [id]);

/** Atomically marks a TOTP time step as used for a scope; false if it (or a later one) was already used. */
async function claimTotp(pool: pg.Pool, req: FastifyRequest | undefined, userId: string, scope: string, counter: number): Promise<boolean> {
  const key = `totp_used:${userId}:${scope}`;
  const prev = (await maybeOne<{ value: unknown }>(pool, "SELECT value FROM system_state WHERE key = $1", [key]))?.value ?? null;
  const rows = await query(
    pool,
    `INSERT INTO system_state (key, value, updated_by) VALUES ($1, jsonb_build_object('counter', $2::bigint), 'auth')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE (system_state.value->>'counter')::bigint < $2::bigint RETURNING key`,
    [key, counter],
  );
  if (rows.length === 0) return false;
  if (req) req.mfaClaim = { key, counter, prev };
  return true;
}

async function createSession(pool: pg.Pool, reply: FastifyReply, req: FastifyRequest, userId: string) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  await query(
    pool,
    `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + interval '${SESSION_DAYS} days', $4, $5)`,
    [tokenHash(token), userId, csrf, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 200)],
  );
  const secure = config().NODE_ENV === "production";
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: SESSION_DAYS * 86400 });
  return csrf;
}

/** Loads the session user; enforces CSRF on state-changing requests and the owner role on every mutating non-auth API route. */
export function registerAuthHooks(app: FastifyInstance, pool: pg.Pool) {
  app.addHook("preHandler", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const row = await maybeOne<SessionUser>(
      pool,
      `SELECT u.id, u.email, u.role, u.totp_enabled, u.totp_secret_enc, s.csrf_token
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash(token)],
    );
    if (!row) return;
    req.user = row;
    await query(pool, "UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash(token)]);
    if (!SAFE_METHODS.includes(req.method)) {
      const header = String(req.headers["x-csrf-token"] ?? "");
      if (!header || !safeEqual(header, row.csrf_token)) throw new HttpError(403, "CSRF token missing or invalid");
    }
  });

  // Defense in depth: only the owner may call a mutating API route (auth routes check their own rules).
  app.addHook("preHandler", async (req) => {
    if (SAFE_METHODS.includes(req.method)) return;
    const url = req.routeOptions.url ?? req.url;
    if (!url.startsWith("/api/") || url.startsWith("/api/auth/")) return;
    requireOwner(req);
  });

  // A step-up code is single-use per action; if the action itself fails, the claim is released so the owner can retry.
  app.addHook("onSend", async (req, reply, payload) => {
    const claim = req.mfaClaim;
    if (claim && reply.statusCode >= 400) {
      req.mfaClaim = undefined;
      if (claim.prev === null) await query(pool, "DELETE FROM system_state WHERE key = $1 AND (value->>'counter')::bigint = $2", [claim.key, claim.counter]);
      else
        await query(pool, "UPDATE system_state SET value = $3 WHERE key = $1 AND (value->>'counter')::bigint = $2", [claim.key, claim.counter, JSON.stringify(claim.prev)]);
    }
    return payload;
  });
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, "not authenticated");
  return req.user;
}

export function requireOwner(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== "owner") throw new HttpError(403, "owner role required");
  return u;
}

/**
 * Step-up: sensitive actions need a fresh TOTP code, and 2FA must be enabled.
 * Wrong codes are rate limited (brute force), and a code cannot be replayed for the same action.
 */
export async function requireMfa(pool: pg.Pool, req: FastifyRequest, code: string | undefined): Promise<SessionUser> {
  const u = requireOwner(req);
  if (!u.totp_enabled || !u.totp_secret_enc) throw new HttpError(403, "enable 2FA before performing this action");
  if (!code) throw new HttpError(403, "invalid 2FA code");
  const attempt = await beginAttempt(pool, `mfa:${u.id}`, req.ip);
  const counter = matchTotp(decryptSecret(u.totp_secret_enc, config().APP_SECRET), code);
  if (counter === null) throw new HttpError(403, "invalid 2FA code");
  await markAttempt(pool, attempt, true);
  const scope = `${req.method} ${req.routeOptions.url ?? req.url}`;
  if (!(await claimTotp(pool, req, u.id, scope, counter))) throw new HttpError(403, "2FA code already used — wait for the next code");
  return u;
}

const LoginBody = z.object({ email: z.string().trim().email(), password: z.string().min(1), totp: z.string().optional() });
const SetupBody = z.object({ setupToken: z.string(), email: z.string().trim().email(), password: z.string().min(12) });

export function registerAuthRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.post("/api/auth/setup", async (req, reply) => {
    const body = SetupBody.parse(req.body);
    const c = config();
    if (!c.SETUP_TOKEN || !safeEqual(body.setupToken, c.SETUP_TOKEN)) throw new HttpError(403, "invalid setup token");
    // Serialize concurrent setup calls so exactly one owner can ever be created.
    const client = await pool.connect();
    let userId: string;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [SETUP_LOCK]);
      const exists = await maybeOne(client, "SELECT 1 FROM users LIMIT 1");
      if (exists) throw new HttpError(409, "already set up");
      const u = await maybeOne<{ id: string }>(client, "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'owner') RETURNING id", [
        body.email.toLowerCase(),
        hashPassword(body.password),
      ]);
      await client.query("COMMIT");
      userId = u!.id;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await audit(pool, body.email, "auth.setup", userId, {}, req.ip);
    const csrf = await createSession(pool, reply, req, userId);
    return { ok: true, csrf };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const email = body.email.toLowerCase();
    const attempt = await beginAttempt(pool, email, req.ip);
    const u = await maybeOne<{ id: string; password_hash: string; totp_enabled: boolean; totp_secret_enc: string | null }>(
      pool,
      "SELECT id, password_hash, totp_enabled, totp_secret_enc FROM users WHERE email = $1",
      [email],
    );
    let ok = verifyPasswordConstantTime(body.password, u?.password_hash) && !!u;
    if (ok && u!.totp_enabled) {
      if (!body.totp) {
        await dropAttempt(pool, attempt);
        return reply.code(401).send({ error: "2FA code required", needTotp: true });
      }
      const counter = matchTotp(decryptSecret(u!.totp_secret_enc!, config().APP_SECRET), body.totp);
      ok = counter !== null && (await claimTotp(pool, undefined, u!.id, "login", counter));
    }
    await markAttempt(pool, attempt, ok);
    if (!ok) throw new HttpError(401, "invalid credentials");
    await audit(pool, email, "auth.login", u!.id, {}, req.ip);
    const csrf = await createSession(pool, reply, req, u!.id);
    return { ok: true, csrf };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await query(pool, "DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    const hasUsers = !!(await maybeOne(pool, "SELECT 1 FROM users LIMIT 1"));
    if (!req.user) return { authenticated: false, setupRequired: !hasUsers };
    return { authenticated: true, email: req.user.email, role: req.user.role, totpEnabled: req.user.totp_enabled, csrf: req.user.csrf_token };
  });

  app.post("/api/auth/password", async (req, reply) => {
    const u = requireUser(req);
    const body = z.object({ current: z.string().min(1), next: z.string().min(12) }).parse(req.body);
    // A stolen session must not be able to brute-force the current password.
    const attempt = await beginAttempt(pool, `password:${u.id}`, req.ip);
    const row = await maybeOne<{ password_hash: string }>(pool, "SELECT password_hash FROM users WHERE id = $1", [u.id]);
    if (!row || !verifyPassword(body.current, row.password_hash)) throw new HttpError(403, "הסיסמה הנוכחית שגויה");
    await markAttempt(pool, attempt, true);
    await query(pool, "UPDATE users SET password_hash = $2 WHERE id = $1", [u.id, hashPassword(body.next)]);
    // Sign out every other session.
    const token = req.cookies[SESSION_COOKIE];
    await query(pool, "DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [u.id, token ? tokenHash(token) : ""]);
    await audit(pool, u.email, "auth.password.changed", u.id, {}, req.ip);
    return reply.send({ ok: true });
  });

  app.post("/api/auth/totp/setup", async (req) => {
    const u = requireOwner(req);
    if (u.totp_enabled) throw new HttpError(409, "2FA already enabled");
    const secret = generateTotpSecret();
    await query(pool, "UPDATE users SET totp_secret_enc = $2 WHERE id = $1", [u.id, encryptSecret(secret, config().APP_SECRET)]);
    return { secret, uri: totpUri(secret, u.email) };
  });

  app.post("/api/auth/totp/enable", async (req) => {
    const u = requireOwner(req);
    const { code } = z.object({ code: z.string() }).parse(req.body);
    const row = await maybeOne<{ totp_secret_enc: string | null }>(pool, "SELECT totp_secret_enc FROM users WHERE id = $1", [u.id]);
    if (!row?.totp_secret_enc) throw new HttpError(400, "run 2FA setup first");
    if (!verifyTotp(decryptSecret(row.totp_secret_enc, config().APP_SECRET), code)) throw new HttpError(400, "invalid code");
    await query(pool, "UPDATE users SET totp_enabled = true WHERE id = $1", [u.id]);
    await audit(pool, u.email, "auth.totp.enabled", u.id, {}, req.ip);
    return { ok: true };
  });
}
