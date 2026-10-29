/**
 * Backfill `document_embedding` for rows in `document_chunk` that have no embedding.
 * Use when chunks were created under the old async pipeline or ingest failed after chunk insert.
 *
 * Requires: POSTGRES_URL, AI_GATEWAY_API_KEY (same as the app).
 *
 *   pnpm rag:backfill-embeddings
 *   pnpm rag:backfill-embeddings -- --project=<uuid>
 */

import { and, eq, isNull } from "drizzle-orm";
import { embedRagText } from "../apps/web/src/lib/ai/rag/embed-rag";
import { RAG_EMBEDDING_MODEL_ID } from "../apps/web/src/lib/ai/rag/embedding-models";
import { pgDb } from "../apps/web/src/lib/db/pg/db.pg";
import {
  DocumentChunkTable,
  DocumentEmbeddingTable,
} from "../apps/web/src/lib/db/pg/schema.pg";

const BATCH = 10;

function parseProjectId(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--project="));
  return arg?.split("=", 2)[1]?.trim() || undefined;
}

async function main() {
  const projectId = parseProjectId();

  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL is not set.");
    process.exit(1);
  }

  const pending = await pgDb
    .select({
      id: DocumentChunkTable.id,
      content: DocumentChunkTable.content,
    })
    .from(DocumentChunkTable)
    .leftJoin(
      DocumentEmbeddingTable,
      eq(DocumentChunkTable.id, DocumentEmbeddingTable.chunkId),
    )
    .where(
      projectId
        ? and(
            isNull(DocumentEmbeddingTable.id),
            eq(DocumentChunkTable.projectId, projectId),
          )
        : isNull(DocumentEmbeddingTable.id),
    );

  console.log(
    `Found ${pending.length} chunk(s) without embeddings${projectId ? ` (project ${projectId})` : ""}.`,
  );

  if (pending.length === 0) {
    process.exit(0);
  }

  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    const rows = await Promise.all(
      slice.map(async (row) => {
        const result = await embedRagText(row.content);
        return {
          chunkId: row.id,
          embedding: result.embedding,
          model: RAG_EMBEDDING_MODEL_ID,
        };
      }),
    );

    await pgDb.insert(DocumentEmbeddingTable).values(rows);
    console.log(
      `Inserted ${rows.length} embedding(s) (${Math.min(i + BATCH, pending.length)}/${pending.length}).`,
    );
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
