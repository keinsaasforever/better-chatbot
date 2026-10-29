import { NextResponse } from "next/server";
import { getProjectGraphNodeDetail } from "@/lib/project-brain/graph";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
) {
  try {
    const { id: projectId, nodeId } = await params;
    await requireProjectAccess({ projectId });
    const detail = await getProjectGraphNodeDetail({ projectId, nodeId });

    if (!detail) {
      return NextResponse.json(
        { error: { code: "node_not_found", message: "Node not found." } },
        { status: 404 },
      );
    }

    return NextResponse.json(detail);
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
