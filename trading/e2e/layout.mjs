// Layout checks on every page at every device profile: horizontal overflow, covered interactive elements,
// clipped text, tap-target size, dialogs in viewport (incl. simulated on-screen keyboard), reduced motion.
// Usage: node e2e/layout.mjs [--quick]   (SHOTS=dir to also save screenshots)
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, devices, launch, reporter, routes, settle, storageState } from "./lib.mjs";

const R = reporter("layout");
const SHOTS = process.env.SHOTS ?? path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const quick = process.argv.includes("--quick");

const PROFILES = [
  ["iPhone SE", devices["iPhone SE"]],
  ["iPhone 15 Pro Max", devices["iPhone 15 Pro Max"]],
  ["Pixel 7", devices["Pixel 7"]],
  ["Galaxy S9+", devices["Galaxy S9+"]],
  ["iPhone SE landscape", devices["iPhone SE landscape"]],
  ["Pixel 7 landscape", devices["Pixel 7 landscape"]],
  ["iPad Mini", devices["iPad Mini"]],
  ["iPad Pro 11 landscape", devices["iPad Pro 11 landscape"]],
  ["Desktop 1440", { viewport: { width: 1440, height: 900 } }],
  // Browser zoom 200% on a 1280x800 laptop == 640x400 CSS px at DPR 2.
  ["Zoom 200% (1280x800)", { viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 }],
  // WCAG 1.4.10 reflow: 320 CSS px wide.
  ["Reflow 320", { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];

// Runs in the page: returns a list of problems.
function inspect() {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const desc = (el) => {
    const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("href") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${t}"`;
  };
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden], details:not([open]) > :not(summary)");
  };

  // 1) horizontal page overflow
  if (document.documentElement.scrollWidth > vw + 1) out.push(`page overflows horizontally: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && !el.closest(".sidebar")) {
      const s = getComputedStyle(el);
      if (s.position === "fixed" && el.closest(".toasts")) continue;
      out.push(`element outside viewport x-range [${Math.round(r.left)},${Math.round(r.right)}]: ${desc(el)}`);
    }
  }

  // 2) clipped text (overflow hidden without ellipsis) + ellipsised labels
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || !el.childNodes.length) continue;
    const s = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    if (el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(s.overflowX)) {
      if (s.textOverflow === "ellipsis") out.push(`WARN truncated with ellipsis: ${desc(el)} (${el.scrollWidth}>${el.clientWidth})`);
      else out.push(`text clipped: ${desc(el)} (${el.scrollWidth}>${el.clientWidth})`);
    }
    if (el.scrollHeight > el.clientHeight + 2 && /(hidden|clip)/.test(s.overflowY) && !s.webkitLineClamp?.match?.(/\d/) && s.webkitLineClamp === "none") {
      out.push(`text clipped vertically: ${desc(el)}`);
    }
  }

  // 3) tap targets
  for (const el of document.querySelectorAll(".btn, .tab, .side-link, .segmented button, summary, .sheet-head button")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const primary = el.matches(".btn:not(.sm), .tab, .side-link");
    const min = primary ? 40 : 32;
    if (r.height < min - 0.5 || r.width < min - 0.5) out.push(`${primary ? "" : "WARN "}small tap target ${Math.round(r.width)}x${Math.round(r.height)} (<${min}): ${desc(el)}`);
  }
  return out;
}

// Scrolls each interactive element to the centre and checks it is the top-most element there.
async function covered(page) {
  return page.evaluate(async () => {
    const out = [];
    const els = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest(".sidebar") && !el.closest("details:not([open]) > :not(summary)");
    });
    const chrome = (el) => !!el?.closest(".topbar, .tabbar, .toasts");
    for (const el of els) {
      const inChrome = chrome(el);
      if (!inChrome) el.scrollIntoView({ block: "center", inline: "center" });
      await new Promise((r) => requestAnimationFrame(r));
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
        out.push(`cannot scroll into view: ${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
        continue;
      }
      const hit = document.elementFromPoint(x, y);
      if (!hit || el === hit || el.contains(hit)) continue;
      if (!inChrome && chrome(hit)) continue; // under the fixed bars at this scroll position; fine
      if (hit.closest("label") && hit.closest("label").htmlFor === el.id) continue;
      out.push(`covered: ${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" by ${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]} "${(hit.textContent || "").trim().slice(0, 30)}"`);
    }
    // Can the last content element scroll clear of the tab bar?
    const tb = document.querySelector(".tabbar");
    const last = [...document.querySelectorAll("main.page > *")].at(-1);
    if (tb && last && getComputedStyle(tb).display !== "none") {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => requestAnimationFrame(r));
      const lb = last.getBoundingClientRect().bottom;
      const tt = tb.getBoundingClientRect().top;
      if (lb > tt + 1) out.push(`last content (bottom ${Math.round(lb)}) hidden behind tab bar (top ${Math.round(tt)})`);
    }
    window.scrollTo(0, 0);
    return out;
  });
}

async function dialogCheck(page, label, vh) {
  const res = await page.evaluate(() => {
    const s = document.querySelector(".sheet");
    if (!s) return ["dialog did not open"];
    const out = [];
    const r = s.getBoundingClientRect();
    const vv = window.visualViewport ?? { width: innerWidth, height: innerHeight };
    if (r.top < -1 || r.bottom > vv.height + 1 || r.left < -1 || r.right > vv.width + 1)
      out.push(`sheet outside viewport: [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}] vs ${vv.width}x${vv.height}`);
    for (const sel of ["button[type=submit]", ".sheet-head h2", ".sheet-head button"]) {
      const b = s.querySelector(sel);
      const br = b.getBoundingClientRect();
      const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      if (!b.contains(hit)) out.push(`${sel} not visible/tappable in dialog`);
    }
    const body = s.querySelector(".sheet-body");
    if (body.scrollHeight > body.clientHeight + 1 && body.clientHeight < 60) out.push(`dialog body only ${body.clientHeight}px tall for ${body.scrollHeight}px content`);
    if (s.scrollWidth > s.clientWidth + 1) out.push("dialog overflows horizontally");
    return out;
  });
  for (const p of res) R.fail(`${label}: ${p}`);
  if (!res.length) R.ok(`${label}: dialog fits (${vh}px)`);
}

const browser = await launch();
const state = await storageState(browser);
const summary = {};
const profiles = quick ? PROFILES.filter(([n]) => /iPhone SE$|Desktop|Zoom|iPad Mini$|landscape/.test(n)) : PROFILES;
let pages;

for (const [name, dev] of profiles) {
  for (const scheme of quick ? ["light"] : ["light", "dark"]) {
    const ctx = await browser.newContext({ ...dev, storageState: state, colorScheme: scheme, locale: "he-IL", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await settle(page);
    pages ??= await routes(page);
    console.log(`\n# ${name} (${scheme})`);
    for (const [pname, hash] of pages) {
      await page.goto(BASE + "/" + hash);
      await settle(page);
      const tag = `${name} ${scheme} ${pname}`;
      const shot = path.join(SHOTS, `${name.replace(/\W+/g, "_")}-${scheme}-${pname}.png`);
      if (!quick && (scheme === "dark" || /iPhone SE$|Desktop|iPad Mini$/.test(name))) await page.screenshot({ path: shot, fullPage: true });
      if (scheme === "light") {
        const probs = [...(await page.evaluate(inspect)), ...(await covered(page))];
        const errs = probs.filter((p) => !p.startsWith("WARN"));
        const warns = probs.filter((p) => p.startsWith("WARN"));
        summary[tag] = { errors: errs.length, warnings: warns.length };
        for (const p of [...new Set(errs)].slice(0, 12)) R.fail(`${tag}: ${p}`);
        for (const w of [...new Set(warns)].slice(0, 6)) console.log(`  warn ${tag}: ${w.slice(5)}`);
        if (!errs.length) R.ok(`${tag}`);
      }
    }

    // Dialogs, incl. on-screen keyboard (viewport height ~450 or less in landscape).
    if (scheme === "light") {
      const vp = page.viewportSize();
      const dialogs = [
        ["settings", "שינוי סיסמה"],
        ["portfolio", "ריצה חדשה"],
        ["live", "המשך לחתימה"],
      ];
      for (const [pname, btn] of dialogs) {
        for (const h of [vp.height, Math.min(vp.height, 450)]) {
          if (h === vp.height && h === 450) continue;
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(BASE + "/" + pages.find(([n]) => n === pname)[1]);
          await settle(page);
          await page.getByRole("button", { name: btn }).first().click();
          await page.locator(".sheet").waitFor();
          if (h !== vp.height) {
            await page.locator(".sheet input, .sheet textarea").first().focus();
            await page.setViewportSize({ width: vp.width, height: h });
            await page.waitForTimeout(150);
          }
          await dialogCheck(page, `${name} dialog "${btn}"${h !== vp.height ? " + keyboard" : ""}`, h);
          await page.keyboard.press("Escape");
          await page.locator(".sheet").waitFor({ state: "detached", timeout: 3000 }).catch(() => R.fail(`${name}: Escape did not close dialog`));
        }
      }
      await page.setViewportSize(vp);
    }
    await ctx.close();
  }
}

// prefers-reduced-motion: no running animations after load; chart line fully drawn.
{
  const ctx = await browser.newContext({ ...devices["Pixel 7"], storageState: state, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(BASE + "/" + pages.find(([n]) => n === "portfolio")[1]);
  await settle(page);
  const r = await page.evaluate(() => {
    const long = document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming?.();
      return t && (t.duration === Infinity || t.duration > 5 || t.delay > 5) && a.playState === "running";
    });
    const line = document.querySelector(".chart .line");
    return { long: long.map((a) => a.animationName ?? a.constructor.name), dash: line ? getComputedStyle(line).strokeDashoffset : "none" };
  });
  R.check(r.long.length === 0, `reduced motion: no long-running animations (${r.long.join(",")})`);
  R.check(r.dash === "0px" || r.dash === "0" || r.dash === "none", `reduced motion: chart line drawn immediately (dashoffset ${r.dash})`);
  await ctx.close();
}

fs.writeFileSync(path.join(OUT, "layout-summary.json"), JSON.stringify(summary, null, 2));
await browser.close();
R.done();
