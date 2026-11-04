import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainRunTable } from "@/lib/db/pg/schema.pg";
import { inngest } from "@/lib/inngest/client";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { isInngestConfigured, runProjectBrainInline } from "./run-inline";

export const PROJECT_BRAIN_RUN_EVENT = "project-brain/run.requested" as const;

/** Chats feed the brain at most once per window per thread. */
export const PROJECT_CHAT_BRAIN_WINDOW_MS = 15 * 60_000;

export function projectChatBrainRunKey(threadId: string, now = Date.now()) {
  return `chat-completed:${threadId}:${Math.floor(now / PROJECT_CHAT_BRAIN_WINDOW_MS)}`;
}

export type EnqueueProjectBrainRunInput = {
  projectId: string;
  actorUserId: string;
  sourceUserId?: string;
  connectedToolId?: string | null;
  sourceType:
    | "chat"
    | "transcript"
    | "meeting"
    | "document"
    | "tool_sync"
    | "manual"
    | "agent"
    | "workflow";
  sourceRef: string;
  sourceScope: string;
  trigger:
    | "onboarding"
    | "tool_attach"
    | "manual_sync"
    | "daily_sync"
    | "chat_completed"
    | "document_ingested"
    | "voice_finalized"
    | "thread_assigned"
    | "rebuild";
  idempotencyKey: string;
};

export async function enqueueProjectBrainRun(
  input: EnqueueProjectBrainRunInput,
) {
  const [created] = await pgDb
    .insert(ProjectBrainRunTable)
    .values({
      ...input,
      sourceUserId: input.sourceUserId ?? input.actorUserId,
      connectedToolId: input.connectedToolId ?? null,
    })
    .onConflictDoNothing({
      target: [
        ProjectBrainRunTable.projectId,
        ProjectBrainRunTable.idempotencyKey,
      ],
    })
    .returning();

  const [run] = created
    ? [created]
    : await pgDb
        .select()
        .from(ProjectBrainRunTable)
        .where(
          and(
            eq(ProjectBrainRunTable.projectId, input.projectId),
            eq(ProjectBrainRunTable.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

  if (!run) {
    throw new Error("Could not resolve project brain run.");
  }

  if (!run.enqueuedAt && !isInngestConfigured()) {
    // No background queue: run it right after the response, in this request's
    // function. Outside a request (a script) there is no `after`, so it simply
    // runs now.
    await pgDb
      .update(ProjectBrainRunTable)
      .set({ enqueuedAt: new Date(), updatedAt: new Date() })
      .where(eq(ProjectBrainRunTable.id, run.id));
    try {
      after(() => runProjectBrainInline(run.id));
    } catch {
      await runProjectBrainInline(run.id);
    }
    return run;
  }

  if (!run.enqueuedAt) {
    // The row is written before dispatch (the event carries its id), so a
    // failed send would otherwise leave a row stuck at "queued" forever — which
    // reads as "a sync is already running" and blocks every later retry. Mark
    // it failed instead, then rethrow so the caller still surfaces the error.
    try {
      await inngest.send({
        id: run.id,
        name: PROJECT_BRAIN_RUN_EVENT,
        data: {
          runId: run.id,
          projectId: run.projectId,
        },
      });
    } catch (error) {
      console.error("[project-brain] failed to dispatch run", run.id, error);
      await pgDb
        .update(ProjectBrainRunTable)
        .set({
          status: "failed",
          stage: "queued",
          errorCode: "enqueue_failed",
          // Generic: this row is served to the client by runs/latest.
          errorMessage: "Could not start the background job.",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ProjectBrainRunTable.id, run.id));
      throw error;
    }

    await pgDb
      .update(ProjectBrainRunTable)
      .set({
        enqueuedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(ProjectBrainRunTable.id, run.id));
  }

  return run;
}
