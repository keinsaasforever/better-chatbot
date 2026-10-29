import type { AgentKnowledgeBaseBinding } from "app-types/agent";
import type { ChatMention } from "app-types/chat";

export type KnowledgeBaseMention = Extract<
  ChatMention,
  { type: "knowledgeBase" }
>;

/**
 * Namespaces searched per turn.
 *
 * `searchKnowledgeBaseNamespaces` fans out one Agentset request per source and
 * merges the hits into a single reranked window, so every extra source costs a
 * request and buys a smaller share of that window. The cap keeps a turn's
 * retrieval bounded no matter how many sources a client claims to have
 * attached.
 */
export const MAX_KNOWLEDGE_SOURCES = 10;

/** Narrows a mention list to the knowledge sources attached in the composer. */
export function knowledgeBaseMentions(
  mentions: ChatMention[] | undefined,
): KnowledgeBaseMention[] {
  return (mentions ?? []).filter(
    (mention): mention is KnowledgeBaseMention =>
      mention.type === "knowledgeBase",
  );
}

/**
 * Merges the knowledge sources already bound server-side (the active agent's
 * bindings, the thread's own column) with the ones this request's composer
 * mentions carry, de-duplicated by `type:id` and capped.
 *
 * Every id here is a reference, never a grant:
 * `buildAgentKnowledgeRetrievalPrompt` re-checks owner/org access on each one
 * before it searches a namespace, so a forged mention buys nothing.
 */
export function resolveKnowledgeBaseBindings(input: {
  mentions?: ChatMention[];
  /** Sources bound outside this request — agent bindings, thread column. */
  bindings?: AgentKnowledgeBaseBinding[];
}): AgentKnowledgeBaseBinding[] {
  const all: AgentKnowledgeBaseBinding[] = [
    ...(input.bindings ?? []),
    ...knowledgeBaseMentions(input.mentions).map((mention) => ({
      type: mention.sourceType,
      id: mention.knowledgeBaseId,
      name: mention.name,
    })),
  ];

  const seen = new Set<string>();
  const merged: AgentKnowledgeBaseBinding[] = [];
  for (const binding of all) {
    const key = `${binding.type}:${binding.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(binding);
    if (merged.length === MAX_KNOWLEDGE_SOURCES) break;
  }
  return merged;
}
