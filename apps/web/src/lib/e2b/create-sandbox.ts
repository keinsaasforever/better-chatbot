import {
  AuthenticationError,
  InvalidArgumentError,
  NotFoundError,
  RateLimitError,
  Sandbox,
  type SandboxOpts,
  TemplateError,
  TimeoutError,
} from "@e2b/code-interpreter";
import { getSandboxTemplate } from "lib/e2b/sandbox-registry";
import logger from "lib/logger";

/**
 * Central configuration + hardened helpers for creating E2B sandboxes.
 *
 * All sandbox creation across the app should go through {@link createSandbox}
 * so that retry, error taxonomy, logging and the `secure` decision live in one
 * place instead of being copy-pasted (and drifting) across call sites.
 */

/** TTL for one-shot execution sandboxes (killed immediately after use). */
export const EXEC_SANDBOX_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * TTL a preview sandbox is *created* with.
 *
 * This has to cover the whole setup path before the client can take over
 * heartbeating: dependency install (`INSTALL_TIMEOUT_MS`, 60s) plus readiness
 * polling (`READINESS_BUDGET_MS`, 30s) plus file writes. Creating with the
 * short idle TTL below would let the sandbox pause *mid-setup*, which surfaces
 * as `startup_not_ready` → 504 → the sandbox is killed → the user gets a hard
 * failure instead of a preview. `create-sandbox.test.ts` asserts the headroom.
 */
export const PREVIEW_SETUP_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * TTL a preview sandbox runs on once it is live, and what each heartbeat
 * renews to.
 *
 * Short on purpose. Preview sandboxes are created with
 * `lifecycle: { onTimeout: "pause", autoResume: true }`, so hitting this
 * timeout is not a death — it pauses (free, retained indefinitely, memory
 * intact) and the next request to the preview URL resumes it in about a
 * second. That makes a short TTL nearly invisible to the user while capping
 * what an abandoned preview can cost.
 *
 * Not shorter than 3 min: an auto-resumed sandbox gets a 5-minute minimum
 * timeout from E2B regardless, so cutting further only affects previews that
 * are never resumed, while raising the risk that a couple of dropped
 * heartbeats kill a preview someone is using.
 */
export const PREVIEW_IDLE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * A template serves a public preview when it exposes an HTTP dev-server that we
 * surface in an iframe (everything except the exec-only interpreter template).
 */
export function isPreviewTemplate(template: string): boolean {
  return getSandboxTemplate(template)?.kind === "preview";
}

/**
 * Whether the sandbox controller (envd) traffic should be authenticated.
 *
 * - Preview templates run with `secure: false` **on purpose**: the browser
 *   loads `https://<getHost(port)>` directly in an `<iframe>` and cannot attach
 *   the envd access token, so secured envd would 401 the preview. The exposed
 *   surface is the user-generated app on its own port, not the controller.
 * - Exec-only templates run with the SDK default `secure: true`: we drive them
 *   entirely through the SDK (which carries the token), never expose the host,
 *   so there is no reason to weaken authentication.
 */
export function secureForTemplate(template: string): boolean {
  return !isPreviewTemplate(template);
}

export type SandboxBillingContext = {
  userId: string;
  /** Null when the edition has no billing customer; usage is then untracked. */
  customerId: string | null;
  entityId?: string;
};

export interface CreateSandboxOptions extends SandboxOpts {
  /** Trusted server-side identity copied into E2B lifecycle events. */
  billing: SandboxBillingContext;
  /** Number of create attempts for *retryable* failures. Default 2. */
  maxAttempts?: number;
  /** Base backoff in ms (doubled each attempt). Default 500. */
  backoffMs?: number;
  /** Correlation identifier included in every creation log. */
  requestId?: string;
}

/**
 * HTTP status the SDK encodes at the head of its message ("404: template
 * 'x' not found").
 *
 * Needed because `instanceof` alone does not classify these errors. The SDK
 * reports a missing template as a plain `SandboxError`, and
 * `@e2b/code-interpreter` bundles its own copy of the `e2b` package, so even a
 * typed error thrown inside that copy is a different class identity from the
 * one this module imports. Production proved it: every
 * `404: template 'navigator-python-docs' not found` logged `retryable=true`,
 * burned both attempts, and came back to the user as the generic "Failed to
 * start the sandbox. Please try again." — which reads as a transient outage
 * for a condition that will never clear on its own.
 */
function statusFromError(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const status = /^\s*(\d{3})\s*:/.exec(err.message)?.[1];
  return status ? Number(status) : undefined;
}

/**
 * Whether the requested template does not exist in this E2B account.
 *
 * A typo or an unbuilt image in `E2B_EXECUTION_TEMPLATE` lands here, and it is
 * never transient: retrying cannot build the template.
 */
export function isTemplateNotFound(err: unknown): boolean {
  if (err instanceof NotFoundError || err instanceof TemplateError) return true;
  return statusFromError(err) === 404;
}

/** Errors that will never succeed on retry — fail fast on these. */
function isNonRetryable(err: unknown): boolean {
  return (
    isTemplateNotFound(err) ||
    err instanceof AuthenticationError ||
    err instanceof RateLimitError ||
    err instanceof InvalidArgumentError
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create an E2B sandbox with bounded retry + structured logging.
 *
 * Retries only transient failures (network / 5xx / timeouts);
 * configuration errors (missing template, bad key, bad args) fail immediately.
 */
export async function createSandbox(
  template: string,
  {
    billing,
    maxAttempts = 2,
    backoffMs = 500,
    requestId = "untracked",
    ...opts
  }: CreateSandboxOptions,
): Promise<Sandbox> {
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const sbx = await Sandbox.create(template, {
        secure: secureForTemplate(template),
        // Previews pause instead of dying at timeout, and an inbound request to
        // the sandbox URL wakes them again. Without this a preview was killed
        // outright, so returning to a thread meant a dead 502 host and a fresh
        // sandbox; it also left abandoned sandboxes billing compute for their
        // full TTL. Auto-resume requires a memory snapshot, which is the
        // default — it is rejected alongside keepMemory: false.
        ...(isPreviewTemplate(template)
          ? { lifecycle: { onTimeout: "pause" as const, autoResume: true } }
          : {}),
        ...opts,
        metadata: {
          ...opts.metadata,
          requestId,
          template,
          billingUserId: billing.userId,
          ...(billing.customerId
            ? { billingCustomerId: billing.customerId }
            : {}),
          ...(billing.entityId ? { billingEntityId: billing.entityId } : {}),
        },
      });
      logger.info(
        `[e2b] requestId=${requestId} phase=starting_sandbox template=${template} attempt=${attempt} durationMs=${Date.now() - startedAt} outcome=success sbxId=${sbx.sandboxId}`,
      );
      return sbx;
    } catch (err) {
      lastError = err;
      const retryable = !isNonRetryable(err);
      logger.warn(
        `[e2b] requestId=${requestId} phase=starting_sandbox template=${template} attempt=${attempt}/${maxAttempts} durationMs=${Date.now() - startedAt} outcome=failure retryable=${retryable} error=${errorLabel(err)}`,
      );
      if (!retryable || attempt === maxAttempts) break;
      await delay(backoffMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

/** Short, log-safe label for an unknown error. */
export function errorLabel(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export interface SandboxErrorResponse {
  status: number;
  /** Stable machine-readable code for the client. */
  code: string;
  /** Human-readable, user-safe message. */
  message: string;
  retryable: boolean;
}

/**
 * Map an E2B/SDK error onto an HTTP status + user-safe message so routes can
 * return structured JSON instead of a bare 500.
 */
export function toSandboxErrorResponse(
  err: unknown,
  template?: string,
): SandboxErrorResponse {
  if (isTemplateNotFound(err)) {
    return {
      status: 502,
      code: "template_not_available",
      message: template
        ? `Sandbox template "${template}" is not available in this E2B account. Build/publish it with the E2B CLI or choose a different template.`
        : "Sandbox template is not available in this E2B account.",
      retryable: false,
    };
  }
  if (err instanceof AuthenticationError) {
    return {
      status: 500,
      code: "e2b_auth",
      message:
        "E2B authentication failed. Verify E2B_API_KEY is set correctly.",
      retryable: false,
    };
  }
  if (err instanceof RateLimitError) {
    return {
      status: 429,
      code: "e2b_rate_limit",
      message:
        "E2B rate limit or sandbox quota reached. Please try again shortly.",
      retryable: true,
    };
  }
  if (err instanceof TimeoutError) {
    return {
      status: 504,
      code: "e2b_timeout",
      message: "Timed out starting the sandbox. Please try again.",
      retryable: true,
    };
  }
  if (err instanceof InvalidArgumentError) {
    return {
      status: 400,
      code: "e2b_invalid_argument",
      message: `Invalid sandbox request: ${errorLabel(err)}`,
      retryable: false,
    };
  }
  return {
    status: 500,
    code: "e2b_error",
    message: "Failed to start the sandbox. Please try again.",
    retryable: true,
  };
}

export interface ReadinessResult {
  ready: boolean;
  /** Last HTTP status observed from the preview host, if any. */
  lastStatus?: number;
  /** Short diagnostic when not ready (e.g. tail of the sandbox logs). */
  detail?: string;
}

/**
 * Best-effort wait until a preview template's dev-server responds on `port`.
 *
 * The E2B edge returns 502 while nothing is listening, so we poll `getHost`
 * until we see any non-502 response (the dev server may still be compiling the
 * first request — that is fine, the iframe finishes it). Always returns within
 * `budgetMs`; callers should return the URL regardless and surface `ready`.
 */
export async function waitForSandboxReady(
  sbx: Sandbox,
  port: number,
  budgetMs = 40_000,
): Promise<ReadinessResult> {
  const host = sbx.getHost(port);
  const url = `https://${host}`;
  const deadline = Date.now() + budgetMs;
  let lastStatus: number | undefined;

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      }).finally(() => clearTimeout(t));
      lastStatus = res.status;
      // 502 = edge reached but nothing is listening yet. Anything else means
      // the dev server accepted the connection.
      if (res.status !== 502) {
        return { ready: true, lastStatus };
      }
    } catch {
      // connection refused / abort — keep polling
    }
    await delay(1_500);
  }

  return {
    ready: false,
    lastStatus,
    detail:
      "The app's dev server did not start listening in time. The template may not auto-start a server on this port.",
  };
}
