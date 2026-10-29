import "server-only";
import { and, eq } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ScheduledTaskTable } from "@/lib/db/pg/schema.pg";
import { inngest } from "@/lib/inngest/client";

/**
 * Queue one run of the user's own scheduled task. Resolves `false` when the
 * task does not exist or belongs to someone else, so the caller can answer
 * "not found" without telling the two apart.
 *
 * No event id on purpose: manual triggers always run (scheduled fires carry a
 * deterministic id for dedup). `userId` feeds the executor's per-user
 * concurrency key. Shared by `POST /api/scheduled-tasks/[id]/trigger` and the
 * `run_scheduled_task` Navigator tool.
 */
export async function triggerScheduledTaskForUser(
  userId: string,
  taskId: string,
): Promise<{ id: string; name: string } | null> {
  const [task] = await pgDb
    .select({
      id: ScheduledTaskTable.id,
      name: ScheduledTaskTable.name,
      userId: ScheduledTaskTable.userId,
    })
    .from(ScheduledTaskTable)
    .where(
      and(
        eq(ScheduledTaskTable.id, taskId),
        eq(ScheduledTaskTable.userId, userId),
      ),
    )
    .limit(1);

  if (!task) return null;

  await inngest.send({
    name: "scheduled-task/trigger",
    data: { taskId: task.id, userId: task.userId },
  });
  return { id: task.id, name: task.name };
}
