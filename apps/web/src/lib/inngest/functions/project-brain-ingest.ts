import { isGenerationAbortedError } from "@/lib/ai/resilient-object";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainRunTable,
  ProjectConnectedToolTable,
  ProjectTable,
} from "@/lib/db/pg/schema.pg";
import { analyzePersistedProjectBrainSource } from "@/lib/project-brain/analyze-persisted-source";
import {
  applyProjectConsolidation,
  generateProjectConsolidation,
  notifyProjectConsolidation,
} from "@/lib/project-brain/consolidate-project";
import { PROJECT_BRAIN_RUN_EVENT } from "@/lib/project-brain/enqueue";
import { materializeProjectBrainRun } from "@/lib/project-brain/materialize-run";
import { persistProjectBrainExtraction } from "@/lib/project-brain/persist-extraction";
import {
  ProjectBrainBudgetError,
  assertRunBudgetRemaining,
  extractionTimeoutMs,
} from "@/lib/project-brain/run-budget";
import { describeRunError } from "@/lib/project-brain/run-error";
import {
  ProjectSourceError,
  connectorStatusForSourceError,
  isPermanentSourceError,
  loadAndPersistProjectBrainRunSource,
  resolveSourceError,
} from "@/lib/project-brain/run-source";
import { and, eq, notInArray } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "../client";

/** `load-source`'s outcome, shaped so a permanent failure survives as data. */
type LoadSourceResult =
  | {
      ok: true;
      source: Awaited<ReturnType<typeof loadAndPersistProjectBrainRunSource>>;
    }
  | { ok: false; code: ProjectSourceError["code"]; message: string };

/** Statuses that already represent a finished run and must not be overwritten. */
const TERMINAL_STATUSES: (typeof ProjectBrainRunTable.$inferSelect)["status"][] =
  ["succeeded", "partial", "skipped", "failed"];

async function updateRun(
  runId: string,
  data: Partial<typeof ProjectBrainRunTable.$inferInsert>,
) {
  await pgDb
    .update(ProjectBrainRunTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(ProjectBrainRunTable.id, runId));
}

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
  async ({ event, step }) => {
    const runId = event.data.runId as string;
    const [loadedRun] = await step.run("load-run", () =>
      pgDb
        .select()
        .from(ProjectBrainRunTable)
        .where(eq(ProjectBrainRunTable.id, runId))
        .limit(1),
    );

    const run = loadedRun as unknown as
      | typeof ProjectBrainRunTable.$inferSelect
      | undefined;

    if (!run || ["succeeded", "partial", "skipped"].includes(run.status)) {
      return { skipped: true };
    }

    await step.run("mark-running", () =>
      updateRun(runId, {
        status: "running",
        stage: "loading_source",
        attempts: run.attempts + 1,
        startedAt: run.startedAt ?? new Date(),
        errorCode: null,
        errorMessage: null,
      }),
    );

    // Anchored to createdAt: Inngest replays memoized step output, so the
    // `run` snapshot keeps its first-attempt values and the budget therefore
    // covers every retry in aggregate rather than resetting on each one.
    const budgetAnchor = run.createdAt;

    try {
      assertRunBudgetRemaining(budgetAnchor, "loading the source");
      const loaded = await step.run(
        "load-source",
        async (): Promise<LoadSourceResult> => {
          try {
            return {
              ok: true,
              source: await loadAndPersistProjectBrainRunSource(run),
            };
          } catch (error) {
            // A revoked or re-authorised connector fails the same way on every
            // attempt. Retrying it through Inngest's backoff spends the run's
            // whole budget to reach the same answer, which is what previously
            // left nothing for extraction.
            //
            // Anything thrown from a step crosses Inngest's serialization
            // boundary, which reduces it to a plain Error and drops both the
            // ProjectSourceError instance and its `cause`. The outer catch
            // then saw no source error: the run was stored as
            // "pipeline_failed" with a generic message and the connector was
            // never flagged, so the UI never asked for a reconnect and the
            // daily cycle kept retrying a dead connection. Carry the code out
            // as data and rethrow it below, outside the step.
            const sourceError = resolveSourceError(error);
            if (sourceError && isPermanentSourceError(sourceError)) {
              return {
                ok: false,
                code: sourceError.code,
                message: sourceError.message,
              };
            }
            throw error;
          }
        },
      );

      if (!loaded.ok) {
        throw new NonRetriableError(loaded.message, {
          cause: new ProjectSourceError(loaded.code, loaded.message),
        });
      }
      const source = loaded.source;

      if (source.unchanged && run.trigger !== "rebuild") {
        await updateRun(runId, {
          status: "skipped",
          stage: "complete",
          errorCode: "source_unchanged",
          finishedAt: new Date(),
        });
        return { runId, status: "skipped" };
      }

      const remainingMs = assertRunBudgetRemaining(budgetAnchor, "extracting");
      await updateRun(runId, { stage: "extracting" });
      const extraction = await step.run("extract", () =>
        analyzePersistedProjectBrainSource({
          projectId: run.projectId,
          sourceId: source.sourceId,
          timeoutMs: extractionTimeoutMs(remainingMs),
        }),
      );

      const [project] = await pgDb
        .select({ memoryEnabled: ProjectTable.memoryEnabled })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, run.projectId))
        .limit(1);

      if (!project) throw new Error("Project not found.");

      await updateRun(runId, { stage: "persisting" });
      const persisted = await step.run("persist", () =>
        persistProjectBrainExtraction({
          runId,
          projectId: run.projectId,
          sourceId: source.sourceId,
          sourceScope: run.sourceScope,
          extraction,
          persistKnowledge: project.memoryEnabled,
        }),
      );

      await updateRun(runId, { stage: "materializing" });
      const materialized = await step.run("materialize", () =>
        materializeProjectBrainRun({
          projectId: run.projectId,
          runId,
          sourceId: source.sourceId,
          sourceScope: run.sourceScope,
          pageIds: persisted.pageIds,
        }),
      );

      // Project-level consolidation: one status + one to-do list across all
      // sources, then a digest notification. Split into three steps so a
      // retry never re-runs the LLM or re-inserts rows. Failure here is a
      // warning, not a run failure: the knowledge is already persisted.
      const warnings = [...materialized.warnings];
      let consolidation: {
        inserted: number;
        updated: number;
        closed: number;
        notified: number;
      } | null = null;
      try {
        const consolidateRemainingMs = assertRunBudgetRemaining(
          budgetAnchor,
          "consolidating",
        );
        await updateRun(runId, { stage: "consolidating" });
        const proposal = await step.run("consolidate-generate", () =>
          generateProjectConsolidation({
            projectId: run.projectId,
            runId,
            timeoutMs: extractionTimeoutMs(consolidateRemainingMs),
          }),
        );
        const applied = await step.run("consolidate-apply", () =>
          applyProjectConsolidation({
            projectId: run.projectId,
            runId,
            proposal,
          }),
        );
        const notified = await step.run("notify", () =>
          notifyProjectConsolidation({
            projectId: run.projectId,
            runId,
            notifyTodos: applied.notifyTodos,
            healthTransition: applied.healthTransition,
          }),
        );
        consolidation = { ...applied.counts, notified: notified.inserted };
      } catch (error) {
        if (error instanceof ProjectBrainBudgetError) throw error;
        console.error("[project-brain] consolidation failed", runId, error);
        warnings.push(
          `consolidation_failed: ${describeRunError(error, "consolidation_failed").message}`,
        );
      }

      const status = warnings.length ? "partial" : "succeeded";

      await updateRun(runId, {
        status,
        stage: "complete",
        metrics: {
          entities: persisted.entities,
          facts: persisted.facts,
          relations: persisted.relations,
          chunks: materialized.chunks,
          consolidation,
          warnings,
        },
        finishedAt: new Date(),
      });

      return { runId, status };
    } catch (error) {
      // The source error may be wrapped as a NonRetriableError's cause, so
      // unwrap it rather than reporting everything as "pipeline_failed".
      const sourceError = resolveSourceError(error);
      // The full error (Drizzle wrapper with SQL and params, its cause, the
      // stack) belongs in the log, not on the run row the client reads.
      console.error("[project-brain] ingest run failed", runId, error);
      const described = describeRunError(
        sourceError ?? error,
        isGenerationAbortedError(error)
          ? "generation_aborted"
          : "pipeline_failed",
      );
      const errorMessage = described.message;

      await updateRun(runId, {
        status: "failed",
        stage: "complete",
        errorCode:
          sourceError?.code ??
          (error instanceof ProjectBrainBudgetError
            ? error.code
            : described.code),
        errorMessage,
        finishedAt: new Date(),
      });

      // Surface a dead connector on the connector itself so the Brain tab can
      // prompt a reconnect and the daily cycle stops retrying it. Reattaching
      // through the tool picker resets the status to "connected".
      const connectorStatus = sourceError
        ? connectorStatusForSourceError(sourceError.code)
        : null;
      if (connectorStatus && run.connectedToolId) {
        await pgDb
          .update(ProjectConnectedToolTable)
          .set({
            status: connectorStatus,
            lastSyncError: errorMessage,
            updatedAt: new Date(),
          })
          .where(eq(ProjectConnectedToolTable.id, run.connectedToolId));
      }

      throw error;
    }
  },
);
