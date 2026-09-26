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

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const e = err as { statusCode?: number; message?: string };
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
    await app.register(fastifyStatic, { root: webDir, prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      return reply.type("text/html").sendFile("index.html");
    });
  }
  return app;
}
