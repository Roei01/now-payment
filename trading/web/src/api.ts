import { apiError } from "./i18n";

let csrf = "";

export function setCsrf(token: string) {
  csrf = token;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.method && opts.method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, apiError((e as Error).message), {});
  }
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: res.statusText };
  }
  if (!res.ok) {
    const issues = Array.isArray(body.issues) && body.issues.length ? ` (${body.issues.join("; ")})` : "";
    throw new ApiError(res.status, apiError(String(body.error ?? res.statusText)) + issues, body);
  }
  return body as T;
}
