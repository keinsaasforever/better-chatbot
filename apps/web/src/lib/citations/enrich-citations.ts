import type { ParsedCitation } from "./parse-citations";
import type { RetrievalSource } from "./retrieval-source";

export function enrichCitations(
  citations: ParsedCitation[],
  sources: RetrievalSource[] | undefined,
): ParsedCitation[] {
  if (!sources?.length) return citations;

  const byRank = new Map(sources.map((source) => [source.rank, source]));

  return citations.map((citation) => {
    const source = byRank.get(citation.index);
    if (!source) return citation;

    return {
      ...citation,
      documentId: source.documentId ?? citation.documentId,
      documentTitle: citation.documentTitle ?? source.source,
      relevance: citation.relevance ?? source.similarity,
      chunkId: source.chunkId ?? citation.chunkId,
      pageNumber: source.pageNumber ?? citation.pageNumber,
      figureUrls: source.figureUrls?.length
        ? source.figureUrls
        : citation.figureUrls,
      agentsetDocumentId:
        source.agentsetDocumentId ?? citation.agentsetDocumentId,
    };
  });
}

function citationFromRetrievalSource(source: RetrievalSource): ParsedCitation {
  return {
    index: source.rank,
    quote: source.content.slice(0, 280),
    documentTitle: source.source,
    documentId: source.documentId ?? undefined,
    relevance: source.similarity,
    chunkId: source.chunkId ?? undefined,
    pageNumber: source.pageNumber,
    figureUrls: source.figureUrls,
    agentsetDocumentId: source.agentsetDocumentId ?? undefined,
  };
}

export function enrichCitationsForDisplay(
  citations: ParsedCitation[],
  sources: RetrievalSource[] | undefined,
  inlineIndices: number[],
): ParsedCitation[] {
  if (!sources?.length) return citations;

  const byRank = new Map(sources.map((source) => [source.rank, source]));
  const citedRanks = new Set([
    ...citations.map((citation) => citation.index),
    ...inlineIndices,
  ]);

  const merged = [...citations];
  for (const rank of citedRanks) {
    if (merged.some((citation) => citation.index === rank)) continue;
    const source = byRank.get(rank);
    if (source) merged.push(citationFromRetrievalSource(source));
  }

  return enrichCitations(merged, sources).sort((a, b) => a.index - b.index);
}

/** @deprecated Use enrichCitationsForDisplay — no longer appends uncited retrieval hits. */
export function enrichCitationsFromRetrieval(
  citations: ParsedCitation[],
  sources: RetrievalSource[] | undefined,
): ParsedCitation[] {
  return enrichCitations(citations, sources);
}
