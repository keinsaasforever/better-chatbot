import type { ChatMention } from "app-types/chat";
import { AppDefaultToolkit, DefaultToolName } from "lib/ai/tools";

/**
 * Whether the browser-automation toolkit is on for this request.
 *
 * Pinning `@browser-automation` used to be the one sure way to lose it. The
 * mention list offers it like any other default tool, but pinning ANY default
 * tool makes the client send an empty toolkit list — that is what "pin" means
 * for this family — and an empty list fails the toolkit check. So asking for
 * the tool by name removed it.
 *
 * It cannot come back through `loadAppDefaultTools` either: the browser entry
 * in `APP_DEFAULT_TOOL_KIT` is deliberately empty, because the tool needs the
 * request's resolved model and is bound in the chat route instead. The pin
 * therefore has to count as the toolkit being on.
 *
 * Pinning a *different* default tool still switches the browser off, which is
 * what a pin is for. Agents that list the tool in their instructions arrive as
 * the same mention and were equally affected.
 */
export function isBrowserToolkitOn(input: {
  mentions?: ChatMention[];
  allowedAppDefaultToolkit?: string[];
}): boolean {
  const pinned = (input.mentions ?? []).some(
    (mention) =>
      mention.type === "defaultTool" &&
      mention.name === DefaultToolName.BrowserAutomation,
  );
  if (pinned) return true;

  return (
    input.allowedAppDefaultToolkit ?? Object.values(AppDefaultToolkit)
  ).includes(AppDefaultToolkit.BrowserAutomation);
}
