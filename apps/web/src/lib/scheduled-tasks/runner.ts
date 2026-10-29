import "server-only";
import { parseAgentModel } from "@/lib/ai/agent-model";
import { SCHEDULED_TASK_ID_HEADER } from "@/lib/chat/run-mode";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  AgentTable,
  ScheduledTaskTable,
  UserTable,
} from "@/lib/db/pg/schema.pg";
import { createNotifications } from "@/lib/notifications/create-notifications";
import { eq, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import logger from "logger";
import {
  type StreamOutcome,
  isFailedRunFinishReason,
  isTransientChatFailure,
  readStreamOutcome,
} from "./chat-failure";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string | null | undefined): value is string {
  return !!value && UUID_REGEX.test(value);
}

export type ScheduledRunResult = {
  success: boolean;
  error?: string;
  threadId: string | null;
};

// Loose row shapes: the scheduled-task/agent rows carry many columns the runner
// doesn't touch. Matches the pragmatic typing the executor already used.
type ScheduledTaskRow = typeof ScheduledTaskTable.$inferSelect;
type AgentRow = typeof AgentTable.$inferSelect;
type UserRow = typeof UserTable.$inferSelect;
type TaskWithRelations = ScheduledTaskRow & {
  user: UserRow | null;
  agent: AgentRow | null;
};

export type LoadScheduledTaskResult =
  | { ok: true; task: TaskWithRelations; agent: AgentRow }
  | { ok: false; reason: string };

// Minimal structural shapes the run/record steps actually read. Decoupled from
// TaskWithRelations/AgentRow so values that cross an Inngest step boundary
// (where Dates are JSON-serialized to strings) still type-check.
type RunnableTask = {
  id: string;
  userId: string;
  agentId: string | null;
  inputPrompt: string | null;
  lastChatThreadId: string | null;
};
type RunnableAgent = {
  name: string | null;
  description: string | null;
  icon?: unknown;
  model: string | null;
  organizationId: string | null;
};

/**
 * Loads a scheduled task with its user + agent and verifies the run is
 * allowed (user exists/not banned, agent exists and is accessible). Shared by
 * the Inngest executor and the synchronous run-now path. Does NOT gate on
 * `enabled` — callers decide (the cron path skips disabled tasks; a manual
 * run-now is allowed regardless).
 */
export async function loadScheduledTaskContext(
  taskId: string,
): Promise<LoadScheduledTaskResult> {
  const [row] = await pgDb
    .select()
    .from(ScheduledTaskTable)
    .leftJoin(UserTable, eq(ScheduledTaskTable.userId, UserTable.id))
    .leftJoin(AgentTable, eq(ScheduledTaskTable.agentId, AgentTable.id))
    .where(eq(ScheduledTaskTable.id, taskId));

  if (!row) return { ok: false, reason: "Task not found" };

  const task: TaskWithRelations = {
    ...row.scheduled_task,
    user: row.user,
    agent: row.agent,
  };

  if (!task.user || task.user.banned) {
    return { ok: false, reason: !task.user ? "User not found" : "User banned" };
  }
  if (!task.agentId) {
    return { ok: false, reason: "Agent ID is missing from scheduled task" };
  }

  // Prefer the joined agent, but re-verify access; fall back to a direct load.
  let agent = task.agent;
  if (
    !agent ||
    !(
      agent.userId === task.userId ||
      agent.visibility === "public" ||
      agent.visibility === "readonly"
    )
  ) {
    const [agentRow] = await pgDb
      .select()
      .from(AgentTable)
      .where(eq(AgentTable.id, task.agentId));
    if (
      agentRow &&
      (agentRow.userId === task.userId ||
        agentRow.visibility === "public" ||
        agentRow.visibility === "readonly")
    ) {
      agent = agentRow;
    } else {
      logger.error("Scheduled task agent not found or not accessible", {
        taskId: task.id,
        agentId: task.agentId,
        userId: task.userId,
      });
      return { ok: false, reason: "Agent not found or not accessible" };
    }
  }

  return { ok: true, task, agent };
}

/**
 * Runs the agent by looping back through the app's own /api/chat (reusing the
 * whole tool/persistence/billing/streaming pipeline). Transient HTTP/network
 * failures THROW so the Inngest step retries; permanent 4xx are returned as a
 * failure. The synchronous runner (runScheduledTaskNow) catches the throw.
 */
export async function executeAgentRun(
  task: RunnableTask,
  agent: RunnableAgent,
): Promise<ScheduledRunResult> {
  const threadId = isValidUUID(task.lastChatThreadId)
    ? task.lastChatThreadId
    : generateUUID();

  const messageText = task.inputPrompt
    ? task.inputPrompt
    : `Scheduled run for ${agent.name || "agent"} at ${new Date().toISOString()}`;

  const requestBody = {
    id: threadId,
    message: {
      id: `msg-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: messageText }],
    },
    toolChoice: "auto",
    chatModel: parseAgentModel(agent.model) ?? undefined,
    mentions: [
      {
        type: "agent",
        name: agent.name || "Scheduled Agent",
        agentId: task.agentId,
        description: agent.description || null,
        icon: agent.icon || null,
      },
    ],
  };

  // Fail loud on missing config. Previously `SCHEDULED_TASK_SECRET!` was sent
  // unguarded: if unset, the header became the string "undefined", middleware
  // failed its guard and redirected to /sign-in, `fetch` followed the redirect,
  // /sign-in returned 200, and the run was recorded as a SUCCESS with no agent
  // run having happened. Returning a failure result (not throwing) marks this
  // permanent so the Inngest executor does not burn its retries on it.
  const secret = process.env.SCHEDULED_TASK_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!secret || !baseUrl) {
    const missing = [
      !secret && "SCHEDULED_TASK_SECRET",
      !baseUrl && "NEXT_PUBLIC_BASE_URL",
    ]
      .filter(Boolean)
      .join(", ");
    return {
      success: false,
      error: `Scheduled run misconfigured: missing ${missing}`,
      threadId,
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Scheduled-Task-Auth": secret,
    "X-User-Id": task.userId,
    // Names the task whose per-task grants (may this run drive a browser, with
    // which credentials) the chat route should load. Only meaningful once the
    // secret above has been verified.
    [SCHEDULED_TASK_ID_HEADER]: task.id,
  };
  if (agent.organizationId) {
    headers["X-Organization-Id"] = agent.organizationId;
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    // Do NOT follow redirects. A 3xx here means the auth bounce above — treat it
    // as a hard failure instead of silently landing on /sign-in and reporting
    // success.
    redirect: "manual",
  });

  if (response.status >= 300 && response.status < 400) {
    return {
      success: false,
      error:
        "Scheduled run auth bounce (redirected) — check SCHEDULED_TASK_SECRET",
      threadId,
    };
  }

  if (!response.ok) {
    if (isTransientChatFailure(response.status)) {
      throw new Error(`Transient chat failure: HTTP ${response.status}`);
    }
    return {
      success: false,
      error: `Chat request rejected: HTTP ${response.status}`,
      threadId,
    };
  }

  // The chat route streams an event stream. An HTML/JSON body here means we did
  // not actually reach the streaming handler (e.g. an auth page), so refuse to
  // record it as a successful run.
  const contentType = response.headers.get("content-type") ?? "";
  if (!isEventStreamContentType(contentType)) {
    return {
      success: false,
      error: `Unexpected scheduled run response (content-type: ${
        contentType || "none"
      })`,
      threadId,
    };
  }

  // Draining is not enough on its own: the stream closes cleanly even when the
  // model's loop stopped on a tool call nothing could answer, and that used to
  // be recorded as a successful run.
  const { finishReason, blockedReason } = await drainStream(response);
  logger.info(
    `[scheduled-tasks] run finished taskId=${task.id} finishReason=${finishReason ?? "none"}${
      blockedReason ? " blocked" : ""
    }`,
  );
  // Checked before the finish reason, because a blocked run finishes normally.
  // The browser agent hitting an identity check with nobody to answer it ends
  // the turn with `stop`, and this used to be recorded as a success — the run
  // did nothing and the owner was told it had finished.
  if (blockedReason) {
    return {
      success: false,
      error: `Run stopped: ${blockedReason}`,
      threadId,
    };
  }
  if (isFailedRunFinishReason(finishReason)) {
    return {
      success: false,
      error: finishReason
        ? `Run ended without an answer (finishReason: ${finishReason})`
        : "Run ended without completing",
      threadId,
    };
  }
  return { success: true, threadId };
}

// The chat route responds with an SSE/UI-message stream. Accept the known
// streaming content-types; reject text/html (an auth bounce) and the like.
function isEventStreamContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("text/event-stream") ||
    normalized.includes("application/octet-stream") ||
    normalized.includes("text/plain")
  );
}

/**
 * Bytes of stream tail kept while draining. The terminal `finish` frame is the
 * only part that is read, so this only has to be wide enough to hold the last
 * few frames intact — an agent run's full stream can be megabytes.
 */
const FINISH_TAIL_CHARS = 64_000;

// Drain the SSE stream to completion. The chat route persists the assistant
// message in onEnd, which only settles once the stream finishes. The body is
// not otherwise needed, so only the tail is retained — enough to read the run's
// outcome off the terminal `finish` frame.
async function drainStream(response: Response): Promise<StreamOutcome> {
  const reader = response.body?.getReader();
  if (!reader) return { finishReason: undefined, blockedReason: undefined };
  const decoder = new TextDecoder();
  let tail = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    tail += decoder.decode(value, { stream: true });
    if (tail.length > FINISH_TAIL_CHARS) {
      tail = tail.slice(-FINISH_TAIL_CHARS);
    }
  }
  tail += decoder.decode();
  return readStreamOutcome(tail);
}

/**
 * Persists the run outcome: atomic counter increments + last-run fields, then a
 * notification row and web push. Shared by both run paths.
 */
export async function recordScheduledRunResult(
  taskId: string,
  task: RunnableTask,
  agent: RunnableAgent,
  result: ScheduledRunResult,
) {
  await pgDb
    .update(ScheduledTaskTable)
    .set({
      lastRunAt: new Date(),
      lastRunStatus: result.success ? "success" : "failure",
      lastRunError: result.success ? null : (result.error ?? "Run failed"),
      lastChatThreadId: result.threadId ?? task.lastChatThreadId ?? null,
      runCount: sql`COALESCE(${ScheduledTaskTable.runCount}, 0) + 1`,
      ...(result.success
        ? {
            successCount: sql`COALESCE(${ScheduledTaskTable.successCount}, 0) + 1`,
          }
        : {
            failureCount: sql`COALESCE(${ScheduledTaskTable.failureCount}, 0) + 1`,
          }),
    })
    .where(eq(ScheduledTaskTable.id, taskId));

  const agentName = agent.name || "Agent";
  const title = result.success
    ? `${agentName} finished a scheduled run`
    : `${agentName} scheduled run failed`;
  const body = result.success
    ? (task.inputPrompt ?? null)
    : (result.error ?? null);

  await createNotifications({
    userIds: [task.userId],
    type: result.success ? "scheduled_run_success" : "scheduled_run_failure",
    title,
    body,
    threadId: isValidUUID(result.threadId) ? result.threadId : null,
    agentId: task.agentId,
    url: result.threadId ? `/chat/${result.threadId}` : "/agents",
    push: {
      kind: result.success ? "complete" : "error",
      tag: `scheduled-task-${task.id}`,
    },
  });
}

export type RunScheduledTaskOutcome =
  | ScheduledRunResult
  | { skipped: true; reason: string };

/**
 * Runs a scheduled task once, synchronously, WITHOUT Inngest. Used by the
 * run-now route so a user can test the full agent-run route on demand
 * independent of the Inngest cron/sync. Always records the outcome + notifies,
 * mirroring the scheduled path.
 */
export async function runScheduledTaskNow(
  taskId: string,
): Promise<RunScheduledTaskOutcome> {
  const ctx = await loadScheduledTaskContext(taskId);
  if (!ctx.ok) return { skipped: true, reason: ctx.reason };

  let result: ScheduledRunResult;
  try {
    result = await executeAgentRun(ctx.task, ctx.agent);
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : "Chat request failed",
      threadId: null,
    };
  }

  await recordScheduledRunResult(taskId, ctx.task, ctx.agent, result);
  return result;
}
