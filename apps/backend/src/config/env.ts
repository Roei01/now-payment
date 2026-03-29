import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config();

const currentFilePath = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFilePath), "../..");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  BASE_URL: z.string().url(),
  BACKEND_URL: z.string().url(),
  NOWPAYMENTS_API_KEY: z.string().min(1),
  NOWPAYMENTS_IPN_SECRET: z.string().min(1),
  GREEN_API_KEY: z.string().min(1),
  GREEN_API_SECRET: z.string().min(1),
  GOOGLE_CLIENT_EMAIL: z.string().min(1),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_SHEET_ID: z.string().min(1),
});

const parsedEnv = envSchema.parse({
  ...process.env,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
});

export const env = {
  ...parsedEnv,
  backendRoot,
  paymentStorePath: path.join(backendRoot, "data", "payments.json"),
};
