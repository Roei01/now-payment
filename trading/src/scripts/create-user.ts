import { getPool, closePool, query } from "../db/pool.js";
import { hashPassword } from "../lib/crypto.js";

const [email, password, role = "owner"] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error("usage: create-user <email> <password(min 12 chars)> [owner|viewer]");
  process.exit(1);
}
await query(
  getPool(),
  `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
  [email.toLowerCase(), hashPassword(password), role],
);
console.log(`user ${email} (${role}) saved`);
await closePool();
