import type { ChatModel } from "app-types/chat";

/**
 * An agent's pinned model is stored as one varchar: "provider/model", split on
 * the first slash (provider ids never contain one; model ids may). Client-safe
 * — imported by both the agent form and the chat/scheduled-run server paths.
 */
export function parseAgentModel(
  value: string | null | undefined,
): ChatModel | null {
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return {
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
  };
}

export function formatAgentModel(model: ChatModel): string {
  return `${model.provider}/${model.model}`;
}
