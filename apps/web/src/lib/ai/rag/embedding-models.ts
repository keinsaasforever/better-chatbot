/**
 * RAG embeddings must match `document_embedding.embedding` in
 * [schema.pg.ts](@/lib/db/pg/schema.pg.ts) (pgvector fixed width).
 */
export const RAG_VECTOR_DIMENSIONS = 1536 as const;

export const RAG_EMBEDDING_MODEL_ID = "text-embedding-3-small" as const;

export type RagEmbeddingModelId = typeof RAG_EMBEDDING_MODEL_ID;

/** AI SDK / gateway provider key for {@link RAG_EMBEDDING_MODEL_ID}. */
export const RAG_EMBEDDING_PROVIDER = "openai" as const;

export const RAG_EMBEDDING_MODEL_OPTIONS = [
  {
    id: RAG_EMBEDDING_MODEL_ID,
    name: "OpenAI text-embedding-3-small",
    dimensions: RAG_VECTOR_DIMENSIONS,
    description: "Matches the vector store (1536 dimensions)",
  },
] as const;

/**
 * Coerces API/upload input to the only model the DB column supports.
 * Logs once if a client sent a legacy or invalid id.
 */
export function resolveRagEmbeddingModel(requested?: string | null) {
  if (requested && requested !== RAG_EMBEDDING_MODEL_ID) {
    console.warn(
      `[RAG] Ignoring unsupported embedding model '${requested}'; using ${RAG_EMBEDDING_MODEL_ID} (${RAG_VECTOR_DIMENSIONS} dims).`,
    );
  }
  return RAG_EMBEDDING_MODEL_ID;
}
