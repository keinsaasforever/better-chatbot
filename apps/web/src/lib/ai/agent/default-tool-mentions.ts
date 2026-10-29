import type { ChatMention } from "app-types/chat";
import { DefaultToolName } from "lib/ai/tools";

/** Every built-in tool name a mention may name, as plain strings. */
export const DEFAULT_TOOL_NAMES: string[] = Object.values(DefaultToolName);

/**
 * Turn a list of built-in tool names into agent mentions.
 *
 * Filtering against `DefaultToolName` rather than trusting the input is the
 * point: both callers receive the names from a model (the agent generator and
 * the createAgent approval card), and a hallucinated tool stored as a mention
 * would sit in the agent forever, resolving to nothing.
 */
export function defaultToolMentionsFromNames(
  toolNames: string[] | undefined,
): ChatMention[] {
  if (!toolNames?.length) return [];
  const requested = new Set(toolNames);
  return DEFAULT_TOOL_NAMES.filter((name) => requested.has(name)).map(
    (name) => ({
      type: "defaultTool" as const,
      name,
      label: name,
    }),
  );
}
