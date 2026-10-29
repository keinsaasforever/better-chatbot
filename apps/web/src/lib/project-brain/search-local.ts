import "server-only";
import { embedRagText } from "@/lib/ai/rag/embed-rag";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainEventTable,
  ProjectBrainLinkTable,
  ProjectBrainPageTable,
} from "@/lib/db/pg/schema.pg";
import { pgArray } from "@/lib/db/pg/sql-array";
import { sql } from "drizzle-orm";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";

export async function searchProjectBrainPages(input: {
  projectId: string;
  query: string;
  limit?: number;
}) {
  const terms = input.query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `%${t}%`);

  if (terms.length === 0) return [];

  const rows = await pgDb
    .select({
      pageId: ProjectBrainPageTable.id,
      slug: ProjectBrainPageTable.slug,
      title: ProjectBrainPageTable.title,
      type: ProjectBrainPageTable.type,
      compiledTruth: ProjectBrainPageTable.compiledTruth,
      summary: ProjectBrainPageTable.summary,
      updatedAt: ProjectBrainPageTable.updatedAt,
    })
    .from(ProjectBrainPageTable)
    .where(
      and(
        eq(ProjectBrainPageTable.projectId, input.projectId),
        or(
          ...terms.flatMap((t) => [
            ilike(ProjectBrainPageTable.title, t),
            ilike(ProjectBrainPageTable.compiledTruth, t),
            ilike(ProjectBrainPageTable.summary, t),
          ]),
        ),
      ),
    )
    .orderBy(desc(ProjectBrainPageTable.updatedAt))
    .limit(input.limit ?? 10);

  return rows;
}

export async function expandProjectBrainLinks(input: {
  projectId: string;
  pageIds: string[];
  depth?: number;
}) {
  if (input.pageIds.length === 0) return [];

  const links = await pgDb
    .select({
      fromPageId: ProjectBrainLinkTable.fromPageId,
      toPageId: ProjectBrainLinkTable.toPageId,
      linkType: ProjectBrainLinkTable.linkType,
      context: ProjectBrainLinkTable.context,
    })
    .from(ProjectBrainLinkTable)
    .where(
      and(
        eq(ProjectBrainLinkTable.projectId, input.projectId),
        or(
          inArray(ProjectBrainLinkTable.fromPageId, input.pageIds),
          inArray(ProjectBrainLinkTable.toPageId, input.pageIds),
        ),
      ),
    )
    .limit(50);

  const relatedIds = [
    ...new Set(
      links
        .flatMap((l) => [l.fromPageId, l.toPageId])
        .filter((id) => !input.pageIds.includes(id)),
    ),
  ];

  if (relatedIds.length === 0) return links;

  const relatedPages = await pgDb
    .select({
      id: ProjectBrainPageTable.id,
      slug: ProjectBrainPageTable.slug,
      title: ProjectBrainPageTable.title,
      compiledTruth: ProjectBrainPageTable.compiledTruth,
    })
    .from(ProjectBrainPageTable)
    .where(
      and(
        eq(ProjectBrainPageTable.projectId, input.projectId),
        inArray(ProjectBrainPageTable.id, relatedIds),
      ),
    );

  return { links, relatedPages };
}

export async function searchProjectBrainEvents(input: {
  projectId: string;
  query: string;
  limit?: number;
}) {
  const terms = input.query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `%${t}%`);

  if (terms.length === 0) return [];

  return pgDb
    .select({
      id: ProjectBrainEventTable.id,
      sourceType: ProjectBrainEventTable.sourceType,
      eventDate: ProjectBrainEventTable.eventDate,
      summary: ProjectBrainEventTable.summary,
      detail: ProjectBrainEventTable.detail,
    })
    .from(ProjectBrainEventTable)
    .where(
      and(
        eq(ProjectBrainEventTable.projectId, input.projectId),
        or(
          ...terms.flatMap((t) => [
            ilike(ProjectBrainEventTable.summary, t),
            ilike(ProjectBrainEventTable.detail, t),
          ]),
        ),
      ),
    )
    .orderBy(desc(ProjectBrainEventTable.eventDate))
    .limit(input.limit ?? 10);
}

export type ProjectBrainChunkHit = {
  id: string;
  page_id: string | null;
  content: string;
  chunk_type: string;
  metadata: Record<string, unknown>;
  score: number;
};

/**
 * Compiled-truth chunks of specific pages, for the adjacency boost: when a
 * hub page is a strong hit, its neighbours' truth is pulled in as well.
 */
export async function loadCompiledTruthChunksForPages(input: {
  projectId: string;
  pageIds: string[];
  limit?: number;
}): Promise<ProjectBrainChunkHit[]> {
  if (!input.pageIds.length) return [];
  const rows: any = await pgDb.execute(sql`
    SELECT id, page_id, content, chunk_type, metadata, 0::float AS score
    FROM project_brain_content_chunk
    WHERE project_id = ${input.projectId}
      AND chunk_type = 'compiled_truth'
      AND page_id = ANY(${pgArray(input.pageIds, "uuid")})
    ORDER BY chunk_index
    LIMIT ${input.limit ?? 4}
  `);
  return rows as ProjectBrainChunkHit[];
}

export async function searchProjectBrainChunks(input: {
  projectId: string;
  query: string;
  limit?: number;
}) {
  const { embedding } = await embedRagText(input.query);
  const vector = `[${embedding.join(",")}]`;

  const rows: any = await pgDb.execute(sql`
    SELECT
      id,
      page_id,
      content,
      chunk_type,
      metadata,
      1 - (embedding <=> ${vector}::vector) AS score
    FROM project_brain_content_chunk
    WHERE project_id = ${input.projectId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vector}::vector
    LIMIT ${input.limit ?? 8}
  `);

  return rows as ProjectBrainChunkHit[];
}

export async function keywordSearchProjectBrainChunks(input: {
  projectId: string;
  query: string;
  limit?: number;
}) {
  const rows: any = await pgDb.execute(sql`
    SELECT
      id,
      page_id,
      content,
      chunk_type,
      metadata,
      ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', ${input.query})) AS score
    FROM project_brain_content_chunk
    WHERE project_id = ${input.projectId}
      AND to_tsvector('simple', content) @@ plainto_tsquery('simple', ${input.query})
    ORDER BY score DESC
    LIMIT ${input.limit ?? 8}
  `);

  return rows as ProjectBrainChunkHit[];
}
