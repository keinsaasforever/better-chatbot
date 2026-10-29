import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainRunTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { detectProjectContradictions } from "@/lib/project-brain/contradictions";
import { dedupeProjectPages } from "@/lib/project-brain/dedupe-pages";
import {
  PROJECT_BRAIN_DREAM_EVENT,
  enqueueProjectDream,
} from "@/lib/project-brain/dream";
import {
  archiveStalePages,
  recomputeProjectSalience,
} from "@/lib/project-brain/salience";
import { eq, sql } from "drizzle-orm";
import { inngest } from "../client";

const STEP_TIMEOUT_MS = 2 * 60_000;

/**
 * The gbrain "dream cycle": nightly enrichment that runs after the tool syncs
 * have landed. Every stage is independent; a failing stage is recorded as a
 * warning and the others still run.
 */
export const projectBrainDream = inngest.createFunction(
  {
    id: "project-brain-dream",
    retries: 1,
    concurrency: { limit: 1, key: "event.data.projectId" },
    timeouts: { finish: "12m" },
  },
  { event: PROJECT_BRAIN_DREAM_EVENT },
  async ({ event, step }) => {
    const projectId = event.data.projectId as string;
    const startedAt = new Date();
    const warnings: string[] = [];
    const metrics: Record<string, unknown> = {};

    const stage = async <T>(name: string, run: () => Promise<T>) => {
      try {
        const result = await step.run(name, run);
        metrics[name] = result;
        return result;
      } catch (error) {
        console.error(`[project-brain] dream stage ${name} failed`, error);
        warnings.push(name);
        return null;
      }
    };

    await stage("dedupe-pages", () =>
      dedupeProjectPages({ projectId, timeoutMs: STEP_TIMEOUT_MS }),
    );
    await stage("detect-contradictions", () =>
      detectProjectContradictions({ projectId, timeoutMs: STEP_TIMEOUT_MS }),
    );
    await stage("score-salience", () => recomputeProjectSalience(projectId));
    await stage("archive-stale", () => archiveStalePages(projectId));

    await step.run("record-run", async () => {
      const [project] = await pgDb
        .select({ ownerUserId: ProjectTable.ownerUserId })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, projectId))
        .limit(1);
      if (!project) return;
      const finishedAt = new Date();
      await pgDb
        .insert(ProjectBrainRunTable)
        .values({
          projectId,
          actorUserId: project.ownerUserId,
          sourceUserId: project.ownerUserId,
          sourceType: "manual",
          sourceRef: `dream:${startedAt.toISOString().slice(0, 10)}`,
          sourceScope: `dream:${projectId}`,
          trigger: "rebuild",
          idempotencyKey: `dream:${projectId}:${startedAt.getTime()}`,
          status: warnings.length ? "partial" : "succeeded",
          stage: "complete",
          metrics: { ...metrics, warnings, reason: event.data.reason },
          enqueuedAt: startedAt,
          startedAt,
          finishedAt,
        })
        .onConflictDoNothing();
    });

    return { projectId, warnings, metrics };
  },
);

/**
 * Nightly scheduler: 90 minutes after the tool syncs (05:00 UTC), every
 * project that had an ingest run in the last 24 hours gets one dream.
 */
export const projectBrainDreamScheduler = inngest.createFunction(
  { id: "project-brain-dream-scheduler" },
  { cron: "30 6 * * *" },
  async ({ step }) => {
    const projects = await step.run("load-active-projects", async () => {
      const rows = (await pgDb.execute(sql`
        SELECT DISTINCT r.project_id AS "projectId"
        FROM project_brain_run r
        WHERE r.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
          AND r.source_scope NOT LIKE 'dream:%'
      `)) as unknown as Array<{ projectId: string }>;
      return rows.map((row) => row.projectId);
    });

    for (const projectId of projects) {
      await step.run(`enqueue-${projectId}`, () =>
        enqueueProjectDream({ projectId, reason: "nightly" }),
      );
    }

    return { projects: projects.length };
  },
);
