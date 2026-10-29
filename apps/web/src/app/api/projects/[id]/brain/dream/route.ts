import { enqueueProjectDream } from "@/lib/project-brain/dream";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { NextResponse } from "next/server";

// POST: run the enrichment pass (dedupe, contradictions, salience) now
// instead of waiting for the nightly scheduler.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId, minRole: "editor" });
    await enqueueProjectDream({ projectId, reason: "manual" });
    return NextResponse.json({ queued: true }, { status: 202 });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
