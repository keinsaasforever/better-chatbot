import "server-only";

import { customModelProvider, projectBrainModelId } from "@/lib/ai/models";
import { generateObjectResilient } from "@/lib/ai/resilient-object";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainRawSourceTable,
  ProjectTable,
} from "@/lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";
import {
  type ProjectBrainExtraction,
  ProjectBrainExtractionSchema,
} from "./extraction-schema";
import { buildExtractionSystemPrompt } from "./prompts";

export async function analyzePersistedProjectBrainSource(input: {
  projectId: string;
  sourceId: string;
  /**
   * Upper bound for this attempt. The caller derives it from the run's
   * remaining budget so extraction cannot outlive the job that owns it.
   */
  timeoutMs?: number;
}): Promise<ProjectBrainExtraction> {
  const [context] = await pgDb
    .select({
      name: ProjectTable.name,
      goal: ProjectTable.goal,
      description: ProjectTable.description,
      systemPrompt: ProjectTable.systemPrompt,
      sourceType: ProjectBrainRawSourceTable.sourceType,
      sourceScope: ProjectBrainRawSourceTable.sourceScope,
      textContent: ProjectBrainRawSourceTable.textContent,
      rawPayload: ProjectBrainRawSourceTable.rawPayload,
    })
    .from(ProjectBrainRawSourceTable)
    .innerJoin(
      ProjectTable,
      eq(ProjectBrainRawSourceTable.projectId, ProjectTable.id),
    )
    .where(
      and(
        eq(ProjectBrainRawSourceTable.id, input.sourceId),
        eq(ProjectBrainRawSourceTable.projectId, input.projectId),
      ),
    )
    .limit(1);

  if (!context) {
    throw new Error("Project brain source not found.");
  }

  const { object } = await generateObjectResilient({
    model: projectBrainModelId,
    fallbackModel: customModelProvider.getModel(),
    label: `project-brain:${input.projectId}:${input.sourceId}`,
    schema: ProjectBrainExtractionSchema,
    abortSignal: input.timeoutMs
      ? AbortSignal.timeout(input.timeoutMs)
      : undefined,
    system: buildExtractionSystemPrompt(),
    prompt: JSON.stringify({
      projectName: context.name,
      projectGoal: context.goal ?? context.description ?? "",
      projectDescription: context.description ?? "",
      projectSystemPrompt: context.systemPrompt ?? "",
      sourceType: context.sourceType,
      sourceText: context.textContent ?? "",
      sourcePayload: context.rawPayload,
    }),
  });

  // Persist the per-source signals next to the raw text so the project-level
  // consolidation can merge every source without re-reading or re-extracting.
  // Idempotent: a retried extract step simply overwrites the same row.
  await pgDb
    .update(ProjectBrainRawSourceTable)
    .set({
      extractionSignals: {
        summary: object.summary,
        status: object.status,
        todos: object.todos,
      },
    })
    .where(eq(ProjectBrainRawSourceTable.id, input.sourceId));

  return object;
}
