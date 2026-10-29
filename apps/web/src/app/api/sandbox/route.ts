import { createHash } from "node:crypto";
import { Sandbox } from "@e2b/code-interpreter";
import { withAuth } from "auth/route-guard";
import { pgSandboxSessionRepository } from "lib/db/pg/repositories/sandbox-session-repository.pg";
import {
  PREVIEW_IDLE_TIMEOUT_MS,
  PREVIEW_SETUP_TIMEOUT_MS,
  createSandbox,
  errorLabel,
  toSandboxErrorResponse,
  waitForSandboxReady,
} from "lib/e2b/create-sandbox";
import {
  collectSandboxFilePaths,
  sanitizeNextJsRouteConflicts,
} from "lib/e2b/nextjs-route-sanitizer";
import type {
  SandboxApiResponse,
  SandboxDeploymentPhase,
} from "lib/e2b/sandbox-contract";
import {
  getEnabledPreviewTemplate,
  getSandboxTemplate,
} from "lib/e2b/sandbox-registry";
import logger from "lib/logger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBillingContext } from "@/lib/gate";

export const maxDuration = 180;

const CREATE_REQUEST_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 60_000;
const READINESS_BUDGET_MS = 30_000;

const fragmentSchema = z.object({
  template: z.string().min(1),
  file_path: z.string().min(1),
  code: z.union([
    z.string(),
    z.array(
      z.object({
        file_path: z.string().min(1),
        file_content: z.string(),
      }),
    ),
  ]),
  port: z.number().int().positive().max(65_535).nullable().optional(),
  has_additional_dependencies: z.boolean().optional(),
  install_dependencies_command: z.string().optional(),
});

const requestSchema = z.object({
  fragment: fragmentSchema,
  toolCallId: z.string().min(1).max(256),
  requestId: z.string().uuid().optional(),
  /** Scopes sandbox reuse. Optional so an unthreaded deploy still works. */
  threadId: z.string().uuid().optional(),
});

/**
 * How stale a thread's sandbox may be before a new deploy starts fresh.
 *
 * Long enough to cover a working session (reopen a thread after lunch and keep
 * the same preview), short enough that a thread revisited days later does not
 * resume a filesystem full of forgotten state.
 */
const SANDBOX_REUSE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Stable fingerprint of an install command, so an unchanged reuse skips it. */
function hashInstallCommand(command: string | undefined): string | null {
  if (!command) return null;
  return createHash("sha256").update(command).digest("hex");
}

/**
 * Persist the sandbox and pause anything it supersedes.
 *
 * Entirely best-effort: this runs after the preview is confirmed working, so a
 * bookkeeping failure must never turn a ready preview into an error. The cost
 * of losing it is one sandbox the reaper picks up later.
 */
async function persistAndSupersede(input: {
  sandboxId: string;
  threadId?: string;
  toolCallId: string;
  userId: string;
  organizationId: string | null;
  template: string;
  port: number;
  url: string;
  installCommandHash: string | null;
  requestId: string;
}): Promise<void> {
  try {
    await pgSandboxSessionRepository.upsert({
      sandboxId: input.sandboxId,
      threadId: input.threadId ?? null,
      toolCallId: input.toolCallId,
      userId: input.userId,
      organizationId: input.organizationId,
      template: input.template,
      port: input.port,
      url: input.url,
      installCommandHash: input.installCommandHash,
    });

    if (!input.threadId) return;

    const superseded = await pgSandboxSessionRepository.listSuperseded({
      threadId: input.threadId,
      template: input.template,
      keepSandboxId: input.sandboxId,
    });

    await Promise.allSettled(
      superseded.slice(0, MAX_SUPERSEDED_PAUSES).map(async (row) => {
        await Sandbox.pause(row.sandboxId, {
          apiKey: process.env.E2B_API_KEY,
        });
        await pgSandboxSessionRepository.markState(row.sandboxId, "paused");
      }),
    );
  } catch (error) {
    logger.warn(
      `[e2b] requestId=${input.requestId} sandbox bookkeeping failed sbxId=${input.sandboxId} error=${errorLabel(error)}`,
    );
  }
}

/** Bounds the post-deploy sweep so one request can't fan out unboundedly. */
const MAX_SUPERSEDED_PAUSES = 10;

type FailurePhase = Exclude<SandboxDeploymentPhase, "failed" | "ready">;

class SandboxPhaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
    readonly failedPhase: FailurePhase,
  ) {
    super(message);
    this.name = "SandboxPhaseError";
  }
}

function apiResponse(
  body: SandboxApiResponse,
  status = 200,
): NextResponse<SandboxApiResponse> {
  return NextResponse.json(body, { status });
}

function failureResponse(
  requestId: string,
  code: string,
  error: string,
  retryable: boolean,
  status: number,
  failedPhase: FailurePhase,
): NextResponse<SandboxApiResponse> {
  return apiResponse(
    {
      requestId,
      phase: "failed",
      failedPhase,
      code,
      retryable,
      error,
    },
    status,
  );
}

function logPhase({
  requestId,
  template,
  phase,
  startedAt,
  outcome,
  detail,
}: {
  requestId: string;
  template: string;
  phase: FailurePhase | "ready";
  startedAt: number;
  outcome: "accepted" | "success" | "failure";
  detail?: string;
}) {
  const message =
    `[e2b] requestId=${requestId} phase=${phase} template=${template} ` +
    `attempt=1 durationMs=${Date.now() - startedAt} outcome=${outcome}` +
    (detail ? ` ${detail}` : "");
  if (outcome === "failure") logger.error(message);
  else logger.info(message);
}

export const POST = withAuth(async (req, session) => {
  const startedAt = Date.now();
  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  const requestId =
    parsed.success && parsed.data.requestId
      ? parsed.data.requestId
      : crypto.randomUUID();
  const template = parsed.success ? parsed.data.fragment.template : "unknown";

  if (!parsed.success) {
    logPhase({
      requestId,
      template,
      phase: "generating_code",
      startedAt,
      outcome: "failure",
      detail: "code=invalid_payload",
    });
    return failureResponse(
      requestId,
      "invalid_payload",
      "Invalid sandbox payload",
      false,
      400,
      "generating_code",
    );
  }

  const { fragment, toolCallId, threadId } = parsed.data;
  logPhase({
    requestId,
    template,
    phase: "starting_sandbox",
    startedAt,
    outcome: "accepted",
    detail: `toolCallId=${toolCallId}`,
  });

  if (!process.env.E2B_API_KEY) {
    logPhase({
      requestId,
      template,
      phase: "starting_sandbox",
      startedAt,
      outcome: "failure",
      detail: "code=e2b_not_configured retryable=false",
    });
    return failureResponse(
      requestId,
      "e2b_not_configured",
      "E2B_API_KEY is not configured",
      false,
      500,
      "starting_sandbox",
    );
  }

  const registeredTemplate = getSandboxTemplate(template);
  const previewTemplate = getEnabledPreviewTemplate(template);
  if (!previewTemplate) {
    const code =
      registeredTemplate?.kind === "execution"
        ? "execution_template_not_allowed"
        : registeredTemplate
          ? "template_disabled"
          : "unknown_template";
    const error =
      registeredTemplate?.kind === "execution"
        ? `"${template}" is execution-only and cannot produce a preview.`
        : registeredTemplate
          ? `Sandbox template "${template}" is temporarily disabled.`
          : `Unknown sandbox template "${template}".`;
    logPhase({
      requestId,
      template,
      phase: "starting_sandbox",
      startedAt,
      outcome: "failure",
      detail: `code=${code} retryable=false`,
    });
    return failureResponse(
      requestId,
      code,
      error,
      false,
      400,
      "starting_sandbox",
    );
  }

  let sbx: Sandbox | undefined;
  let phase: FailurePhase = "starting_sandbox";
  let reused = false;
  const installCommandHash = hashInstallCommand(
    fragment.has_additional_dependencies
      ? fragment.install_dependencies_command
      : undefined,
  );

  try {
    const billing = await requireBillingContext();

    // Reuse the thread's existing sandbox rather than starting another one.
    // Every tool call used to create its own, so an iterated thread ran N
    // sandboxes concurrently, each billing until its TTL expired. Reuse also
    // removes the cold start (and, below, the dependency install) from every
    // edit after the first.
    const reusable = threadId
      ? await pgSandboxSessionRepository
          .findReusable({
            threadId,
            template,
            userId: session.user.id,
            maxAgeMs: SANDBOX_REUSE_MAX_AGE_MS,
          })
          .catch(() => undefined)
      : undefined;

    if (reusable) {
      try {
        // connect() resumes the sandbox if it is paused, which is the normal
        // case here. It only ever extends a deadline, never shortens one, so
        // the TTL is set explicitly once the preview is confirmed ready.
        sbx = await Sandbox.connect(reusable.sandboxId, {
          apiKey: process.env.E2B_API_KEY,
          requestTimeoutMs: CREATE_REQUEST_TIMEOUT_MS,
        });
        reused = true;
        logPhase({
          requestId,
          template,
          phase: "starting_sandbox",
          startedAt,
          outcome: "success",
          detail: `reused=true sbxId=${reusable.sandboxId}`,
        });
      } catch (error) {
        // Killed, expired, or otherwise unreachable. Forget it and start
        // fresh rather than failing a deploy over a stale row.
        logger.warn(
          `[e2b] requestId=${requestId} reuse failed sbxId=${reusable.sandboxId} error=${errorLabel(error)}`,
        );
        await pgSandboxSessionRepository
          .markState(reusable.sandboxId, "killed")
          .catch(() => {});
      }
    }

    if (!sbx) {
      sbx = await createSandbox(template, {
        apiKey: process.env.E2B_API_KEY,
        metadata: {
          requestId,
          template,
          toolCallId,
        },
        billing: {
          userId: session.user.id,
          customerId: billing.customerId,
          entityId: billing.entityId,
        },
        timeoutMs: PREVIEW_SETUP_TIMEOUT_MS,
        requestTimeoutMs: CREATE_REQUEST_TIMEOUT_MS,
        maxAttempts: 2,
        requestId,
      });
    }

    // A reused sandbox already has the dependencies from last time, so only
    // reinstall when the command actually changed. This is where reuse pays
    // for itself — it skips up to a minute of npm per iteration.
    const installAlreadySatisfied =
      reused &&
      installCommandHash !== null &&
      reusable?.installCommandHash === installCommandHash;

    if (
      fragment.has_additional_dependencies &&
      fragment.install_dependencies_command &&
      !installAlreadySatisfied
    ) {
      phase = "installing";
      const phaseStartedAt = Date.now();
      try {
        await sbx.commands.run(fragment.install_dependencies_command, {
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
      } catch (error) {
        throw new SandboxPhaseError(
          "install_failed",
          `Dependency installation failed: ${errorLabel(error)}`,
          true,
          502,
          phase,
        );
      }
      logPhase({
        requestId,
        template,
        phase,
        startedAt: phaseStartedAt,
        outcome: "success",
      });
    }

    const filePaths = collectSandboxFilePaths(
      fragment.file_path,
      fragment.code,
    );
    await sanitizeNextJsRouteConflicts(sbx, template, filePaths);

    if (Array.isArray(fragment.code)) {
      await Promise.all(
        fragment.code.map((file) =>
          sbx?.files.write(file.file_path, file.file_content),
        ),
      );
    } else {
      await sbx.files.write(fragment.file_path, fragment.code);
    }

    phase = "checking_preview";
    const readinessStartedAt = Date.now();
    const port = fragment.port ?? previewTemplate.defaultPort ?? 3000;
    const readiness = await waitForSandboxReady(sbx, port, READINESS_BUDGET_MS);

    if (!readiness.ready) {
      throw new SandboxPhaseError(
        "startup_not_ready",
        readiness.detail ?? "The preview server did not become ready in time.",
        true,
        504,
        phase,
      );
    }

    logPhase({
      requestId,
      template,
      phase,
      startedAt: readinessStartedAt,
      outcome: "success",
      detail: `status=${readiness.lastStatus ?? "n/a"}`,
    });

    // Setup is done and the client takes over heartbeating from here, so drop
    // the generous setup TTL to the short idle one. `setTimeout` is the only
    // call that can *shorten* a deadline — `connect` only ever extends it.
    // Best-effort: failing here costs one extra minute of TTL, which is not
    // worth turning a ready preview into an error.
    await Sandbox.setTimeout(sbx.sandboxId, PREVIEW_IDLE_TIMEOUT_MS, {
      apiKey: process.env.E2B_API_KEY,
    }).catch((error) => {
      logger.warn(
        `[e2b] requestId=${requestId} could not shorten TTL sbxId=${sbx?.sandboxId} error=${errorLabel(error)}`,
      );
    });

    // Record the sandbox so later tool calls in this thread reuse it, the
    // heartbeat can authorize against it, and the reaper can find it if this
    // browser never gets to pause it.
    await persistAndSupersede({
      sandboxId: sbx.sandboxId,
      threadId,
      toolCallId,
      userId: session.user.id,
      organizationId: session.session?.activeOrganizationId ?? null,
      template,
      port,
      url: `https://${sbx.getHost(port)}`,
      installCommandHash,
      requestId,
    });

    logPhase({
      requestId,
      template,
      phase: "ready",
      startedAt,
      outcome: "success",
      detail: `sbxId=${sbx.sandboxId} reused=${reused}`,
    });

    return apiResponse({
      requestId,
      phase: "ready",
      code: "sandbox_ready",
      retryable: false,
      sbxId: sbx.sandboxId,
      template,
      url: `https://${sbx.getHost(port)}`,
      ready: true,
    });
  } catch (error) {
    if (sbx) {
      if (reused) {
        // Never kill a reused sandbox on a transient failure — it holds the
        // user's last working preview, and killing it is unrecoverable.
        // Pausing costs nothing and keeps the filesystem and memory intact.
        await Sandbox.pause(sbx.sandboxId, {
          apiKey: process.env.E2B_API_KEY,
        }).catch(() => {});
        await pgSandboxSessionRepository
          .markState(sbx.sandboxId, "paused")
          .catch(() => {});
      } else {
        await sbx.kill().catch(() => {});
        await pgSandboxSessionRepository
          .markState(sbx.sandboxId, "killed")
          .catch(() => {});
      }
    }

    const mapped =
      error instanceof SandboxPhaseError
        ? error
        : {
            ...toSandboxErrorResponse(error, template),
            error: undefined,
            failedPhase: phase,
          };
    const code = mapped.code;
    const message =
      error instanceof SandboxPhaseError ? error.message : mapped.message;
    const status = mapped.status;
    const retryable = mapped.retryable;
    const failedPhase =
      error instanceof SandboxPhaseError ? error.failedPhase : phase;

    logPhase({
      requestId,
      template,
      phase: failedPhase,
      startedAt,
      outcome: "failure",
      detail:
        `code=${code} retryable=${retryable} ` + `error=${errorLabel(error)}`,
    });

    return failureResponse(
      requestId,
      code,
      message,
      retryable,
      status,
      failedPhase,
    );
  }
});
