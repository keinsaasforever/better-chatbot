import "server-only";

import { errorReason, httpReason, reason } from "../reasons";

export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
  ) {
    super(`provider HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

/**
 * GET/POST a provider's JSON API. Non-2xx statuses become a
 * `ProviderHttpError` carrying a reason code; the response body is never
 * surfaced, so nothing a provider echoes (keys, account names) can leak into
 * a reason or a log line.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) {
    // Drain the body so the connection can be reused.
    await res.arrayBuffer().catch(() => null);
    throw new ProviderHttpError(res.status, httpReason(res.status));
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderHttpError(res.status, reason("invalidResponse"));
  }
}

/** Reason code for anything a provider call threw. */
export function toReason(error: unknown): string {
  if (error instanceof ProviderHttpError) return error.reason;
  return errorReason(error);
}
