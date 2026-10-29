import type { UIMessage } from "ai";
import type { ChatMetadata } from "app-types/chat";

/**
 * Newest rows the recovery read fetches. A run writes at most two rows (the
 * user turn and one assistant message; a tool-result continuation rewrites
 * the same assistant row), so the anchor is always within the newest two.
 * Two more give slack without de-TOASTing the whole transcript.
 */
export const RUN_RECOVERY_WINDOW = 4;

export type PersistedTailRow = Pick<
  UIMessage,
  "id" | "role" | "parts" | "metadata"
>;

export type ReconcileResult =
  /** The server has finished this turn; `messages` is the client transcript
   * with everything from the current user turn on replaced by what the server
   * persisted. */
  | { kind: "settled"; messages: UIMessage[] }
  /** The server is still working on this turn (or is between clearing its
   * resume pointer and writing the assistant row). Ask again later. */
  | { kind: "running" }
  /** The client holds a tool result the server never received. Replacing the
   * transcript would lose it; the result has to be re-sent instead. */
  | { kind: "client-ahead" }
  /** The current user turn is not on the server at all (the send never got
   * through, or the window is too small). Nothing to reconcile against. */
  | { kind: "unknown" };

const runStatusOf = (message: Pick<UIMessage, "metadata">) =>
  (message.metadata as ChatMetadata | undefined)?.runStatus;

/** A run that is over, whatever the outcome. No status at all counts: older
 * rows predate `runStatus` and a message the client itself built has none. */
export function isTerminalRunStatus(status: string | undefined): boolean {
  return status !== "running" && status !== "queued";
}

type ToolPart = { type: string; toolCallId: string; state?: string };

function toolPartsOf(message: Pick<UIMessage, "parts">): ToolPart[] {
  const parts: ToolPart[] = [];
  for (const part of message.parts ?? []) {
    const candidate = part as unknown as Partial<ToolPart>;
    if (typeof candidate.type !== "string") continue;
    if (
      !candidate.type.startsWith("tool-") &&
      candidate.type !== "dynamic-tool"
    ) {
      continue;
    }
    if (typeof candidate.toolCallId !== "string") continue;
    parts.push(candidate as ToolPart);
  }
  return parts;
}

const hasOutput = (part: ToolPart) => Boolean(part.state?.startsWith("output"));

/**
 * Decide what the client should do with the newest persisted rows of its
 * thread after its own stream died.
 *
 * The chat route persists the user turn up front with `runStatus: "running"`
 * and flips it, together with the assistant row it writes, to a terminal
 * status only when the run ends. So the newest persisted row says for itself
 * whether the server is done. The anchor is the client's last user message:
 * everything from it onward is the turn in question, everything before it is
 * older history the client may hold more of (loaded pages) than the window
 * returns, so it is kept untouched.
 *
 * Two persisted states look finished but are not. The user row alone with a
 * success status is the moment between the two writes of the route's `onEnd`
 * (the assistant row lands next). And a client whose last assistant message
 * already carries a tool output the server does not have is *ahead* of the
 * server: the auto-resend of that result never arrived. Overwriting it would
 * revert the tool part to "awaiting input" while the component that owes the
 * answer already ran, leaving a call nobody will answer.
 *
 * A regenerate after a persisted answer mints a new assistant id, so a later
 * reconcile shows both the old and the new answer, the same as a reload.
 */
export function reconcilePersistedTail(
  client: UIMessage[],
  persisted: PersistedTailRow[],
): ReconcileResult {
  let anchorClientIdx = -1;
  for (let i = client.length - 1; i >= 0; i--) {
    if (client[i]?.role === "user") {
      anchorClientIdx = i;
      break;
    }
  }
  const anchor = client[anchorClientIdx];
  if (!anchor) return { kind: "unknown" };
  const anchorId = anchor.id;

  const anchorPersistedIdx = persisted.findIndex((row) => row.id === anchorId);
  if (anchorPersistedIdx === -1) return { kind: "unknown" };
  const tail = persisted.slice(anchorPersistedIdx);
  const last = tail.at(-1);
  if (!last) return { kind: "unknown" };
  const lastStatus = runStatusOf(last);

  if (!isTerminalRunStatus(lastStatus)) return { kind: "running" };
  if (
    tail.length === 1 &&
    (lastStatus === "completed" || lastStatus === "incomplete")
  ) {
    return { kind: "running" };
  }

  const clientLast = client.at(-1);
  if (clientLast?.role === "assistant" && clientLast.id !== anchorId) {
    const twin = tail.find((row) => row.id === clientLast.id);
    if (twin) {
      const persistedOutputs = new Set(
        toolPartsOf(twin)
          .filter(hasOutput)
          .map((part) => part.toolCallId),
      );
      const ahead = toolPartsOf(clientLast).some(
        (part) => hasOutput(part) && !persistedOutputs.has(part.toolCallId),
      );
      if (ahead) return { kind: "client-ahead" };
    }
  }

  return {
    kind: "settled",
    messages: [
      ...client.slice(0, anchorClientIdx),
      ...tail.map(
        ({ id, role, parts, metadata }) =>
          ({ id, role, parts, metadata }) as UIMessage,
      ),
    ],
  };
}
