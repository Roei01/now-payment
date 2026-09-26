type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = /(secret|password|token|key|authorization)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...(redact(fields ?? {}) as object) });
  if (level === "error" || level === "warn") console.error(line);
  else if (process.env.NODE_ENV !== "test" || process.env.LOG_IN_TESTS) console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => (process.env.LOG_DEBUG ? emit("debug", msg, f) : undefined),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
