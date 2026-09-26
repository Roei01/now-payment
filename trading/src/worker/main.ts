import { config } from "../config.js";
import { closePool, getPool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { cycleDepsFromConfig, fxFromConfig } from "../app/deps.js";
import { bootstrap } from "../setup/bootstrap.js";
import { tick } from "./scheduler.js";
import { errMsg, log } from "../lib/logger.js";

let stopping = false;

async function main() {
  const c = config();
  const pool = getPool();
  await migrate(pool, (m) => log.info(m));
  await bootstrap(pool, fxFromConfig());
  const deps = cycleDepsFromConfig(pool);
  log.info("worker started", { market: deps.market.name, tickSeconds: c.WORKER_TICK_SECONDS });
  while (!stopping) {
    const started = Date.now();
    try {
      await tick(deps);
    } catch (err) {
      log.error("tick failed", { error: errMsg(err) });
    }
    const wait = Math.max(1000, c.WORKER_TICK_SECONDS * 1000 - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  await closePool();
  log.info("worker stopped");
}

for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, () => {
    log.info(`received ${sig}, finishing current tick`);
    stopping = true;
  });

main().catch((err) => {
  log.error("worker crashed", { error: errMsg(err) });
  process.exit(1);
});
