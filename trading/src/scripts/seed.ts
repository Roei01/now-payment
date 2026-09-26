import { getPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";
import { bootstrap } from "../setup/bootstrap.js";
import { fxFromConfig, marketFromConfig } from "../app/deps.js";

await migrate(getPool());
console.log((await bootstrap(getPool(), fxFromConfig(), marketFromConfig().name)).join("\n") || "already seeded");
await closePool();
