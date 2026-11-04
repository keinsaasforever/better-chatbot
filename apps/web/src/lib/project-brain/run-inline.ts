import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainRunTable } from "@/lib/db/pg/schema.pg";
import { and, eq, notInArray } from "drizzle-orm";
import { PROJECT_BRAIN_INLINE_RUN_BUDGET_MS } from "./run-budget";
import { TERMINAL_STATUSES, runProjectBrainPipeline } from "./run-pipeline";

/**
 * Whether brain runs can go through Inngest. Without an event key (the
 * Deploy button leaves it optional) `inngest.send` fails, so runs execute
 * inline instead. The local Inngest dev server needs no key.
 */
export function isInngestConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.INNGEST_EVENT_KEY?.trim() || env.INNGEST_DEV?.trim());
}

/**
 * Runs one brain run in this process: no retries, no step memoization, and a
 * budget that fits the request's function. Never throws; a failure settles
 * the row so the Brain tab shows it and the next sync can start.
 */
export async function runProjectBrainInline(runId: string): Promise<void> {
  try {
    await runProjectBrainPipeline({
      runId,
      step: { run: (_name, fn) => fn() },
      budgetMs: PROJECT_BRAIN_INLINE_RUN_BUDGET_MS,
    });
  } catch (error) {
    // The pipeline already settled the row for anything it caught; this only
    // covers failures before its own try/catch (loading or marking the run).
    console.error("[project-brain] inline run failed", runId, error);
    await pgDb
      .update(ProjectBrainRunTable)
      .set({
        status: "failed",
        stage: "complete",
        errorCode: "pipeline_failed",
        errorMessage: "The background job failed.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ProjectBrainRunTable.id, runId),
          notInArray(ProjectBrainRunTable.status, TERMINAL_STATUSES),
        ),
      )
      .catch(() => {});
  }
}
