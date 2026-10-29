import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainRunTable } from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  try {
    const { id: projectId, runId } = await params;
    await requireProjectAccess({ projectId });

    const [run] = await pgDb
      .select()
      .from(ProjectBrainRunTable)
      .where(
        and(
          eq(ProjectBrainRunTable.id, runId),
          eq(ProjectBrainRunTable.projectId, projectId),
        ),
      )
      .limit(1);

    if (!run) {
      return NextResponse.json(
        {
          error: {
            code: "run_not_found",
            message: "Run not found.",
          },
        },
        { status: 404 },
      );
    }

    return NextResponse.json(run);
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
