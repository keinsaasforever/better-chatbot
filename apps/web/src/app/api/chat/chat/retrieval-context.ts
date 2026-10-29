import type { ModelMessage } from "ai";

/**
 * Attaches per-turn volatile text to the last message.
 *
 * Retrieval chunks, sandbox asset URLs and the wall clock all change on every
 * request. Anything that changes belongs here, after the cache breakpoint -
 * never in the system prompt.
 *
 * Retrieved chunks used to be concatenated into the system prompt. Because they
 * depend on the question just asked, that made the system prompt different on
 * every turn - and a changed system block invalidates the system *and* messages
 * caches, so every turn re-paid full price for the agent instructions, HITL
 * rules, skills and MCP customizations that had not changed at all. Keeping the
 * volatile half here leaves the system prompt byte-stable.
 *
 * Call this AFTER `withTrailingCacheBreakpoint`. The appended text is not
 * persisted - it exists only for this request - so next turn's history will not
 * contain it. Marking the breakpoint first leaves it on the user's real
 * question, which means the cached span is exactly what the next turn's prefix
 * looks like. Appending before the breakpoint would cache a span containing
 * text that vanishes next turn, and that breakpoint could never hit again.
 *
 * The same trap caught the system prompt: caching is a prefix match, and the
 * breakpoint sits at the *end* of the system block, so a per-request value
 * placed last inside that block is still inside the cached span. A
 * minute-precision timestamp there meant neither breakpoint could hit across a
 * clock minute. Ordering within the system prompt does not help - the value has
 * to leave it entirely and come through here.
 *
 * Only a `user` message can carry the text. A turn that ends on a client-side
 * tool result - every HITL tool, approval mode, e2b-sandbox - re-enters this
 * route with the *assistant* message as the last one, which
 * `convertToModelMessages` splits into an assistant `tool-call` and a trailing
 * `{ role: "tool" }` message. `ToolContent` is `ToolResultPart[]`, so pushing a
 * text part into it makes the whole array fail `streamText`'s prompt
 * validation: "The messages do not match the ModelMessage[] schema". The blocks
 * used to be retrieval-only and therefore empty on most turns, which hid this
 * until the wall clock - never empty - joined them. Anything but a user message
 * gets its own trailing user message instead, which is valid after tool results
 * and still lands past the cache breakpoint.
 */
export const appendRetrievalContext = (
  messages: ModelMessage[],
  contexts: (string | undefined | false)[],
): ModelMessage[] => {
  const blocks = contexts
    .map((value) => (value ? value.trim() : ""))
    .filter(Boolean);

  if (!messages.length || !blocks.length) return messages;

  const part = { type: "text" as const, text: blocks.join("\n\n") };
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];

  // A tool message cannot hold text, and an assistant message holding a pending
  // tool call must not gain a part after it. Both get their own user message.
  if (last.role !== "user") {
    return [...messages, { role: "user", content: [part] }];
  }

  const content =
    typeof last.content === "string"
      ? [{ type: "text" as const, text: last.content }]
      : last.content;

  if (!Array.isArray(content)) return messages;

  const next = [...messages];
  next[lastIndex] = { ...last, content: [...content, part] } as ModelMessage;

  return next;
};
