import {
  type UseChatHelpers,
  type UseChatOptions,
  useChat,
} from "@ai-sdk/react";
import type { UIMessage } from "ai";

/** Wraps useChat with the shared throttle and a default onError that rolls
 * back the optimistic user message on a failed send (the ephemeral temporary
 * chat wants this). The persistent chat opts out by passing its own onError:
 * it persists the user message server-side before streaming, so a client-side
 * rollback would desync from the stored copy and break its ErrorMessage retry. */
export function useChatCore(
  options: UseChatOptions<UIMessage>,
): UseChatHelpers<UIMessage> {
  const helpers = useChat<UIMessage>({
    experimental_throttle: 100,
    onError: () => helpers.setMessages((prev) => prev.slice(0, -1)),
    ...options,
  });
  return helpers;
}
