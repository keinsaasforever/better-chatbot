import type { RetrievalSource } from "@/lib/citations/retrieval-source";
import { getAgentsetRetrievalMinScore } from "./retrieval-config";

export function filterRelevantRetrievalResults(
  results: RetrievalSource[],
  minScore = getAgentsetRetrievalMinScore(),
): RetrievalSource[] {
  if (!results.length) return [];

  const sorted = [...results].sort((a, b) => b.similarity - a.similarity);
  const topScore = sorted[0]?.similarity ?? 0;
  if (topScore < minScore) return [];

  const secondScore = sorted[1]?.similarity ?? 0;
  if (topScore < 0.5 && topScore - secondScore < 0.05) {
    return [];
  }

  return sorted
    .filter((result) => result.similarity >= minScore)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}
