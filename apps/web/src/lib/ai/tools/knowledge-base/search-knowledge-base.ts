import { tool as createTool } from "ai";
import { JSONSchema7 } from "json-schema";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { safe } from "ts-safe";

export const searchKnowledgeBaseSchema: JSONSchema7 = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "The search query to find relevant information from the project's knowledge base documents",
    },
    projectId: {
      type: "string",
      description:
        "The ID of the project to search within. If not provided, searches across all user documents.",
    },
    limit: {
      type: "number",
      description: "Maximum number of results to return",
      default: 5,
      minimum: 1,
      maximum: 20,
    },
    threshold: {
      type: "number",
      description:
        "Minimum cosine similarity (0–1). Default 0.5; use 0.35 if recall is low. Values above 0.7 often return nothing.",
      default: 0.5,
      minimum: 0,
      maximum: 1,
    },
  },
  required: ["query"],
};

export interface SearchKnowledgeBaseParams {
  query: string;
  projectId?: string;
  limit?: number;
  threshold?: number;
}

export interface KnowledgeBaseResult {
  content: string;
  similarity: number;
  filename: string;
  metadata: Record<string, any>;
}

/**
 * Tool for searching the project knowledge base using vector similarity.
 * Retrieves relevant document chunks to augment LLM responses.
 *
 * @param customerId - Optional customer ID for tracking (unused currently)
 * @param boundProjectId - Optional project ID to automatically scope searches to a specific project
 */
export const searchKnowledgeBase = (
  _customerId?: string,
  boundProjectId?: string,
) =>
  createTool({
    description:
      "Search the project's knowledge base documents for relevant information. " +
      "Use this when the user asks questions about documents they've uploaded, " +
      "or when you need context from their project documentation. " +
      "Returns relevant text chunks with similarity scores.",
    inputSchema: jsonSchemaToZod(searchKnowledgeBaseSchema),
    execute: async (params) => {
      const {
        query,
        projectId: paramsProjectId,
        limit = 5,
        threshold = 0.5,
      } = params;
      const projectId = boundProjectId ?? paramsProjectId;

      return await safe(async () => {
        if (!_customerId) {
          throw new Error(
            "User ID required for knowledge base search (internal error)",
          );
        }

        if (projectId) {
          const { searchProjectKnowledge } = await import(
            "@/lib/agentset/retrieval"
          );
          const data = await searchProjectKnowledge({
            userId: _customerId,
            projectId,
            query,
            limit,
          });

          if (data.results.length === 0) {
            return {
              success: true,
              message: "No relevant information found in the knowledge base.",
              results: [],
            };
          }

          const formattedResults = data.results.map((result) => ({
            rank: result.rank,
            chunkId: result.chunkId,
            documentId: result.documentId,
            content: result.content,
            source: result.source,
            relevance: `${(result.similarity * 100).toFixed(1)}%`,
            similarity: result.similarity,
            pageNumber: result.pageNumber,
            figureUrls: result.figureUrls,
          }));

          return {
            success: true,
            message:
              `Found ${data.results.length} relevant chunks from the project knowledge base (${data.backend}). ` +
              "Cite chunks using [rank] inline markers and include supporting quotes in a <CITATIONS> block.",
            results: formattedResults,
            context: data.context,
          };
        }

        const { searchKnowledgeBaseServer } = await import(
          "./search-knowledge-base"
        );

        const data = await searchKnowledgeBaseServer({
          query,
          userId: _customerId,
          limit,
          threshold,
        });

        const results = data.results;

        if (results.length === 0) {
          return {
            success: true,
            message:
              data.emptyMessage ||
              data.diagnostics?.hint ||
              "No relevant information found in the knowledge base.",
            results: [],
            diagnostics: data.diagnostics,
          };
        }

        const formattedResults = results.map((result: any, index: number) => ({
          rank: index + 1,
          chunkId: result.chunkId,
          documentId: result.documentId,
          content: result.content,
          source: result.filename,
          relevance: `${(result.similarity * 100).toFixed(1)}%`,
          similarity: result.similarity,
          metadata: result.metadata,
        }));

        return {
          success: true,
          message:
            `Found ${results.length} relevant chunks from the knowledge base (model: ${data.model}). ` +
            "Cite chunks using [rank] inline markers and include supporting quotes in a <CITATIONS> block.",
          results: formattedResults,
          context: results.map((r: any) => r.content).join("\n\n---\n\n"),
        };
      })
        .ifFail((error) => ({
          success: false,
          error: error.message,
          results: [],
        }))
        .unwrap();
    },
  });

/**
 * Server-side search function (for direct API use)
 */
export async function searchKnowledgeBaseServer(
  params: SearchKnowledgeBaseParams & { userId: string },
) {
  const { embedRagText } = await import("@/lib/ai/rag/embed-rag");
  const { RAG_EMBEDDING_MODEL_ID } = await import(
    "@/lib/ai/rag/embedding-models"
  );
  const {
    searchDocumentEmbeddings,
    getRagSearchIndexCounts,
    searchDocumentEmbeddingsRelaxed,
  } = await import("@/lib/ai/rag/search");

  const { query, projectId, userId, limit = 5, threshold = 0.5 } = params;

  console.info("[RAG search] start", {
    projectId: projectId ?? null,
    userIdPrefix: `${userId.slice(0, 8)}…`,
    queryLength: query.length,
    threshold,
  });

  let result;
  try {
    result = await embedRagText(query);
  } catch (err) {
    console.error(
      "[RAG search] query embedding failed (check AI_GATEWAY_API_KEY / gateway)",
      err,
    );
    throw err;
  }

  let results = await searchDocumentEmbeddings({
    queryEmbedding: result.embedding,
    userId,
    projectId,
    limit,
    similarityThreshold: threshold,
  });

  const counts = await getRagSearchIndexCounts(userId, projectId);

  if (results.length === 0 && counts.embeddingRowCount > 0) {
    const retry = await searchDocumentEmbeddings({
      queryEmbedding: result.embedding,
      userId,
      projectId,
      limit,
      similarityThreshold: 0.35,
    });
    if (retry.length > 0) {
      console.info("[RAG search] retry at threshold 0.35", {
        projectId: projectId ?? null,
        count: retry.length,
      });
      results = retry;
    }
  }

  if (results.length === 0 && counts.embeddingRowCount > 0) {
    const relaxed = await searchDocumentEmbeddingsRelaxed({
      queryEmbedding: result.embedding,
      userId,
      projectId,
      limit: Math.min(limit, 5),
    });
    const top = relaxed[0]?.similarity;
    if (relaxed.length > 0 && top !== undefined && top >= 0.22) {
      console.info("[RAG search] using relaxed top-k (low-confidence recall)", {
        projectId: projectId ?? null,
        topSimilarity: top,
      });
      results = relaxed;
    }
  }

  if (results.length > 0) {
    console.info("[RAG search] hits", {
      count: results.length,
      projectId: projectId ?? null,
      topSimilarity: results[0]?.similarity,
    });
    return {
      query,
      results,
      model: RAG_EMBEDDING_MODEL_ID,
      count: results.length,
    };
  }

  const relaxedOne = await searchDocumentEmbeddingsRelaxed({
    queryEmbedding: result.embedding,
    userId,
    projectId,
    limit: 1,
  });
  const bestSimilarity = relaxedOne[0]?.similarity ?? null;

  const diagnostics = {
    index: "postgres_pgvector" as const,
    storageNote:
      "Vectors live in Postgres (POSTGRES_URL), not Supabase REST. Upload/ingest must use the same DB as search.",
    projectId: projectId ?? null,
    chunkCount: counts.chunkCount,
    embeddingRowCount: counts.embeddingRowCount,
    similarityThresholdUsed: threshold,
    bestSimilaritySeen: bestSimilarity,
    hint:
      counts.embeddingRowCount === 0
        ? "No embeddings in Postgres for this scope. Confirm document_chunk and document_embedding rows exist for this user_id/project_id; run pnpm rag:backfill-embeddings if chunks exist without vectors."
        : bestSimilarity != null
          ? `Strongest match similarity was ${bestSimilarity.toFixed(3)} (below thresholds ${threshold} / 0.35). Try a phrase from the document or lower threshold.`
          : "No indexed chunks matched this query.",
  };

  console.warn("[RAG search] no results after fallbacks", diagnostics);

  return {
    query,
    results: [],
    model: RAG_EMBEDDING_MODEL_ID,
    count: 0,
    diagnostics,
    emptyMessage: diagnostics.hint,
  };
}
