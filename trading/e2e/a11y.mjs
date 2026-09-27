// axe-core accessibility audit of every page (light + dark) and an open dialog.
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, launch, login, routes } from "./lib.mjs";

const axeSrc = fs.readFileSync(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");
const browser = await launch();
const results = [];
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: "he-IL", bypassCSP: true });
  const page = await ctx.newPage();
  await login(page);
  for (const [name, hash] of await routes(page)) {
    await page.goto(BASE + "/" + hash);
    await page.waitForTimeout(1200);
    await page.addScriptTag({ content: axeSrc });
    const res = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations);
    for (const v of res) results.push({ scheme, page: name, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") });
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, "a11y.json"), JSON.stringify(results, null, 2));
const serious = results.filter((v) => v.impact === "serious" || v.impact === "critical");
for (const v of results) console.log(`${v.impact.padEnd(9)} ${v.scheme.padEnd(5)} ${v.page.padEnd(10)} ${v.id} (${v.nodes}) — ${v.help} — ${v.sample}`);
console.log(`a11y: ${results.length} violations, ${serious.length} serious/critical`);
process.exit(serious.length ? 1 : 0);
