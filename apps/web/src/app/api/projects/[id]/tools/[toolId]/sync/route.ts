import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectConnectedToolTable } from "@/lib/db/pg/schema.pg";
import { enqueueProjectBrainRun } from "@/lib/project-brain/enqueue";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; toolId: string }>;
  },
) {
  try {
    const { id: projectId, toolId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });

    const [connector] = await pgDb
      .select()
      .from(ProjectConnectedToolTable)
      .where(
        and(
          eq(ProjectConnectedToolTable.id, toolId),
          eq(ProjectConnectedToolTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (
      !connector ||
      connector.status !== "connected" ||
      !connector.connectionRef
    ) {
      return NextResponse.json(
        {
          error: {
            code: "connector_requires_auth",
            message: "Reconnect this connector before syncing.",
          },
        },
        { status: 409 },
      );
    }

    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim() ?? crypto.randomUUID();

    const run = await enqueueProjectBrainRun({
      projectId,
      actorUserId: actor.userId,
      sourceUserId: connector.credentialOwnerUserId,
      connectedToolId: connector.id,
      sourceType: "tool_sync",
      sourceRef: connector.id,
      sourceScope: `tool:${connector.id}`,
      trigger: "manual_sync",
      idempotencyKey,
    });

    return NextResponse.json(
      {
        runId: run.id,
        status: run.status,
        stage: run.stage,
      },
      { status: 202 },
    );
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
