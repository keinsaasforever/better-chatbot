import type { ChatMetadata } from "app-types/chat";

// `UIMessage["metadata"]` is `unknown` at the SDK boundary, so narrow here
// rather than making every caller cast.
type MessageWithMetadata = { metadata?: unknown };

/**
 * The agent a thread was last talked to, read back from message metadata.
 *
 * There is no `agent_id` on `chat_thread`: the selection lives in client state
 * and is only echoed onto each message. So when a thread is opened fresh — most
 * visibly from a scheduled run's notification link — the metadata is the only
 * record of which agent produced it, and without this the composer comes up
 * with no agent selected and the next message silently goes to the plain
 * assistant.
 *
 * Scans newest-first so switching agents mid-thread resolves to the current one.
 */
export function latestAgentIdFromMessages(
  messages: MessageWithMetadata[] | undefined,
): string | undefined {
  if (!messages?.length) return undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const metadata = messages[index]?.metadata as ChatMetadata | undefined;
    if (metadata?.agentId) return metadata.agentId;
  }
  return undefined;
}
