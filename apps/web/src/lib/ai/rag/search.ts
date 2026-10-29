import { pgDb } from "@/lib/db/pg/db.pg";
import {
  DocumentTable,
  DocumentChunkTable,
  DocumentEmbeddingTable,
} from "@/lib/db/pg/schema.pg";
import { eq, sql, desc } from "drizzle-orm";

export interface SearchOptions {
  queryEmbedding: number[];
  userId: string;
  projectId?: string;
  limit?: number;
  similarityThreshold?: number;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  metadata: Record<string, any>;
  filename: string;
}

/**
 * Search document embeddings using cosine similarity
 * Uses pgvector's <=> operator for efficient similarity search
 */
export async function searchDocumentEmbeddings({
  queryEmbedding,
  userId,
  projectId,
  limit = 5,
  similarityThreshold = 0.7,
}: SearchOptions): Promise<SearchResult[]> {
  // Convert embedding array to vector string format for pgvector
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Build the query with proper joins and filtering
  const results: any = await pgDb.execute(sql`
    SELECT 
      dc.id as chunk_id,
      dc.document_id,
      dc.content,
      dc.metadata,
      d.filename,
      1 - (de.embedding <=> ${embeddingStr}::vector) as similarity
    FROM ${DocumentChunkTable} dc
    INNER JOIN ${DocumentEmbeddingTable} de ON de.chunk_id = dc.id
    INNER JOIN ${DocumentTable} d ON d.id = dc.document_id
    WHERE dc.user_id = ${userId}
      ${projectId ? sql`AND dc.project_id = ${projectId}` : sql``}
      AND de.embedding IS NOT NULL
      AND (1 - (de.embedding <=> ${embeddingStr}::vector)) >= ${similarityThreshold}
    ORDER BY de.embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);

  return (results.rows || results).map((row: any) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    similarity: parseFloat(row.similarity),
    metadata: row.metadata || {},
    filename: row.filename,
  }));
}

/** Counts for debugging empty search results (Postgres/pgvector path — not Supabase REST). */
export async function getRagSearchIndexCounts(
  userId: string,
  projectId?: string,
) {
  const scoped = projectId ? sql`AND dc.project_id = ${projectId}` : sql``;

  const row: any = await pgDb.execute(sql`
    SELECT
      COUNT(dc.id)::int AS chunk_count,
      COUNT(de.id)::int AS embedding_row_count
    FROM ${DocumentChunkTable} dc
    LEFT JOIN ${DocumentEmbeddingTable} de ON de.chunk_id = dc.id
    WHERE dc.user_id = ${userId}
      ${scoped}
  `);

  const r = (row.rows || row)[0] as {
    chunk_count: number;
    embedding_row_count: number;
  };
  return {
    chunkCount: Number(r?.chunk_count ?? 0),
    embeddingRowCount: Number(r?.embedding_row_count ?? 0),
  };
}

/**
 * Best matches with no similarity cutoff (for diagnostics / low-threshold fallback).
 */
export async function searchDocumentEmbeddingsRelaxed({
  queryEmbedding,
  userId,
  projectId,
  limit = 5,
}: Omit<SearchOptions, "similarityThreshold">): Promise<SearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results: any = await pgDb.execute(sql`
    SELECT 
      dc.id as chunk_id,
      dc.document_id,
      dc.content,
      dc.metadata,
      d.filename,
      1 - (de.embedding <=> ${embeddingStr}::vector) as similarity
    FROM ${DocumentChunkTable} dc
    INNER JOIN ${DocumentEmbeddingTable} de ON de.chunk_id = dc.id
    INNER JOIN ${DocumentTable} d ON d.id = dc.document_id
    WHERE dc.user_id = ${userId}
      ${projectId ? sql`AND dc.project_id = ${projectId}` : sql``}
      AND de.embedding IS NOT NULL
    ORDER BY de.embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);

  return (results.rows || results).map((row: any) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    similarity: parseFloat(row.similarity),
    metadata: row.metadata || {},
    filename: row.filename,
  }));
}

/**
 * Get embedding status for a project
 * Shows how many chunks have embeddings vs. pending
 */
export async function getEmbeddingStatus(projectId: string) {
  const result: any = await pgDb.execute(sql`
    SELECT 
      COUNT(dc.id) as total_chunks,
      COUNT(de.embedding) as embedded_chunks,
      COUNT(dc.id) - COUNT(de.embedding) as pending_chunks
    FROM ${DocumentChunkTable} dc
    LEFT JOIN ${DocumentEmbeddingTable} de ON de.chunk_id = dc.id
    WHERE dc.project_id = ${projectId}
  `);

  const rows = result.rows || result;
  const row = rows[0] as any;
  return {
    totalChunks: parseInt(row.total_chunks || "0"),
    embeddedChunks: parseInt(row.embedded_chunks || "0"),
    pendingChunks: parseInt(row.pending_chunks || "0"),
    progress:
      row.total_chunks > 0
        ? (parseInt(row.embedded_chunks || "0") / parseInt(row.total_chunks)) *
          100
        : 0,
  };
}

export type ProjectDocumentEmbeddingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

function resolveDocumentEmbeddingStatus(doc: {
  sourceProvider: "supabase" | "agentset";
  agentsetStatus: "pending" | "processing" | "completed" | "failed" | "skipped";
  chunkCount: number;
  embeddedCount: number;
}): ProjectDocumentEmbeddingStatus {
  if (doc.sourceProvider === "agentset") {
    if (
      doc.agentsetStatus === "completed" ||
      doc.agentsetStatus === "skipped"
    ) {
      return "completed";
    }
    if (doc.agentsetStatus === "failed") return "failed";
    if (doc.agentsetStatus === "processing") return "processing";
    return "pending";
  }

  if (doc.chunkCount === 0) return "pending";
  if (doc.chunkCount === doc.embeddedCount) return "completed";
  if (doc.embeddedCount > 0) return "processing";
  return "pending";
}

/**
 * Get recent documents in a project
 */
export async function getProjectDocuments(
  projectId: string,
  syncUserId?: string,
) {
  if (process.env.AGENTSET_API_KEY) {
    const { syncPendingAgentsetDocumentsForProject } = await import(
      "@/lib/agentset/sync-status"
    );
    if (syncUserId) {
      await syncPendingAgentsetDocumentsForProject({
        projectId,
        userId: syncUserId,
      });
    }
  }

  const documents = await pgDb
    .select({
      id: DocumentTable.id,
      storageKey: DocumentTable.storageKey, // ← Added: needed for signed URLs
      filename: DocumentTable.filename,
      contentType: DocumentTable.contentType,
      size: DocumentTable.size,
      createdAt: DocumentTable.createdAt,
      sourceProvider: DocumentTable.sourceProvider,
      agentsetStatus: DocumentTable.agentsetStatus,
      chunkCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${DocumentChunkTable} AS dc
        WHERE dc.document_id = "document"."id"
      )`,
      embeddedCount: sql<number>`(
        SELECT COUNT(de.embedding)::int
        FROM ${DocumentChunkTable} AS dc
        LEFT JOIN ${DocumentEmbeddingTable} AS de ON de.chunk_id = dc.id
        WHERE dc.document_id = "document"."id"
          AND de.embedding IS NOT NULL
      )`,
    })
    .from(DocumentTable)
    .where(eq(DocumentTable.projectId, projectId))
    .orderBy(desc(DocumentTable.createdAt));

  return documents.map((doc) => ({
    id: doc.id,
    storageKey: doc.storageKey,
    filename: doc.filename,
    contentType: doc.contentType,
    size: doc.size,
    createdAt: doc.createdAt,
    chunkCount: doc.chunkCount,
    embeddingStatus: resolveDocumentEmbeddingStatus({
      sourceProvider: doc.sourceProvider,
      agentsetStatus: doc.agentsetStatus,
      chunkCount: doc.chunkCount,
      embeddedCount: doc.embeddedCount,
    }),
  }));
}
