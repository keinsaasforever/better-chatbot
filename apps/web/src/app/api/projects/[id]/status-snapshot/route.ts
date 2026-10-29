import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { requireProjectAccess } from "@/lib/projects/access";
import { getLatestProjectStatusSnapshot } from "@/lib/project-brain/generated-insights";

export const GET = withAuth(
  async (
    _request: Request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId, userId: session.user.id });

    const snapshot = await getLatestProjectStatusSnapshot(projectId);
    return NextResponse.json({ snapshot });
  },
);
