import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainPageTable,
  ProjectBrainRawSourceTable,
} from "@/lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";
import { replaceProjectBrainChunks } from "./chunk";

/**
 * Re-embed the compiled truth of every page a run touched so chat retrieval
 * sees the new facts. Status and to-dos are produced by the project-level
 * consolidation step, not here.
 */
export async function materializeProjectBrainRun(input: {
  projectId: string;
  runId: string;
  sourceId: string;
  sourceScope: string;
  pageIds: string[];
}) {
  const warnings: string[] = [];
  let chunks = 0;

  const [source] = await pgDb
    .select({ sourceUserId: ProjectBrainRawSourceTable.sourceUserId })
    .from(ProjectBrainRawSourceTable)
    .where(
      and(
        eq(ProjectBrainRawSourceTable.id, input.sourceId),
        eq(ProjectBrainRawSourceTable.projectId, input.projectId),
      ),
    )
    .limit(1);

  if (!source) {
    return { chunks, warnings: ["source_not_found"] };
  }

  for (const pageId of input.pageIds) {
    try {
      const [page] = await pgDb
        .select()
        .from(ProjectBrainPageTable)
        .where(
          and(
            eq(ProjectBrainPageTable.id, pageId),
            eq(ProjectBrainPageTable.projectId, input.projectId),
          ),
        )
        .limit(1);

      if (!page) continue;

      const rows = await replaceProjectBrainChunks({
        projectId: input.projectId,
        userId: source.sourceUserId,
        pageId: page.id,
        chunkType: "compiled_truth",
        text: [page.title, page.summary, page.compiledTruth]
          .filter(Boolean)
          .join("\n\n"),
        metadata: {
          slug: page.slug,
          type: page.type,
          title: page.title,
        },
      });

      chunks += rows.length;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { chunks, warnings };
}
