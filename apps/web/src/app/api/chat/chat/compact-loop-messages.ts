import { type ModelMessage, pruneMessages } from "ai";

/**
 * Trims the tool-call loop's own accumulation partway through a turn.
 *
 * One turn runs up to 10 steps, and every step re-sends everything the loop
 * has produced so far. A few large tool results (a document read, a web
 * search, sandbox output) push that past the model's context window long
 * before the step budget runs out.
 *
 * This operates on `responseMessages` only - the assistant and tool messages
 * the loop itself generated. The conversation the user is having
 * (`initialMessages`) is never passed in, so nothing they wrote or uploaded
 * can be dropped here, and the prompt-cache breakpoints that sit inside it
 * stay byte-stable for the whole turn.
 *
 * Send-time only: the persisted transcript and the UI keep the full content.
 */

/** Loop messages left intact - the model is still working on these. */
export const COMPACT_KEEP_RECENT_MESSAGES = 6;

/**
 * True when a tool result answers a call the loop did not make, which means
 * the call lives in `initialMessages`. Pruning that result would leave the
 * call unanswered and the provider would reject the request.
 *
 * The SDK produces this only for tools using `needsApproval`, whose result it
 * pushes into the response messages while the call stays in the initial ones.
 * No tool here does - the HITL tools in `lib/ai/tools/hitl` drive approval
 * from the UI instead - but the system prompt does point the model at
 * `needsApproval`, so assert the invariant rather than assume it.
 */
const hasForeignToolResult = (messages: ModelMessage[]): boolean => {
  const calls = new Set<string>();
  const results: string[] = [];

  for (const message of messages) {
    if (
      (message.role !== "assistant" && message.role !== "tool") ||
      typeof message.content === "string"
    ) {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-call") calls.add(part.toolCallId);
      else if (part.type === "tool-result") results.push(part.toolCallId);
    }
  }

  return results.some((id) => !calls.has(id));
};

/**
 * `as const` so this keeps its literal type: pruneMessages types the option as
 * `before-last-${number}-messages`, and a widened `string` would not match.
 */
const TOOL_CALL_BOUNDARY =
  `before-last-${COMPACT_KEEP_RECENT_MESSAGES}-messages` as const;

/**
 * Returns the compacted loop messages, or `undefined` when compaction would
 * be unsafe or would not remove anything.
 */
export const compactLoopMessages = (
  responseMessages: ModelMessage[],
): ModelMessage[] | undefined => {
  if (hasForeignToolResult(responseMessages)) return undefined;

  // pruneMessages is handed the whole loop on purpose: it collects the tool
  // call ids referenced by the kept tail and refuses to drop a call whose
  // result is in it, so the boundary cannot orphan a tool result. Slicing the
  // array first hides the tail and defeats exactly that check.
  const paired = pruneMessages({
    messages: responseMessages,
    toolCalls: TOOL_CALL_BOUNDARY,
    emptyMessages: "remove",
  });

  // Reasoning has no "before-last-N" option, so it needs a second pass.
  // Splitting the array is safe here and only here: reasoning parts carry no
  // cross-message ids, so removing one cannot orphan anything.
  const keepFrom = Math.max(0, paired.length - COMPACT_KEEP_RECENT_MESSAGES);
  const compacted = [
    ...pruneMessages({
      messages: paired.slice(0, keepFrom),
      reasoning: "all",
      emptyMessages: "remove",
    }),
    ...paired.slice(keepFrom),
  ];

  // Nothing came out: an override that only rebuilds the array is pure cost.
  if (
    compacted.length === responseMessages.length &&
    compacted.every((message, index) => message === responseMessages[index])
  ) {
    return undefined;
  }

  return compacted;
};
