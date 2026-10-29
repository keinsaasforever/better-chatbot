import CronParser from "cron-parser";
import z from "zod";

// The name of a schedule within its agent (unique per agent). An agent can own
// several named schedules; absent, it defaults to "default" (the single-schedule
// case, and the natural key an upsert targets).
const ScheduleKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\w.-]+$/, "key must be alphanumeric, dot, dash or underscore");

// Which stored sign-ins a schedule may use. Validated against the caller's own
// organization in the route before it is written: the list names a capability,
// so a client must not be able to grant itself one by sending an alias.
const BrowserCredentialAliasesSchema = z
  .array(z.string().min(1).max(64))
  .max(10);

export const ScheduledTaskCreateSchema = z
  .object({
    taskType: z.literal("agent"),
    agentId: z.string().uuid(),
    key: ScheduleKeySchema.optional().default("default"),
    name: z.string().max(200).optional(),
    description: z.string().max(2000).nullish(),
    cronExpression: z.string().min(1).max(100),
    timezone: z.string().min(1).max(64),
    inputPrompt: z.string().max(8000).nullish(),
    browserAutomationEnabled: z.boolean().optional(),
    browserCredentialAliases: BrowserCredentialAliasesSchema.nullish(),
    enabled: z.boolean().optional().default(true),
  })
  .strip();

export const ScheduledTaskUpdateSchema = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(2000).nullish(),
    cronExpression: z.string().min(1).max(100).optional(),
    timezone: z.string().min(1).max(64).optional(),
    inputPrompt: z.string().max(8000).nullish(),
    browserAutomationEnabled: z.boolean().optional(),
    browserCredentialAliases: BrowserCredentialAliasesSchema.nullish(),
    enabled: z.boolean().optional(),
  })
  .strip();

/** Parses the cron with its timezone; garbage never reaches the cron checker. */
export function isValidCron(cronExpression: string, timezone: string): boolean {
  try {
    CronParser.parse(cronExpression, { tz: timezone });
    return true;
  } catch {
    return false;
  }
}

export function computeNextRunAt(
  cronExpression: string,
  timezone: string,
  now: Date = new Date(),
): Date | null {
  try {
    return CronParser.parse(cronExpression, { currentDate: now, tz: timezone })
      .next()
      .toDate();
  } catch {
    return null;
  }
}
