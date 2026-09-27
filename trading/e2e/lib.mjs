// Shared helpers for the browser e2e / a11y / layout / perf scripts.
// Env: BASE (default http://localhost:3300), SETUP_BASE (default http://localhost:3301), OUT (screenshot dir).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PW = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
export const { chromium, devices } = await import(PW);

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.BASE ?? "http://localhost:3300";
export const SETUP_BASE = process.env.SETUP_BASE ?? "http://localhost:3301";
export const OUT = process.env.OUT ?? path.join(here, "out");
fs.mkdirSync(OUT, { recursive: true });

export const OWNER = { email: "owner@example.com", password: "correct-horse-battery" };
export const VIEWER = { email: "viewer@example.com", password: "correct-horse-battery" };
export const SECRET_FILE = path.join(OUT, "totp-secret.txt");

export function launch(opts = {}) {
  return chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", ...opts });
}

// ------------------------------------------------------------ TOTP (RFC 6238)
function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0;
  const out = [];
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) {
    const i = A.indexOf(ch);
    if (i < 0) throw new Error(`bad base32 char ${ch}`);
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret, t = Date.now()) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, "0");
}
export const savedSecret = () => (fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, "utf8").trim() : null);

// ------------------------------------------------------------ login
export async function login(page, user = OWNER, base = BASE) {
  await page.goto(base + "/");
  await page.locator("#em").waitFor();
  await page.fill("#em", user.email);
  await page.fill("#pw", user.password);
  await page.getByRole("button", { name: /^כניסה$/ }).click();
  const secret = savedSecret();
  const otp = page.locator("#tp");
  const shell = page.locator(".topbar");
  await Promise.race([otp.waitFor({ timeout: 10000 }), shell.waitFor({ timeout: 10000 })]);
  if (await otp.isVisible()) {
    if (!secret) throw new Error("login needs TOTP but no saved secret");
    await otp.fill(totp(secret));
    await page.getByRole("button", { name: "אימות" }).click();
    // A 2FA code is single-use: if an earlier step just spent this window's code, wait for the next one.
    if (!(await shell.waitFor({ timeout: 4000 }).then(() => true, () => false))) {
      await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
      await otp.fill(totp(secret));
      await page.getByRole("button", { name: "אימות" }).click();
    }
  }
  await shell.waitFor();
}

/** Logs in once via the API and returns a storageState object (cookie) for fast contexts. */
export async function storageState(browser, user = OWNER) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, user);
  const st = await ctx.storageState();
  await ctx.close();
  return st;
}

// ------------------------------------------------------------ axe
const AXE = fs.readFileSync(path.join(here, "..", "node_modules", "axe-core", "axe.min.js"), "utf8");
export async function axe(page, context = null) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async (ctx) => {
    const r = await window.axe.run(ctx ?? document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary ?? "").split("\n").slice(0, 3).join(" | "), html: n.html.slice(0, 160) })),
    }));
  }, context);
}

export async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.locator(".skeleton").first().waitFor({ state: "detached", timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

/** Resolves ids needed for the detail routes. */
export async function routes(page) {
  const ov = await page.evaluate(() => fetch("/api/overview").then((r) => r.json()));
  const dec = await page.evaluate(() => fetch("/api/decisions?limit=50").then((r) => r.json()));
  const pf = ov.portfolios.find((p) => p.kind === "PAPER");
  const d = dec.find((x) => x.status === "EXECUTED") ?? dec[0];
  return [
    ["overview", "#/"],
    ["portfolio", `#/portfolio/${pf.id}`],
    ["decisions", "#/decisions"],
    ["decision", `#/decision/${d.id}`],
    ["strategies", "#/strategies"],
    ["live", "#/live"],
    ["ops", "#/ops"],
    ["settings", "#/settings"],
  ];
}

export function reporter(name) {
  const fails = [];
  return {
    ok: (msg) => console.log(`  ok  ${msg}`),
    fail: (msg) => {
      fails.push(msg);
      console.log(`  FAIL ${msg}`);
    },
    check(cond, msg) {
      cond ? this.ok(msg) : this.fail(msg);
    },
    done() {
      console.log(`\n${name}: ${fails.length ? fails.length + " failure(s)" : "all passed"}`);
      if (fails.length) process.exitCode = 1;
      return fails;
    },
  };
}
