import { loadConfig, setConfigForTests } from "../src/config.js";
import { getPool, closePool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/trading_test";

export function testConfig(overrides: Record<string, string> = {}) {
  const cfg = loadConfig({
    DATABASE_URL: TEST_DB,
    APP_SECRET: "test-secret-test-secret-test-secret-000",
    SETUP_TOKEN: "setup-token",
    NODE_ENV: "test",
    ...overrides,
  } as NodeJS.ProcessEnv);
  setConfigForTests(cfg);
  return cfg;
}

/** Fresh schema per test file. */
export async function freshDb() {
  testConfig();
  await closePool();
  const pool = getPool();
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await migrate(pool, () => undefined);
  return pool;
}

export { closePool };
