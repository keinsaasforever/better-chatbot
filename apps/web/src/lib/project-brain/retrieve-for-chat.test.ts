import { describe, expect, it, vi } from "vitest";

const { dbSelect } = vi.hoisted(() => ({ dbSelect: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: { select: dbSelect },
}));
vi.mock("@/lib/agentset/retrieval", () => ({
  searchProjectKnowledge: vi.fn(),
}));
vi.mock("./search-local", () => ({
  searchProjectBrainChunks: vi.fn().mockResolvedValue([]),
  keywordSearchProjectBrainChunks: vi.fn().mockResolvedValue([]),
  loadCompiledTruthChunksForPages: vi.fn().mockResolvedValue([]),
}));
vi.mock("./graph-query", () => ({
  traverse: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
}));
vi.mock("./generated-insights", () => ({
  getLatestProjectStatusSnapshot: vi.fn().mockResolvedValue(null),
}));

import { buildProjectRetrievalPrompt } from "./retrieve-for-chat";

const { searchProjectKnowledge } = await import("@/lib/agentset/retrieval");

describe("buildProjectRetrievalPrompt", () => {
  function mockProjectMemoryEnabled(memoryEnabled = true) {
    let call = 0;
    dbSelect.mockImplementation(() => {
      call += 1;
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => Promise.resolve(call === 1 ? [{ memoryEnabled }] : []),
      };
      return query;
    });
  }

  it("skips retrieval for greetings", async () => {
    const result = await buildProjectRetrievalPrompt({
      userId: "user-1",
      projectId: "project-1",
      query: "hello",
    });

    expect(result).toEqual({ prompt: "", sources: [] });
    expect(searchProjectKnowledge).not.toHaveBeenCalled();
  });

  it("returns empty prompt when top score is below threshold", async () => {
    mockProjectMemoryEnabled();
    vi.mocked(searchProjectKnowledge).mockResolvedValue({
      backend: "agentset",
      context: "",
      results: [
        {
          rank: 1,
          source: "doc.pdf",
          content: "weak match",
          similarity: 0.2,
        },
      ],
    });

    const result = await buildProjectRetrievalPrompt({
      userId: "user-1",
      projectId: "project-1",
      query: "What is Baudynamik?",
    });

    expect(result).toEqual({ prompt: "", sources: [] });
  });

  it("does not expose project memory when memory is disabled", async () => {
    mockProjectMemoryEnabled(false);
    vi.mocked(searchProjectKnowledge).mockResolvedValue({
      backend: "agentset",
      context: "",
      results: [
        {
          rank: 1,
          source: "doc.pdf",
          content: "relevant but disabled",
          similarity: 0.99,
        },
      ],
    });

    await expect(
      buildProjectRetrievalPrompt({
        userId: "user-1",
        projectId: "project-1",
        query: "What is Baudynamik?",
      }),
    ).resolves.toEqual({ prompt: "", sources: [] });
  });

  it("builds prompt for relevant matches", async () => {
    mockProjectMemoryEnabled();
    vi.mocked(searchProjectKnowledge).mockResolvedValue({
      backend: "agentset",
      context: "",
      results: [
        {
          rank: 1,
          source: "doc.pdf",
          content: "Baudynamik details",
          similarity: 0.82,
        },
      ],
    });

    const result = await buildProjectRetrievalPrompt({
      userId: "user-1",
      projectId: "project-1",
      query: "What is Baudynamik?",
    });

    expect(result.sources).toHaveLength(1);
    expect(result.prompt).toContain("<project_knowledge_retrieval");
  });
});
