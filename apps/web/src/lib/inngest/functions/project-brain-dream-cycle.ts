import { and, eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectConnectedToolTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { enqueueProjectBrainRun } from "@/lib/project-brain/enqueue";

export const projectBrainDreamCycle = inngest.createFunction(
  { id: "project-brain-dream-cycle" },
  { cron: "0 5 * * *" },
  async ({ step }) => {
    const projects = await step.run("load-projects", () =>
      pgDb.select().from(ProjectTable),
    );

    let queued = 0;
    for (const project of projects) {
      const connectors = await step.run(`load-connectors-${project.id}`, () =>
        pgDb
          .select()
          .from(ProjectConnectedToolTable)
          .where(
            and(
              eq(ProjectConnectedToolTable.projectId, project.id),
              eq(ProjectConnectedToolTable.syncEnabled, true),
              eq(ProjectConnectedToolTable.status, "connected"),
            ),
          ),
      );

      for (const connector of connectors) {
        await step.run(`enqueue-${connector.id}`, async () => {
          await enqueueProjectBrainRun({
            projectId: project.id,
            actorUserId: project.ownerUserId,
            sourceUserId: connector.credentialOwnerUserId,
            connectedToolId: connector.id,
            sourceType: "tool_sync",
            sourceRef: connector.id,
            sourceScope: `tool:${connector.id}`,
            trigger: "daily_sync",
            idempotencyKey: `daily:${connector.id}:${new Date()
              .toISOString()
              .slice(0, 10)}`,
          });
          queued++;
        });
      }
    }

    return { projects: projects.length, queued };
  },
);
