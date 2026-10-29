import "server-only";

import { appTracer, cockpitProviderRuns } from "lib/observability/instruments";
import logger from "logger";
import { parseReason, reason } from "../reasons";
import type { CockpitProvider, Feed } from "../types";
import { revolutProvider } from "./revolut";
import { isSecretField, PROVIDER_FIELDS } from "./schemas";
import { seoProvider } from "./seo";
import { stripeProvider } from "./stripe";
import { superlogProvider } from "./superlog";
import type {
  CockpitProviderModule,
  ProbeResult,
  ProviderContext,
} from "./types";
import { vercelProvider } from "./vercel";
import { websiteProvider } from "./website";

export const PROVIDERS: Record<
  CockpitProvider,
  CockpitProviderModule<any, any>
> = {
  website: websiteProvider,
  vercel: vercelProvider,
  stripe: stripeProvider,
  revolut: revolutProvider,
  superlog: superlogProvider,
  seo: seoProvider,
};

type Ctx = Omit<ProviderContext, "signal">;

/** Validates a decrypted or merged config; null when it no longer parses. */
export function parseConfig(
  provider: CockpitProvider,
  raw: unknown,
): unknown | null {
  const parsed = PROVIDERS[provider].configSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

type Op = "probe" | "fetch" | "prepare";

/**
 * Runs `fn` with an AbortSignal that fires at the provider's deadline, and
 * resolves to the fallback instead of hanging if `fn` ignores the signal.
 */
async function withDeadline<T>(
  provider: CockpitProvider,
  op: Op,
  ms: number,
  fallback: T,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("cockpit-deadline"));
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([
      fn(controller.signal).catch((error) => {
        // Providers turn their failures into reasons; a throw is a bug.
        // Error name only: a message can echo a provider's response body.
        if (!controller.signal.aborted) {
          logger.error("[cockpit] provider threw", {
            "cockpit.provider": provider,
            "cockpit.op": op,
            "exception.type": error instanceof Error ? error.name : "unknown",
          });
        }
        return fallback;
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Traces one provider call as `cockpit.provider.<op>` and counts its
 * outcome, so the cockpit shows up in Superlog. Records the provider and the
 * reason (built by our code, see `reasons.ts`), never a config value.
 * Failed probes and preparations are user-initiated and logged here; feed
 * refreshes log only when their state changes (`feeds.ts`).
 */
async function traced<T>(
  provider: CockpitProvider,
  op: Op,
  run: () => Promise<T>,
  failure: (result: T) => string | null,
): Promise<T> {
  return appTracer.startActiveSpan(
    `cockpit.provider.${op}`,
    { attributes: { "cockpit.provider": provider } },
    async (span) => {
      try {
        const result = await run();
        const failed = failure(result);
        const outcome = failed ? (parseReason(failed).code ?? "unknown") : "ok";
        span.setAttribute("cockpit.outcome", outcome);
        if (failed) span.setAttribute("cockpit.reason", failed);
        cockpitProviderRuns.add(1, { provider, op, outcome });
        if (failed && op !== "fetch") {
          logger.warn(`[cockpit] ${op} failed`, {
            "cockpit.provider": provider,
            "cockpit.reason": failed,
          });
        }
        return result;
      } finally {
        span.end();
      }
    },
  );
}

export function probeProvider(
  provider: CockpitProvider,
  config: unknown,
  ctx: Ctx = {},
): Promise<ProbeResult> {
  const mod = PROVIDERS[provider];
  return traced(
    provider,
    "probe",
    () =>
      withDeadline<ProbeResult>(
        provider,
        "probe",
        mod.deadlineMs,
        { ok: false, reason: reason("timeout") },
        (signal) => mod.probe(config, { ...ctx, signal }),
      ),
    (r) => (r.ok ? null : r.reason),
  );
}

export function fetchProvider<T>(
  provider: CockpitProvider,
  config: unknown,
  ctx: Ctx = {},
): Promise<Feed<T>> {
  const mod = PROVIDERS[provider];
  return traced(
    provider,
    "fetch",
    () =>
      withDeadline<Feed<T>>(
        provider,
        "fetch",
        mod.deadlineMs,
        { status: "inop", reason: reason("timeout") },
        (signal) => mod.fetch(config, { ...ctx, signal }),
      ),
    (f) => (f.status === "inop" ? f.reason : null),
  );
}

export function prepareProvider(
  provider: CockpitProvider,
  raw: Record<string, unknown>,
  ctx: Ctx = {},
) {
  const mod = PROVIDERS[provider];
  if (!mod.prepare) {
    return Promise.resolve({ ok: true as const, config: raw });
  }
  const prepare = mod.prepare;
  return traced(
    provider,
    "prepare",
    () =>
      withDeadline(
        provider,
        "prepare",
        mod.deadlineMs,
        { ok: false as const, reason: reason("timeout") },
        (signal) => prepare(raw, { ...ctx, signal }),
      ),
    (r) => (r.ok ? null : r.reason),
  );
}

/**
 * Overlays a submitted form on the stored config: a secret field left blank
 * keeps its stored value, so the dialog never has to receive a secret.
 * Transient fields are passed through for `prepare` and never stored.
 */
export function mergeSubmittedConfig(
  provider: CockpitProvider,
  submitted: Record<string, unknown>,
  stored: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of PROVIDER_FIELDS[provider]) {
    const value = submitted[field.name];
    const blank =
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim());
    if (blank && isSecretField(field) && !field.transient && stored) {
      if (stored[field.name] !== undefined)
        out[field.name] = stored[field.name];
      continue;
    }
    if (!blank) out[field.name] = value;
  }
  return out;
}

export type RedactedConfig = {
  /** Non-secret values, for pre-filling the form. */
  values: Record<string, unknown>;
  /** Names of secret fields that hold a value. */
  secretsSet: string[];
};

/** What the API may return about a stored config: never a secret. */
export function redactConfig(
  provider: CockpitProvider,
  config: Record<string, unknown> | null,
): RedactedConfig {
  const values: Record<string, unknown> = {};
  const secretsSet: string[] = [];
  if (!config) return { values, secretsSet };
  for (const field of PROVIDER_FIELDS[provider]) {
    if (field.transient) continue;
    const value = config[field.name];
    if (value === undefined || value === null || value === "") continue;
    if (isSecretField(field)) secretsSet.push(field.name);
    else values[field.name] = value;
  }
  return { values, secretsSet };
}
