import { describe, expect, it } from "vitest";
import {
  AGENTSET_CITATION_GUIDELINES,
  formatAgentsetSearchContext,
} from "./citation-context";
import type { ProjectKnowledgeHit } from "./retrieval";

describe("formatAgentsetSearchContext", () => {
  it("numbers chunks the Agentset way", () => {
    const hits: ProjectKnowledgeHit[] = [
      {
        rank: 1,
        content: "First chunk",
        source: "a.pdf",
        similarity: 0.9,
      },
      {
        rank: 2,
        content: "Second chunk",
        source: "b.pdf",
        similarity: 0.8,
      },
    ];

    expect(formatAgentsetSearchContext(hits)).toBe(
      "[1] First chunk\n\n[2] Second chunk",
    );
  });
});

describe("AGENTSET_CITATION_GUIDELINES", () => {
  it("includes mandatory inline citation guidance", () => {
    expect(AGENTSET_CITATION_GUIDELINES).toContain(
      "only when they help answer",
    );
    expect(AGENTSET_CITATION_GUIDELINES).toContain(
      "immediately after the statement",
    );
    expect(AGENTSET_CITATION_GUIDELINES).toContain("<CITATIONS>");
  });

  it("points at where the chunks actually arrive", () => {
    // The rules live in the system prompt while the chunks ride with the user
    // message, so the wording has to send the model to the right place.
    expect(AGENTSET_CITATION_GUIDELINES).toContain(
      "<project_knowledge_retrieval>",
    );
    expect(AGENTSET_CITATION_GUIDELINES).toContain(
      "<agent_knowledge_retrieval>",
    );
  });

  it("carries no retrieved content, so it stays cacheable", () => {
    // A chunk marker here would mean per-turn text in the system prompt.
    expect(AGENTSET_CITATION_GUIDELINES).not.toContain("Context:");
  });
});
