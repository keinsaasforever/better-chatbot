import { getProjectKnowledgeGraph } from "@/lib/project-brain/graph";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { NextResponse } from "next/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET ?focus=<pageId>&depth=<1-3>: the neighbourhood of one page; without
// `focus` the most salient pages of the whole project.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId });

    const url = new URL(request.url);
    const focus = url.searchParams.get("focus");
    const depthParam = Number(url.searchParams.get("depth"));

    return NextResponse.json(
      await getProjectKnowledgeGraph(projectId, {
        focus: focus && UUID.test(focus) ? focus : null,
        depth: Number.isFinite(depthParam) && depthParam > 0 ? depthParam : 2,
      }),
    );
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
