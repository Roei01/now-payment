import { getPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { bootstrap } from "../setup/bootstrap.js";
import { cycleDepsFromConfig, fxFromConfig } from "../app/deps.js";
import { runCycle } from "../engine/cycle.js";

const pool = getPool();
await migrate(pool);
await bootstrap(pool, fxFromConfig());
const at = process.argv[2] ? new Date(process.argv[2]) : new Date();
console.log(JSON.stringify(await runCycle(cycleDepsFromConfig(pool), at), null, 2));
await closePool();
