import { pgDb } from "@/lib/db/pg/db.pg";
import { ScheduledTaskTable } from "@/lib/db/pg/schema.pg";
import {
  computeNextRunAt,
  isValidCron,
} from "@/lib/scheduled-tasks/schedule-validation";

export async function createScheduledAgentTask(input: {
  userId: string;
  agentId: string;
  name: string;
  description?: string | null;
  cronExpression: string;
  timezone: string;
  inputPrompt?: string | null;
}) {
  // The cron here is LLM-generated from a voice transcript, i.e. untrusted. The
  // HTTP create route validates; this path bypassed it, so an invalid cron used
  // to be inserted and then silently swallowed by computeDueSlot's catch — the
  // task showed in the UI but never fired. Reject instead.
  if (!isValidCron(input.cronExpression, input.timezone)) {
    throw new Error(
      `Invalid cron expression or timezone: "${input.cronExpression}" / "${input.timezone}"`,
    );
  }

  const [task] = await pgDb
    .insert(ScheduledTaskTable)
    .values({
      userId: input.userId,
      taskType: "agent",
      agentId: input.agentId,
      name: input.name,
      description: input.description ?? null,
      cronExpression: input.cronExpression,
      timezone: input.timezone,
      inputPrompt: input.inputPrompt ?? null,
      enabled: true,
      nextRunAt: computeNextRunAt(input.cronExpression, input.timezone),
    })
    .returning();

  return task;
}
