import "server-only";
import { and, eq } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainContentChunkTable } from "@/lib/db/pg/schema.pg";
import { embedRagText } from "@/lib/ai/rag/embed-rag";

function chunkText(value: string, size = 1600, overlap = 180) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

export async function replaceProjectBrainChunks(input: {
  projectId: string;
  userId: string;
  pageId?: string | null;
  sourceId?: string | null;
  chunkType: "compiled_truth" | "timeline" | "raw_source" | "summary";
  text: string;
  metadata?: Record<string, unknown>;
}) {
  if (input.pageId) {
    await pgDb
      .delete(ProjectBrainContentChunkTable)
      .where(
        and(
          eq(ProjectBrainContentChunkTable.projectId, input.projectId),
          eq(ProjectBrainContentChunkTable.pageId, input.pageId),
          eq(ProjectBrainContentChunkTable.chunkType, input.chunkType),
        ),
      );
  }

  if (input.sourceId) {
    await pgDb
      .delete(ProjectBrainContentChunkTable)
      .where(
        and(
          eq(ProjectBrainContentChunkTable.projectId, input.projectId),
          eq(ProjectBrainContentChunkTable.sourceId, input.sourceId),
          eq(ProjectBrainContentChunkTable.chunkType, input.chunkType),
        ),
      );
  }

  const chunks = chunkText(input.text);
  if (!chunks.length) return [];

  const rows = await Promise.all(
    chunks.map(async (content, index) => {
      // An embedding-provider failure must never kill the ingest pipeline
      // (brain pages, timeline, widgets). Store the chunk without a vector —
      // semantic search degrades for this chunk, everything else proceeds.
      let embedding: number[] | null = null;
      try {
        embedding = (await embedRagText(content)).embedding;
      } catch (error) {
        console.warn(
          "[projectBrain] chunk embedding failed, storing without vector:",
          error instanceof Error ? error.message : error,
        );
      }
      return {
        projectId: input.projectId,
        userId: input.userId,
        pageId: input.pageId ?? null,
        sourceId: input.sourceId ?? null,
        chunkType: input.chunkType,
        content,
        chunkIndex: index,
        embedding,
        metadata: input.metadata ?? {},
      };
    }),
  );

  return pgDb.insert(ProjectBrainContentChunkTable).values(rows).returning();
}
