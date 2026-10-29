import "server-only";
import { pgDb } from "lib/db/pg/db.pg";
import { ScheduledTaskTable } from "lib/db/pg/schema.pg";
import { agentRepository } from "lib/db/repository";
import { listScheduledTasksForUser } from "lib/scheduled-tasks/list-tasks";
import {
  computeNextRunAt,
  isValidCron,
} from "lib/scheduled-tasks/schedule-validation";
import { triggerScheduledTaskForUser } from "lib/scheduled-tasks/trigger";
import { generateUUID } from "lib/utils";
import {
  createScheduledTaskSpec,
  listScheduledTasksSpec,
  runScheduledTaskSpec,
} from "../definitions";
import { requireAgentReference, trim } from "../shared";
import { NavigatorToolError, defineTool } from "../types";

const DEFAULT_TIMEZONE = "Europe/Berlin";

export const listScheduledTasksTool = defineTool(
  listScheduledTasksSpec,
  async (actor) => {
    const tasks = await listScheduledTasksForUser(actor.userId);
    return {
      tasks: tasks.slice(0, 50).map((task) => ({
        id: task.id,
        name: task.name,
        agent: task.agentName ?? null,
        cronExpression: task.cronExpression,
        timezone: task.timezone,
        enabled: task.enabled,
        nextRunAt: task.nextRunAt
          ? new Date(task.nextRunAt).toISOString()
          : null,
        lastRunAt: task.lastRunAt
          ? new Date(task.lastRunAt).toISOString()
          : null,
        lastRunStatus: task.lastRunStatus ?? null,
        lastRunError: trim(task.lastRunError, 200),
      })),
    };
  },
);

export const createScheduledTaskTool = defineTool(
  createScheduledTaskSpec,
  async (actor, args) => {
    const timezone = args.timezone ?? DEFAULT_TIMEZONE;
    if (!isValidCron(args.cronExpression, timezone)) {
      throw new NavigatorToolError(
        "invalid_arguments",
        `Invalid cron expression or timezone: "${args.cronExpression}" / "${timezone}".`,
      );
    }

    const agent = await requireAgentReference(actor, args.agent);
    // Same org-scoped predicate as POST /api/scheduled-tasks: an org-shared
    // agent can be scheduled, anything the caller cannot reach cannot.
    const hasAccess = await agentRepository.checkAccess(
      agent.id,
      actor.userId,
      false,
      actor.organizationId,
    );
    if (!hasAccess) {
      throw new NavigatorToolError(
        "not_found",
        "Agent not found or access denied.",
      );
    }

    // A fresh key per tool-created task, inserted without the route's upsert:
    // (agent_id, key) is unique, and upserting on a shared agent's "default"
    // key would rewrite whichever schedule already holds it.
    const [task] = await pgDb
      .insert(ScheduledTaskTable)
      .values({
        userId: actor.userId,
        taskType: "agent",
        agentId: agent.id,
        key: `nav-${generateUUID().slice(0, 8)}`,
        name: args.name || `Scheduled ${agent.name}`,
        description: null,
        cronExpression: args.cronExpression,
        timezone,
        inputPrompt: args.prompt || null,
        browserAutomationEnabled: false,
        enabled: true,
        nextRunAt: computeNextRunAt(args.cronExpression, timezone),
      })
      .returning({
        id: ScheduledTaskTable.id,
        name: ScheduledTaskTable.name,
        nextRunAt: ScheduledTaskTable.nextRunAt,
      });

    return {
      created: true,
      task: {
        id: task.id,
        name: task.name,
        agent: agent.name,
        cronExpression: args.cronExpression,
        timezone,
        nextRunAt: task.nextRunAt
          ? new Date(task.nextRunAt).toISOString()
          : null,
      },
    };
  },
);

export const runScheduledTaskTool = defineTool(
  runScheduledTaskSpec,
  async (actor, args) => {
    const task = await triggerScheduledTaskForUser(actor.userId, args.taskId);
    if (!task) {
      throw new NavigatorToolError("not_found", "Scheduled task not found.");
    }
    return { triggered: true, task: { id: task.id, name: task.name } };
  },
);

export const SCHEDULED_TOOLS = [
  listScheduledTasksTool,
  createScheduledTaskTool,
  runScheduledTaskTool,
];
