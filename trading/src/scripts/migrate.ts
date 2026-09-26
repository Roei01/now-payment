import { getPool, closePool } from "../db/pool.js";
import { migrate } from "../db/migrate.js";

const applied = await migrate(getPool());
console.log(applied.length ? `applied: ${applied.join(", ")}` : "schema up to date");
await closePool();
