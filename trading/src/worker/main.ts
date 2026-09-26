import { config } from "../config.js";
import { closePool, getPool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { cycleDepsFromConfig, fxFromConfig, marketFromConfig } from "../app/deps.js";
import { bootstrap } from "../setup/bootstrap.js";
import { startWorkerLoop } from "./loop.js";
import { errMsg, log } from "../lib/logger.js";

async function main() {
  const c = config();
  const pool = getPool();
  await migrate(pool, (m) => log.info(m));
  await bootstrap(pool, fxFromConfig(), marketFromConfig().name);
  const loop = startWorkerLoop(cycleDepsFromConfig(pool), c.WORKER_TICK_SECONDS);
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.on(sig, async () => {
      log.info(`received ${sig}, finishing current tick`);
      await loop.stop();
      await closePool();
      process.exit(0);
    });
}

main().catch((err) => {
  log.error("worker crashed", { error: errMsg(err) });
  process.exit(1);
});
