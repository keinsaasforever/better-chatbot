import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ChatThreadTable } from "@/lib/db/pg/schema.pg";
import { enqueueProjectBrainRun } from "@/lib/project-brain/enqueue";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export async function PUT(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; threadId: string }>;
  },
) {
  try {
    const { id: projectId, threadId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });

    const [thread] = await pgDb
      .select()
      .from(ChatThreadTable)
      .where(
        and(
          eq(ChatThreadTable.id, threadId),
          eq(ChatThreadTable.userId, actor.userId),
        ),
      )
      .limit(1);

    if (!thread) {
      return NextResponse.json(
        {
          error: {
            code: "thread_not_found",
            message: "Thread not found.",
          },
        },
        { status: 404 },
      );
    }

    await pgDb
      .update(ChatThreadTable)
      .set({ projectId })
      .where(eq(ChatThreadTable.id, threadId));

    const run = await enqueueProjectBrainRun({
      projectId,
      actorUserId: actor.userId,
      sourceType: "chat",
      sourceRef: threadId,
      sourceScope: `chat:${threadId}`,
      trigger: "thread_assigned",
      idempotencyKey: `thread-assigned:${projectId}:${threadId}`,
    });

    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; threadId: string }>;
  },
) {
  try {
    const { id: projectId, threadId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });

    await pgDb
      .update(ChatThreadTable)
      .set({ projectId: null })
      .where(
        and(
          eq(ChatThreadTable.id, threadId),
          eq(ChatThreadTable.projectId, projectId),
          eq(ChatThreadTable.userId, actor.userId),
        ),
      );

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
