import type { ModelMessage } from "ai";

/**
 * Anthropic prompt-cache breakpoints.
 *
 * Caching is a prefix match over `tools -> system -> messages`, and reads cost
 * roughly a tenth of normal input tokens. Providers that do not understand
 * `providerOptions.anthropic` ignore it, so these are safe to attach
 * unconditionally rather than sniffing the model id.
 *
 * Two breakpoints are used (the per-request maximum is four):
 *  - end of the system prompt, which covers the tool schemas and the system
 *    prompt itself;
 *  - end of the last message, so each turn extends the cached span instead of
 *    re-reading the whole conversation at full price.
 */
export const ANTHROPIC_CACHE_CONTROL = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} as const;

/**
 * Marks the final content part of the last message as a cache breakpoint.
 *
 * Returns a shallow copy; the caller's array and the untouched messages keep
 * their identity so nothing else in the request is disturbed.
 */
export const withTrailingCacheBreakpoint = (
  messages: ModelMessage[],
): ModelMessage[] => {
  if (!messages.length) return messages;

  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];

  // String content has no part to annotate; promote it to a single text part
  // so the breakpoint has somewhere to live.
  const content =
    typeof last.content === "string"
      ? [{ type: "text" as const, text: last.content }]
      : last.content;

  if (!Array.isArray(content) || content.length === 0) return messages;

  const parts = content.map((part, index) =>
    index === content.length - 1
      ? { ...part, providerOptions: ANTHROPIC_CACHE_CONTROL }
      : part,
  );

  const next = [...messages];
  next[lastIndex] = { ...last, content: parts } as ModelMessage;
  return next;
};
