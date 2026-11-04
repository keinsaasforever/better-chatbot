import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainRunTable } from "@/lib/db/pg/schema.pg";
import { PROJECT_BRAIN_RUN_EVENT } from "@/lib/project-brain/enqueue";
import {
  TERMINAL_STATUSES,
  runProjectBrainPipeline,
} from "@/lib/project-brain/run-pipeline";
import { and, eq, notInArray } from "drizzle-orm";
import { inngest } from "../client";

export const projectBrainIngestRun = inngest.createFunction(
  {
    id: "project-brain-ingest-run",
    retries: 3,
    idempotency: "event.data.runId",
    concurrency: { limit: 1, key: "event.data.projectId" },
    // Backstop only: the pipeline enforces its own shorter budget (see
    // run-budget.ts) so it fails in-band and settles the row, rather than
    // being cancelled here and orphaning it at "running".
    timeouts: { finish: "15m" },
    // `load-run` and `mark-running` sit outside the pipeline's try/catch, so a
    // failure there would otherwise leave the row untouched.
    onFailure: async ({ event }) => {
      const runId = event.data.event?.data?.runId as string | undefined;
      if (!runId) return;
      await pgDb
        .update(ProjectBrainRunTable)
        .set({
          status: "failed",
          stage: "complete",
          errorCode: "pipeline_failed",
          errorMessage: "The background job failed and was not retried.",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ProjectBrainRunTable.id, runId),
            notInArray(ProjectBrainRunTable.status, TERMINAL_STATUSES),
          ),
        );
    },
  },
  { event: PROJECT_BRAIN_RUN_EVENT },
  async ({ event, step }) =>
    runProjectBrainPipeline({
      runId: event.data.runId as string,
      step: step as unknown as Parameters<
        typeof runProjectBrainPipeline
      >[0]["step"],
    }),
);
