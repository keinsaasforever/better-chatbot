import "server-only";
import globalLogger from "logger";
import { minimalToolExecutionOptions } from "@/lib/ai/tools/minimal-tool-execution-options";
import { VoiceActor, VoiceToolExecutionResult } from "./types";

const logger = globalLogger.withDefaults({ message: "Voice Composio: " });

/**
 * How long a Composio call may take before the voice session gives up on it.
 *
 * Shorter than `askAgent`'s budget because nothing else is happening: the
 * realtime model has issued a function call and will sit silent until it is
 * answered. A Tool Router action that has not come back in 30s is better
 * reported as slow — the model can say so and retry — than left hanging.
 */
const COMPOSIO_EXECUTE_TIMEOUT_MS = 30_000;

/**
 * Cap on the serialized tool output handed back to the realtime model.
 *
 * The Tool Router's own results are the biggest thing the voice session will
 * ever see: a schema fetch or a mailbox listing runs to kilobytes, and every
 * function output stays in the conversation and is re-sent on every following
 * turn. Capping here rather than in the route because this is the path that
 * introduces the risk; MCP outputs have always gone through uncapped.
 */
const COMPOSIO_MAX_OUTPUT_CHARS = 12_000;

/**
 * Returns the output as-is when it is small enough, and a truncated stand-in
 * when it is not — never silently cut JSON, which the model would try to parse.
 */
function capOutput(output: unknown): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(output ?? null);
  } catch {
    return { error: "The integration returned something unreadable." };
  }
  if (serialized.length <= COMPOSIO_MAX_OUTPUT_CHARS) return output;
  return {
    truncated: true,
    note: "Too long to return in full. Summarize what is here, or narrow the request and call again.",
    preview: serialized.slice(0, COMPOSIO_MAX_OUTPUT_CHARS),
  };
}

function errorResult(
  toolName: string,
  message: string,
  code: string,
  callId?: string,
): VoiceToolExecutionResult {
  return {
    ok: false,
    toolName,
    callId,
    output: null,
    error: { message, code },
  };
}

/**
 * Run one Composio Tool Router meta-tool for a voice session.
 *
 * The realtime session is given the same four meta-tools the chat route binds
 * (search / execute / manage connections), so a voice user reaches every
 * connected app through them. They are AI SDK tools, so execution is just
 * `tool.execute` with the ad-hoc options every other out-of-`streamText` call
 * site uses.
 *
 * `loadComposioTools` is imported dynamically for the same reason `askAgent`
 * does it: `shared.chat` is a barrel that drags in the workflow executor and
 * every chat tool, a module graph the device transcript path has no use for.
 */
export async function executeComposioVoiceTool({
  toolName,
  args,
  actor,
  callId,
}: {
  toolName: string;
  args: unknown;
  actor: VoiceActor;
  callId?: string;
}): Promise<VoiceToolExecutionResult> {
  const { loadComposioTools } = await import("@/app/api/chat/shared.chat");
  // Cached per user with the same TTL the chat route uses, so this is normally
  // a map lookup rather than a round trip to Composio.
  const tools: Record<string, unknown> = await loadComposioTools(
    actor.userId,
  ).catch(() => ({}));
  const tool = tools[toolName] as { execute?: unknown } | undefined;

  if (!tool || typeof tool.execute !== "function") {
    // Either the user disconnected everything since the session was prepared,
    // or the Tool Router renamed a tool. Both read the same to the model, and
    // both are recoverable by answering something else.
    return errorResult(
      toolName,
      "That integration tool is not available right now.",
      "unavailable",
      callId,
    );
  }

  // Counted the same way the chat route counts its Composio calls
  // (`meterToolCalls`), so a connected-app action costs the same whether the
  // user typed it or said it. Resolved here rather than in the route so only
  // this branch pays for the lookup, and fire-and-forget so the spoken
  // conversation never waits on a billing round trip.
  const gate = await import("@/lib/gate");
  void gate
    .requireBillingContext()
    .then((billing) =>
      billing.customerId
        ? gate.trackUsage({
            kind: "toolCall",
            customerId: billing.customerId,
            entityId: billing.entityId,
            toolCallId: callId ?? `${toolName}-voice`,
            toolName,
          })
        : undefined,
    )
    .catch(() => {
      // Counting is best-effort; the tool call is what matters.
    });

  try {
    const execute = tool.execute as (
      input: unknown,
      options: ReturnType<typeof minimalToolExecutionOptions>,
    ) => Promise<unknown>;
    const output = await execute(
      args ?? {},
      minimalToolExecutionOptions({
        toolCallId: callId ?? `${toolName}-voice`,
        abortSignal: AbortSignal.timeout(COMPOSIO_EXECUTE_TIMEOUT_MS),
      }),
    );
    return { ok: true, toolName, callId, output: capOutput(output) };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logger.error(
      `${toolName} failed`,
      error instanceof Error ? error.message : error,
    );
    return errorResult(
      toolName,
      timedOut
        ? "That integration took too long to answer. Say so and offer to try again."
        : "That integration could not complete the request.",
      timedOut ? "timeout" : "tool_execution_failed",
      callId,
    );
  }
}
