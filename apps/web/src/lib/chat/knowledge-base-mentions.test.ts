import type { AgentKnowledgeBaseBinding } from "app-types/agent";
import type { ChatMention } from "app-types/chat";
import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_SOURCES,
  knowledgeBaseMentions,
  resolveKnowledgeBaseBindings,
} from "./knowledge-base-mentions";

const KB_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const kbMention = {
  type: "knowledgeBase",
  name: "Building law",
  knowledgeBaseId: KB_ID,
  sourceType: "kb",
} as ChatMention;

const projectMention = {
  type: "knowledgeBase",
  name: "Navigator",
  knowledgeBaseId: PROJECT_ID,
  sourceType: "project",
} as ChatMention;

const agentMention = {
  type: "agent",
  agentId: "a",
  name: "Agent",
} as ChatMention;

describe("knowledge base mentions", () => {
  it("ignores mention kinds that are not knowledge sources", () => {
    expect(knowledgeBaseMentions(undefined)).toEqual([]);
    expect(knowledgeBaseMentions([agentMention])).toEqual([]);
    expect(resolveKnowledgeBaseBindings({ mentions: [agentMention] })).toEqual(
      [],
    );
  });

  it("turns composer mentions into retrieval bindings", () => {
    expect(
      resolveKnowledgeBaseBindings({ mentions: [kbMention, projectMention] }),
    ).toEqual([
      { type: "kb", id: KB_ID, name: "Building law" },
      { type: "project", id: PROJECT_ID, name: "Navigator" },
    ]);
  });

  it("merges agent bindings with composer mentions", () => {
    const agentBindings: AgentKnowledgeBaseBinding[] = [
      { type: "kb", id: KB_ID, name: "Building law" },
    ];
    expect(
      resolveKnowledgeBaseBindings({
        mentions: [projectMention],
        bindings: agentBindings,
      }),
    ).toEqual([
      { type: "kb", id: KB_ID, name: "Building law" },
      { type: "project", id: PROJECT_ID, name: "Navigator" },
    ]);
  });

  /**
   * Attaching the same knowledge base the agent is already bound to must not
   * make retrieval search that namespace twice — duplicate hits would crowd
   * out the other sources in the reranked window.
   */
  it("de-duplicates a source bound by both the agent and the composer", () => {
    expect(
      resolveKnowledgeBaseBindings({
        mentions: [kbMention],
        bindings: [{ type: "kb", id: KB_ID, name: "Building law" }],
      }),
    ).toEqual([{ type: "kb", id: KB_ID, name: "Building law" }]);
  });

  /**
   * Every source costs an Agentset request and a slice of one reranked window,
   * so a client claiming a hundred attachments must not fan out a hundred
   * searches.
   */
  it("caps how many sources one turn can search", () => {
    const many = Array.from(
      { length: MAX_KNOWLEDGE_SOURCES + 5 },
      (_, i) =>
        ({
          type: "knowledgeBase",
          name: `KB ${i}`,
          knowledgeBaseId: `1111111${i}-1111-4111-8111-111111111111`,
          sourceType: "kb",
        }) as ChatMention,
    );
    expect(resolveKnowledgeBaseBindings({ mentions: many })).toHaveLength(
      MAX_KNOWLEDGE_SOURCES,
    );
  });

  /**
   * A knowledge base and a project can never collide on id in practice, but
   * the key has to stay type-qualified so a future id scheme cannot silently
   * drop one of the two.
   */
  it("keeps sources of different types with the same id apart", () => {
    expect(
      resolveKnowledgeBaseBindings({
        mentions: [
          kbMention,
          { ...projectMention, knowledgeBaseId: KB_ID } as ChatMention,
        ],
      }),
    ).toHaveLength(2);
  });
});
