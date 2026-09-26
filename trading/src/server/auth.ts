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
  }
}

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 7;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function tokenHash(token: string) {
  return hmac(config().APP_SECRET, `session:${token}`);
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

/** Loads the session user; enforces CSRF on state-changing requests. */
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
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const header = String(req.headers["x-csrf-token"] ?? "");
      if (!header || !safeEqual(header, row.csrf_token)) throw new HttpError(403, "CSRF token missing or invalid");
    }
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

/** Step-up: sensitive actions need a fresh TOTP code, and 2FA must be enabled. */
export function requireMfa(req: FastifyRequest, code: string | undefined): SessionUser {
  const u = requireOwner(req);
  if (!u.totp_enabled || !u.totp_secret_enc) throw new HttpError(403, "enable 2FA before performing this action");
  const secret = decryptSecret(u.totp_secret_enc, config().APP_SECRET);
  if (!code || !verifyTotp(secret, code)) throw new HttpError(403, "invalid 2FA code");
  return u;
}

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional() });
const SetupBody = z.object({ setupToken: z.string(), email: z.string().email(), password: z.string().min(12) });

export function registerAuthRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.post("/api/auth/setup", async (req, reply) => {
    const body = SetupBody.parse(req.body);
    const c = config();
    if (!c.SETUP_TOKEN || !safeEqual(body.setupToken, c.SETUP_TOKEN)) throw new HttpError(403, "invalid setup token");
    const exists = await maybeOne(pool, "SELECT 1 FROM users LIMIT 1");
    if (exists) throw new HttpError(409, "already set up");
    const u = await maybeOne<{ id: string }>(pool, "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'owner') RETURNING id", [
      body.email.toLowerCase(),
      hashPassword(body.password),
    ]);
    await audit(pool, body.email, "auth.setup", u!.id, {}, req.ip);
    const csrf = await createSession(pool, reply, req, u!.id);
    return { ok: true, csrf };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const email = body.email.toLowerCase();
    const fails = await maybeOne<{ n: number }>(
      pool,
      "SELECT COUNT(*)::int AS n FROM login_attempts WHERE email = $1 AND success = false AND at > now() - interval '15 minutes'",
      [email],
    );
    if ((fails?.n ?? 0) >= 5) throw new HttpError(429, "too many failed attempts, try again later");
    const u = await maybeOne<{ id: string; password_hash: string; totp_enabled: boolean; totp_secret_enc: string | null }>(
      pool,
      "SELECT id, password_hash, totp_enabled, totp_secret_enc FROM users WHERE email = $1",
      [email],
    );
    let ok = !!u && verifyPassword(body.password, u.password_hash);
    if (ok && u!.totp_enabled) {
      if (!body.totp) {
        return reply.code(401).send({ error: "2FA code required", needTotp: true });
      }
      ok = verifyTotp(decryptSecret(u!.totp_secret_enc!, config().APP_SECRET), body.totp);
    }
    await query(pool, "INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)", [email, req.ip, ok]);
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
    const row = await maybeOne<{ password_hash: string }>(pool, "SELECT password_hash FROM users WHERE id = $1", [u.id]);
    if (!row || !verifyPassword(body.current, row.password_hash)) throw new HttpError(403, "הסיסמה הנוכחית שגויה");
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
