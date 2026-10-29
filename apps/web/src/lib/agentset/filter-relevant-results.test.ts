import { describe, expect, it } from "vitest";
import { filterRelevantRetrievalResults } from "./filter-relevant-results";
import type { RetrievalSource } from "@/lib/citations/retrieval-source";

function hit(similarity: number, rank = 1): RetrievalSource {
  return {
    rank,
    source: "doc.pdf",
    content: "sample",
    similarity,
  };
}

describe("filterRelevantRetrievalResults", () => {
  it("returns empty when top score is below threshold", () => {
    expect(filterRelevantRetrievalResults([hit(0.2)], 0.35)).toEqual([]);
  });

  it("keeps results above threshold and re-ranks", () => {
    const filtered = filterRelevantRetrievalResults(
      [hit(0.5, 2), hit(0.8, 1), hit(0.3, 3)],
      0.35,
    );
    expect(filtered).toHaveLength(2);
    expect(filtered[0].similarity).toBe(0.8);
    expect(filtered[0].rank).toBe(1);
    expect(filtered[1].rank).toBe(2);
  });

  it("drops ambiguous low-confidence matches", () => {
    expect(
      filterRelevantRetrievalResults([hit(0.42), hit(0.41)], 0.35),
    ).toEqual([]);
  });
});
