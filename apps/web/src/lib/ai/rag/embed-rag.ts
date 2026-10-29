import "server-only";

import { embed } from "ai";
import { customModelProvider } from "@/lib/ai/models";
import {
  RAG_EMBEDDING_MODEL_ID,
  RAG_EMBEDDING_PROVIDER,
  RAG_VECTOR_DIMENSIONS,
} from "@/lib/ai/rag/embedding-models";

export async function embedRagText(value: string) {
  const result = await embed({
    model: customModelProvider.getModel({
      provider: RAG_EMBEDDING_PROVIDER,
      model: RAG_EMBEDDING_MODEL_ID as any,
    }) as any,
    value,
  });

  if (result.embedding.length !== RAG_VECTOR_DIMENSIONS) {
    throw new Error(
      `RAG embedding dimension mismatch: expected ${RAG_VECTOR_DIMENSIONS}, got ${result.embedding.length}`,
    );
  }

  return result;
}
