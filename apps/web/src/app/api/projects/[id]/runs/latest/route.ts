import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainRunTable } from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// GET: the newest brain run, reduced to what the workspace header needs.
// `errorMessage` is the short cause written by `describeRunError`, never a
// query; the full error lives in the server log.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId });

    const [run] = await pgDb
      .select({
        id: ProjectBrainRunTable.id,
        status: ProjectBrainRunTable.status,
        stage: ProjectBrainRunTable.stage,
        trigger: ProjectBrainRunTable.trigger,
        sourceType: ProjectBrainRunTable.sourceType,
        errorCode: ProjectBrainRunTable.errorCode,
        errorMessage: ProjectBrainRunTable.errorMessage,
        createdAt: ProjectBrainRunTable.createdAt,
        enqueuedAt: ProjectBrainRunTable.enqueuedAt,
        startedAt: ProjectBrainRunTable.startedAt,
        finishedAt: ProjectBrainRunTable.finishedAt,
        updatedAt: ProjectBrainRunTable.updatedAt,
      })
      .from(ProjectBrainRunTable)
      .where(eq(ProjectBrainRunTable.projectId, projectId))
      .orderBy(desc(ProjectBrainRunTable.createdAt))
      .limit(1);

    return NextResponse.json(run ?? null);
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
