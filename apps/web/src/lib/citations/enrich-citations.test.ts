import { describe, expect, it } from "vitest";
import { enrichCitations, enrichCitationsForDisplay } from "./enrich-citations";

const retrievalSources = [
  {
    rank: 1,
    source: "Report.pdf",
    content: "quoted text from report",
    similarity: 0.91,
    documentId: "b38f0af9-e6ef-4146-ad71-35276a983860",
    pageNumber: 3,
    figureUrls: ["https://files.agentset.ai/example.png"],
  },
  {
    rank: 2,
    source: "Other.pdf",
    content: "unused chunk",
    similarity: 0.88,
  },
];

describe("enrichCitations", () => {
  it("merges retrieval metadata by citation rank", () => {
    const citations = [
      {
        index: 1,
        quote: "quoted text",
        documentTitle: "Report.pdf",
        documentId: "cmpe-wrong-id",
      },
    ];

    const enriched = enrichCitations(citations, retrievalSources);

    expect(enriched[0]).toMatchObject({
      documentId: "b38f0af9-e6ef-4146-ad71-35276a983860",
      pageNumber: 3,
      relevance: 0.91,
      figureUrls: ["https://files.agentset.ai/example.png"],
    });
  });
});

describe("enrichCitationsForDisplay", () => {
  it("does not append uncited retrieval hits", () => {
    const enriched = enrichCitationsForDisplay([], retrievalSources, []);
    expect(enriched).toEqual([]);
  });

  it("builds citations only for inline indices", () => {
    const enriched = enrichCitationsForDisplay([], retrievalSources, [1]);

    expect(enriched).toHaveLength(1);
    expect(enriched[0]).toMatchObject({
      index: 1,
      documentId: "b38f0af9-e6ef-4146-ad71-35276a983860",
      pageNumber: 3,
    });
  });
});
