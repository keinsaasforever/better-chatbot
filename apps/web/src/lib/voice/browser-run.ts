import "server-only";
import { getModelInstance } from "lib/ai/models";
import { createBrowserAutomationTool } from "lib/ai/tools/browser/browser-automation-tool";
import { browserCredentialRepository } from "lib/db/repository";
import { resolveBrowserCredentials } from "lib/kernel/credential-vault";
import { toReadOnlyLiveViewUrl } from "lib/kernel/browser-contract";
import logger from "logger";
import type { VoiceBrowserActor } from "./browser-gate";
import {
  VOICE_BROWSER_MAX_RUN_MS,
  type VoiceBrowserFrame,
} from "./browser-run-contract";
import { VOICE_COMMAND_MODEL } from "./run-transcript-command";

/**
 * A browser run driven from the realtime voice session.
 *
 * Wraps `createBrowserAutomationTool` rather than reimplementing it, so the
 * Kernel lifecycle, the credential vault, secret redaction and BOTH billing
 * calls stay in exactly one place. Voice differs from chat only in what it
 * needs on the wire and in who is watching, so everything here is framing and
 * gating, never browser logic.
 */

/** Tool-call parts on the inner agent's message, i.e. steps taken so far. */
function countSteps(message: unknown): number {
  const parts = (message as { parts?: unknown } | undefined)?.parts;
  if (!Array.isArray(parts)) return 0;
  return parts.filter(
    (part) =>
      typeof (part as { type?: unknown })?.type === "string" &&
      (part as { type: string }).type.startsWith("tool-"),
  ).length;
}

/**
 * Run a browser task and yield frames for the voice client.
 *
 * The live-view URL is made read-only HERE rather than in the panel, so the
 * interactive URL never leaves the server. Voice is a watch-only surface: the
 * user is talking, not driving, and Kernel's live view grants full control to
 * anyone who loads it.
 */
export async function* runVoiceBrowserTask(input: {
  actor: VoiceBrowserActor;
  task: string;
  /** The realtime function call id. Doubles as the billing `runId`. */
  callId: string;
  credentialAlias?: string;
  customerId?: string;
  entityId?: string;
  abortSignal?: AbortSignal;
}): AsyncGenerator<VoiceBrowserFrame> {
  const { actor, task, callId, credentialAlias, customerId, entityId } = input;

  const credentials = await resolveBrowserCredentials({
    organizationId: actor.organizationId,
    aliases: await browserCredentialRepository
      .selectAliasesForOrganization(actor.organizationId ?? "")
      .catch(() => []),
  });

  const model = await getModelInstance(VOICE_COMMAND_MODEL, actor.userId);

  const tool = createBrowserAutomationTool({
    model,
    customerId,
    entityId,
    organizationId: actor.organizationId ?? undefined,
    modelId: `${VOICE_COMMAND_MODEL.provider}/${VOICE_COMMAND_MODEL.model}`,
    // A person IS present, so the agent should stop at a wall rather than
    // improvise, and the browser stays interactive-mode in every other respect.
    unattended: false,
    credentials,
    onCredentialUsed: (aliases) => {
      if (!actor.organizationId) return;
      void browserCredentialRepository
        .touchLastUsed(actor.organizationId, aliases)
        .catch(() => {
          // Best-effort bookkeeping; never fail a run for it.
        });
    },
  });

  // Interactive chat runs are uncapped because a user watching a thread can
  // stop one. Voice needs its own clock: starting a run costs one sentence and
  // a headful browser bills 128 credits a second. `execute` threads this into
  // the inner agent and its `finally` still tears the browser down.
  const runTimeout = AbortSignal.timeout(VOICE_BROWSER_MAX_RUN_MS);
  const abortSignal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, runTimeout])
    : runTimeout;

  const execute = tool.execute;
  if (!execute) {
    // Unreachable: the factory always supplies a generator `execute`. Guarded
    // because the AI SDK types it optional, and yielding a frame beats a throw
    // that would close the stream with no terminal frame.
    yield { status: "failed", error: "The browser tool is not executable." };
    return;
  }

  try {
    // The tool only reads `toolCallId` and `abortSignal`; the rest of the AI
    // SDK's `ToolCallOptions` is not consulted on this path, and `execute` is
    // typed as possibly returning a promise even though this one is a
    // generator. Both casts are load-bearing only for the type checker.
    const stream = execute({ task, credentialAlias }, {
      toolCallId: callId,
      abortSignal,
    } as unknown as Parameters<typeof execute>[1]) as unknown as AsyncIterable<
      Record<string, unknown>
    >;

    for await (const output of stream) {
      const frame = toFrame(output);
      if (frame) yield frame;
    }
  } catch (error) {
    // The tool handles its own failures and yields `failed`, so reaching here
    // means the generator itself broke. Never let the stream end without a
    // terminal frame: the client reads that as a dead run either way, but this
    // gives the model something to say.
    logger.error(
      "[voice-browser] run failed",
      error instanceof Error ? error.message : error,
    );
    yield { status: "failed", error: "The browser run stopped unexpectedly." };
  }
}

/**
 * `BrowserToolOutput` to the voice wire format.
 *
 * Drops the inner agent's `UIMessage` in favour of a step count, and makes
 * every live-view URL read-only. Returns `null` for the legacy `awaiting-user`
 * state, which nothing produces any more.
 */
function toFrame(output: Record<string, unknown>): VoiceBrowserFrame | null {
  const status = output.status;
  const sessionId =
    typeof output.sessionId === "string" ? output.sessionId : "";
  const liveViewUrl =
    typeof output.liveViewUrl === "string"
      ? toReadOnlyLiveViewUrl(output.liveViewUrl)
      : undefined;

  switch (status) {
    case "starting":
      return liveViewUrl
        ? { status: "starting", sessionId, liveViewUrl }
        : null;
    case "running":
      return liveViewUrl
        ? {
            status: "running",
            sessionId,
            liveViewUrl,
            stepCount: countSteps(output.message),
          }
        : null;
    case "done":
      return {
        status: "done",
        sessionId,
        liveViewUrl: liveViewUrl ?? "",
        summary: typeof output.summary === "string" ? output.summary : "",
        stepCount: typeof output.stepCount === "number" ? output.stepCount : 0,
      };
    case "blocked":
      return {
        status: "blocked",
        sessionId,
        liveViewUrl,
        reason: typeof output.reason === "string" ? output.reason : "",
        summary: typeof output.summary === "string" ? output.summary : "",
        stepCount: typeof output.stepCount === "number" ? output.stepCount : 0,
      };
    case "failed":
      return {
        status: "failed",
        ...(sessionId ? { sessionId } : {}),
        error:
          typeof output.error === "string"
            ? output.error
            : "The browser task failed.",
      };
    default:
      return null;
  }
}
