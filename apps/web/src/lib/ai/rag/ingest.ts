import { Buffer } from "node:buffer";
import { embedRagText } from "@/lib/ai/rag/embed-rag";
import {
  RAG_EMBEDDING_MODEL_ID,
  resolveRagEmbeddingModel,
} from "@/lib/ai/rag/embedding-models";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  DocumentTable,
  DocumentChunkTable,
  DocumentEmbeddingTable,
} from "@/lib/db/pg/schema.pg";
import { parsePdfPreview } from "@/lib/file-ingest/pdf";

// Types
interface IngestOptions {
  fileBuffer: Buffer;
  projectId: string;
  userId: string;
  storageKey: string;
  filename: string;
  contentType: string;
  embeddingModel?: string;
}

// Chunking configuration
const CHUNK_SIZE = 1000; // Characters per chunk (approx 250-300 tokens)
const CHUNK_OVERLAP = 200; // Overlap to maintain context

/**
 * Split text into overlapping chunks
 */
function splitText(text: string, chunkSize: number, overlap: number): string[] {
  if (!text) return [];

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + chunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex);

    // Don't add tiny empty chunks
    if (chunk.trim().length > 10) {
      chunks.push(chunk);
    }

    // Move window forward, respecting overlap
    startIndex += chunkSize - overlap;

    // Prevent infinite loop if overlap >= chunkSize
    if (startIndex <= endIndex - chunkSize) {
      startIndex = endIndex;
    }
  }

  return chunks;
}

/**
 * Process a project document: Extract text, chunk, embed, and store.
 */
export async function processProjectDocument({
  fileBuffer,
  projectId,
  userId,
  storageKey,
  filename,
  contentType,
  embeddingModel: requestedEmbeddingModel = RAG_EMBEDDING_MODEL_ID,
}: IngestOptions) {
  const embeddingModel = resolveRagEmbeddingModel(requestedEmbeddingModel);

  console.log(
    `[RAG] Starting ingestion for ${filename} in project ${projectId}`,
  );

  // 1. Extract Text
  let text = "";
  let metadata: Record<string, any> = {};

  if (contentType === "application/pdf") {
    const pdfData = await parsePdfPreview(fileBuffer, { maxChars: 1000000 }); // High limit for RAG
    text = pdfData.text;
    metadata = { pages: pdfData.pages, totalChars: pdfData.totalChars };
  } else if (contentType === "text/csv") {
    // For CSVs, we might want a different strategy, but for now treat as text
    text = fileBuffer.toString("utf-8");
  } else {
    // Default to plain text
    text = fileBuffer.toString("utf-8");
  }

  if (!text || text.trim().length === 0) {
    throw new Error("No text content extracted from file");
  }

  // 2. Create Document Record
  const [doc] = await pgDb
    .insert(DocumentTable)
    .values({
      projectId,
      userId,
      storageKey,
      filename,
      contentType,
      size: fileBuffer.length,
      hash: "", // TODO: Add content hash for deduplication
    })
    .returning();

  if (!doc) throw new Error("Failed to create document record");

  // 3. Chunk Text
  const chunks = splitText(text, CHUNK_SIZE, CHUNK_OVERLAP);
  console.log(`[RAG] Created ${chunks.length} chunks for ${filename}`);

  // 4. Store chunks and generate embeddings server-side
  const BATCH_SIZE = 50;
  const allChunkRows: Array<{ id: string; content: string }> = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + BATCH_SIZE);

    const rows = await pgDb
      .insert(DocumentChunkTable)
      .values(
        batchChunks.map((content, idx) => ({
          documentId: doc.id,
          projectId,
          userId,
          content,
          chunkIndex: i + idx,
          metadata: { ...metadata, batchIndex: i },
        })),
      )
      .returning({
        id: DocumentChunkTable.id,
        content: DocumentChunkTable.content,
      });

    allChunkRows.push(...rows);
  }

  for (let i = 0; i < allChunkRows.length; i += 10) {
    const batch = allChunkRows.slice(i, i + 10);
    const embeddings = await Promise.all(
      batch.map(async (chunk) => {
        const result = await embedRagText(chunk.content);

        return {
          chunkId: chunk.id,
          embedding: result.embedding,
          model: embeddingModel,
        };
      }),
    );

    await pgDb.insert(DocumentEmbeddingTable).values(embeddings);
  }

  console.log(`[RAG] Stored ${allChunkRows.length} embeddings in Postgres.`);
  console.log(`[RAG] Ingestion complete for ${filename}`);
  return { documentId: doc.id, chunksCount: chunks.length };
}
