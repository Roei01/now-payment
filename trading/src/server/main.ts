import { config } from "../config.js";
import { getPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { bootstrap } from "../setup/bootstrap.js";
import { cycleDepsFromConfig, fxFromConfig, marketFromConfig } from "../app/deps.js";
import { startWorkerLoop } from "../worker/loop.js";
import { buildApp } from "./app.js";
import { errMsg, log } from "../lib/logger.js";

async function main() {
  const c = config();
  const pool = getPool();
  await migrate(pool, (m) => log.info(m));
  await bootstrap(pool, fxFromConfig(), marketFromConfig().name);
  const app = await buildApp(pool);
  await app.listen({ port: c.PORT, host: "0.0.0.0" });
  log.info("api listening", { port: c.PORT, workerInProcess: c.RUN_WORKER_IN_WEB });
  const loop = c.RUN_WORKER_IN_WEB ? startWorkerLoop(cycleDepsFromConfig(pool), c.WORKER_TICK_SECONDS) : undefined;
  const shutdown = async () => {
    await loop?.stop();
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error("api crashed", { error: errMsg(err) });
  process.exit(1);
});
