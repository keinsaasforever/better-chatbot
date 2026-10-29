import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { AgentTable, ScheduledTaskTable } from "@/lib/db/pg/schema.pg";
import { computeNextRunAt } from "./schedule-validation";

/**
 * The user's own scheduled tasks, with the next run computed server-side so
 * clients never need cron math.
 *
 * Shared by `GET /api/scheduled-tasks` and the `list_scheduled_tasks`
 * Navigator tool. Owner-only: a scheduled task is never shared.
 *
 * The optional `agentId` filter exists because an agent's edit page requests
 * `?agentId=<id>` and then reads `tasks[0]`; ignoring it once handed that page
 * a DIFFERENT agent's schedule. Ordered deterministically so "first" is stable.
 */
export async function listScheduledTasksForUser(
  userId: string,
  options: { agentId?: string | null } = {},
) {
  const tasks = await pgDb
    .select({
      id: ScheduledTaskTable.id,
      userId: ScheduledTaskTable.userId,
      taskType: ScheduledTaskTable.taskType,
      agentId: ScheduledTaskTable.agentId,
      key: ScheduledTaskTable.key,
      name: ScheduledTaskTable.name,
      description: ScheduledTaskTable.description,
      cronExpression: ScheduledTaskTable.cronExpression,
      timezone: ScheduledTaskTable.timezone,
      inputPrompt: ScheduledTaskTable.inputPrompt,
      browserAutomationEnabled: ScheduledTaskTable.browserAutomationEnabled,
      browserCredentialAliases: ScheduledTaskTable.browserCredentialAliases,
      enabled: ScheduledTaskTable.enabled,
      lastRunAt: ScheduledTaskTable.lastRunAt,
      lastRunStatus: ScheduledTaskTable.lastRunStatus,
      lastRunError: ScheduledTaskTable.lastRunError,
      lastChatThreadId: ScheduledTaskTable.lastChatThreadId,
      runCount: ScheduledTaskTable.runCount,
      successCount: ScheduledTaskTable.successCount,
      failureCount: ScheduledTaskTable.failureCount,
      createdAt: ScheduledTaskTable.createdAt,
      updatedAt: ScheduledTaskTable.updatedAt,
      agentName: AgentTable.name,
    })
    .from(ScheduledTaskTable)
    .leftJoin(AgentTable, eq(ScheduledTaskTable.agentId, AgentTable.id))
    .where(
      options.agentId
        ? and(
            eq(ScheduledTaskTable.userId, userId),
            eq(ScheduledTaskTable.agentId, options.agentId),
          )
        : eq(ScheduledTaskTable.userId, userId),
    )
    .orderBy(asc(ScheduledTaskTable.createdAt), asc(ScheduledTaskTable.id));

  const now = new Date();
  return tasks.map((task) => ({
    ...task,
    nextRunAt: task.enabled
      ? computeNextRunAt(task.cronExpression, task.timezone, now)
      : null,
  }));
}
