import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectTable } from "@/lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";
import {
  readChunkPageNumber,
  readChunkSequenceNumber,
  resolveChunkDocumentIds,
} from "./chunk-metadata";
import { extractFigureUrls } from "@/lib/citations/figure-urls";
import type { RetrievalSource } from "@/lib/citations/retrieval-source";
import {
  getAgentsetRetrievalMinScore,
  getAgentsetRetrievalRerankLimit,
} from "./retrieval-config";
import { searchAgentsetProject } from "./search";

export type ProjectKnowledgeHit = RetrievalSource;

export function toRetrievalSource(hit: ProjectKnowledgeHit): RetrievalSource {
  return hit;
}

export async function shouldUseAgentsetRetrieval(input: {
  projectId: string;
  userId: string;
}) {
  if (!process.env.AGENTSET_API_KEY) return false;

  const [project] = await pgDb
    .select({
      retrievalBackend: ProjectTable.retrievalBackend,
      agentsetNamespaceId: ProjectTable.agentsetNamespaceId,
    })
    .from(ProjectTable)
    .where(
      and(
        eq(ProjectTable.id, input.projectId),
        eq(ProjectTable.ownerUserId, input.userId),
      ),
    )
    .limit(1);

  if (!project) return false;

  return (
    Boolean(project.agentsetNamespaceId) ||
    project.retrievalBackend === "agentset" ||
    project.retrievalBackend === "hybrid"
  );
}

export async function searchProjectKnowledge(input: {
  userId: string;
  projectId: string;
  query: string;
  limit?: number;
}): Promise<{
  backend: "agentset" | "local";
  results: ProjectKnowledgeHit[];
  context: string;
}> {
  const limit = input.limit ?? 8;
  const useAgentset = await shouldUseAgentsetRetrieval(input);

  if (useAgentset) {
    const limit = input.limit ?? getAgentsetRetrievalRerankLimit();
    const rows = await searchAgentsetProject({
      userId: input.userId,
      projectId: input.projectId,
      query: input.query,
      topK: 20,
      rerankLimit: limit,
      minScore: getAgentsetRetrievalMinScore(),
      mode: "semantic",
    });

    const results = rows.slice(0, limit).map((row, index) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const text = row.text ?? "";
      const { navigatorDocumentId, agentsetDocumentId } =
        resolveChunkDocumentIds(metadata);

      return {
        rank: index + 1,
        content: text,
        source: (metadata.filename as string | undefined) ?? "document",
        similarity: row.score ?? 0,
        documentId: navigatorDocumentId ?? null,
        agentsetDocumentId: agentsetDocumentId ?? null,
        chunkId: row.id ?? null,
        pageNumber: readChunkPageNumber(metadata),
        sequenceNumber: readChunkSequenceNumber(metadata),
        figureUrls: extractFigureUrls(text),
      };
    });

    return {
      backend: "agentset" as const,
      results,
      context: results.map((r) => `[${r.rank}] ${r.content}`).join("\n\n"),
    };
  }

  const { searchKnowledgeBaseServer } = await import(
    "@/lib/ai/tools/knowledge-base/search-knowledge-base"
  );

  const data = await searchKnowledgeBaseServer({
    query: input.query,
    projectId: input.projectId,
    userId: input.userId,
    limit,
    threshold: 0.35,
  });

  const results = data.results.map((result, index) => ({
    rank: index + 1,
    content: result.content,
    source: result.filename,
    similarity: result.similarity,
    documentId: result.documentId ?? null,
    chunkId: result.chunkId ?? null,
    figureUrls: extractFigureUrls(result.content),
  }));

  return {
    backend: "local",
    results,
    context: results.map((r) => r.content).join("\n\n---\n\n"),
  };
}
