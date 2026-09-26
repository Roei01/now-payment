// Dev helper: fills a database with N weekdays of simulated cycles so the UI has history.
import { getPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { bootstrap } from "../setup/bootstrap.js";
import { cycleDepsFromConfig, fxFromConfig, marketFromConfig } from "../app/deps.js";
import { runCycle } from "../engine/cycle.js";

const days = Number(process.argv[2] ?? 30);
const pool = getPool();
await migrate(pool, () => undefined);
const start = new Date(Date.now() - days * 1.45 * 86_400_000);
await bootstrap(pool, fxFromConfig(), marketFromConfig().name, start);
const deps = cycleDepsFromConfig(pool);
for (let d = new Date(start); d < new Date(); d = new Date(d.getTime() + 86_400_000)) {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) continue;
  const at = new Date(`${d.toISOString().slice(0, 10)}T15:30:00Z`);
  if (at > new Date()) break;
  const r = await runCycle(deps, at);
  process.stdout.write(`${at.toISOString().slice(0, 10)} ${r.orders} orders\n`);
}
await closePool();
