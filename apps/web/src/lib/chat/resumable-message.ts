import type { UIMessage } from "ai";
import type { ChatMetadata } from "app-types/chat";

/**
 * Whether resuming a buffered run may drop the trailing assistant message.
 *
 * A resumable stream replays the run from its first chunk, so the partial
 * assistant message a torn-down connection left behind has to go or the
 * replayed parts land beside it and the answer renders twice.
 *
 * The rule used to be "any trailing assistant message", justified as: a freshly
 * started run still has the user message last. That stops being true the moment
 * the assistant message begins streaming, and on any reload of a thread whose
 * last message is a finished answer. Combined with a `runStatus` left at
 * "running" — which the chat route persists up front and only retires on its
 * terminal write — every mount of such a thread deleted a complete answer.
 *
 * So the message must say for itself that its run never finished. A terminal
 * status ("completed", "failed", "cancelled", "timed_out", …) means there is
 * nothing to replay over: keep it, and accept a duplicate render in the worst
 * case rather than destroying an answer.
 *
 * A message still holding an unanswered client-side tool call is kept for the
 * same reason: the component that owes the answer is mounted against it. This
 * is the iOS case — Safari freezes a backgrounded tab, the resume fires on
 * return, and deleting the tail here threw away a run that was already going.
 */
export function isInterruptedAssistantTail(
  messages: Pick<UIMessage, "role" | "metadata" | "parts">[],
): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  if ((last.metadata as ChatMetadata | undefined)?.runStatus !== "running") {
    return false;
  }
  // A client-side tool (python/javascript execution, the sandbox) is answered
  // by a component mounted against this very message. Dropping it unmounts the
  // runner mid-flight and takes the pending call out of client state, so the
  // replay has to recreate the call and start a second sandbox for work that
  // is already running. Keep the message and let the in-flight run answer it.
  return !hasPendingToolCall(last);
}

/** A tool part still waiting on its result, i.e. one the client owes an answer. */
function hasPendingToolCall(message: Pick<UIMessage, "parts">): boolean {
  return (message.parts ?? []).some((part) => {
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
      return false;
    }
    const state = (part as { state?: string }).state;
    return state === "input-available" || state === "input-streaming";
  });
}
