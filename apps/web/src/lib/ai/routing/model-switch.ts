import type { ChatModel } from "app-types/chat";

/**
 * The model a thread already ran on, and whether this turn changed it.
 *
 * The prompt cache is keyed per provider *and* model, so a switch throws away
 * the whole cached prefix: the next turn re-pays full price for a history the
 * previous model had already cached. In the thread that prompted this work
 * there were two switches across 27 model runs.
 *
 * That measurement is what `resolveAutomaticRoute` now acts on: it pins a
 * thread to the model of its previous turn, so automatic routing decides once
 * per thread rather than once per message. `detectModelSwitch` stays as the
 * check on that - what it still reports is a user switching models by hand, or
 * a pin that had to be dropped because the model no longer met the turn's hard
 * requirements.
 *
 * Costs nothing to compute: `thread.messages` is already loaded before the
 * routing decision, and every assistant message carries the model it ran on.
 */

export type ModelSwitch = {
  from: string;
  to: string;
  /** True when routing chose the new model, false when the user did. */
  automatic: boolean;
};

type MessageLike = {
  role: string;
  metadata?: { chatModel?: ChatModel } | null;
};

/** `provider/model`, or undefined when either half is missing. */
export const formatModelKey = (
  model?: { provider?: string; model?: string } | null,
): string | undefined =>
  model?.provider && model?.model
    ? `${model.provider}/${model.model}`
    : undefined;

/**
 * The model this thread last ran on: the newest assistant message carrying a
 * model. Assistant messages are written after the routing decision, so this is
 * what actually served the turn rather than what was requested - which is also
 * why it is the right thing to pin the next turn to.
 */
export const findPreviousThreadChatModel = (
  messages: MessageLike[] | undefined,
): ChatModel | undefined => {
  if (!messages?.length) return undefined;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const chatModel = message.metadata?.chatModel;
    if (chatModel?.provider && chatModel?.model) return chatModel;
  }
  return undefined;
};

/** {@link findPreviousThreadChatModel} as a `provider/model` key. */
export const findPreviousThreadModel = (
  messages: MessageLike[] | undefined,
): string | undefined => formatModelKey(findPreviousThreadChatModel(messages));

/**
 * Undefined when the thread is new, when no earlier turn recorded a model, or
 * when the model is unchanged - the overwhelmingly common case, so callers can
 * treat a returned value as the event worth recording.
 */
export const detectModelSwitch = (input: {
  messages: MessageLike[] | undefined;
  current?: { provider?: string; model?: string } | null;
  automatic: boolean;
}): ModelSwitch | undefined => {
  const to = formatModelKey(input.current);
  if (!to) return undefined;

  const from = findPreviousThreadModel(input.messages);
  if (!from || from === to) return undefined;

  return { from, to, automatic: input.automatic };
};
