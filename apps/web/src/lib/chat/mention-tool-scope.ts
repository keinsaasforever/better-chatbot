import type { ChatMention } from "app-types/chat";

/**
 * Which tool namespace a mention pins.
 *
 * A mention narrows the tools *within its own family* — it does not mute the
 * others. Getting this wrong is not hypothetical: selecting an agent injects a
 * `{ type: "agent" }` mention on its own, so treating "any mention" as "pin
 * everything" silently stripped every app default tool and every MCP server
 * from agent turns, leaving the model with only the Composio meta-tools.
 *
 * `loadAppDefaultTools` already scopes to `defaultTool` mentions server-side.
 * These predicates keep the client in step, so the server is not handed an
 * empty list to scope over. Both sides must agree; that is why the rule lives
 * here rather than inline at either call site.
 */

/** A mention that pins the app default toolkit (`webSearch`, `python-execution`, …). */
export function hasDefaultToolMention(
  mentions: ChatMention[] | undefined,
): boolean {
  return (mentions ?? []).some((mention) => mention.type === "defaultTool");
}

/** A mention that pins MCP tools, whether a whole server or a single tool. */
export function hasMcpMention(mentions: ChatMention[] | undefined): boolean {
  return (mentions ?? []).some(
    (mention) => mention.type === "mcpTool" || mention.type === "mcpServer",
  );
}
