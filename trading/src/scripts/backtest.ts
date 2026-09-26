import { getPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { bootstrap } from "../setup/bootstrap.js";
import { fxFromConfig, marketFromConfig } from "../app/deps.js";
import { latestVersion } from "../strategies/registry.js";
import { runStoredBacktest } from "../backtest/service.js";

const [code = "TREND_ROTATION", start = "2025-01-01", end = new Date().toISOString().slice(0, 10), split = "FULL"] = process.argv.slice(2);
const pool = getPool();
await migrate(pool);
await bootstrap(pool, fxFromConfig(), marketFromConfig().name);
const v = await latestVersion(pool, code);
if (!v) throw new Error(`unknown strategy ${code}`);
const { id, result } = await runStoredBacktest(pool, marketFromConfig(), { strategyVersionId: v.id, start, end, split: split as "FULL" });
const { equity, ...summary } = result;
console.log(JSON.stringify({ id, ...summary, points: equity.length }, null, 2));
await closePool();
