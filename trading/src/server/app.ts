import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type pg from "pg";
import { ZodError } from "zod";
import { query } from "../db/pool.js";
import { HttpError, registerAuthHooks, registerAuthRoutes } from "./auth.js";
import { registerReadRoutes } from "./routes/read.js";
import { registerActionRoutes } from "./routes/actions.js";
import { log } from "../lib/logger.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp(pool: pg.Pool, opts: { serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 256 * 1024 });
  await app.register(cookie);

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    reply.header("Strict-Transport-Security", "max-age=31536000");
    return payload;
  });

  // Every `:id` route parameter is a UUID; reject anything else before it reaches SQL (was a 500).
  app.addHook("preValidation", async (req) => {
    const id = (req.params as Record<string, unknown> | undefined)?.id;
    if (typeof id === "string" && !UUID.test(id)) throw new HttpError(400, "invalid id");
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const e = err as { statusCode?: number; message?: string; code?: unknown; severity?: unknown };
    // Postgres data (22xxx) / integrity (23xxx) errors are client mistakes (bad reference, bad value): 4xx, without DB details.
    if (typeof e.code === "string" && typeof e.severity === "string" && /^2[23]/.test(e.code)) {
      log.warn("rejected API request (database constraint)", { sqlstate: e.code, error: e.message });
      return reply.code(e.code.startsWith("23505") ? 409 : 400).send({ error: "invalid request" });
    }
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    log.error("unhandled API error", { error: e.message });
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/api/health", async () => {
    await query(pool, "SELECT 1");
    return { ok: true, time: new Date().toISOString() };
  });

  registerAuthHooks(app, pool);
  registerAuthRoutes(app, pool);
  registerReadRoutes(app, pool);
  registerActionRoutes(app, pool);

  const webDir = path.resolve(here, "../../web/dist");
  if (opts.serveWeb !== false && fs.existsSync(webDir)) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: "/",
      setHeaders: (res, filePath) => {
        // Hashed build assets never change; the shell and service worker must always revalidate.
        // (@fastify/static passes the Fastify reply here.)
        (res as unknown as { header(k: string, v: string): void }).header("Cache-Control", filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      // Missing API routes and missing files are real 404s; only app routes get the SPA shell.
      if (req.url.startsWith("/api/") || /\.[a-z0-9]+(\?.*)?$/i.test(req.url)) return reply.code(404).send({ error: "not found" });
      return reply.type("text/html").header("Cache-Control", "no-cache").sendFile("index.html");
    });
  }
  return app;
}
