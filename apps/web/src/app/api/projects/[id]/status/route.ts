import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { getEmbeddingStatus, getProjectDocuments } from "@/lib/ai/rag/search";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export const GET = withAuth(
  async (
    _request: Request,
    _session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id: projectId } = await params;
      const { project } = await requireProjectAccess({ projectId });

      // Get embedding status and documents
      const [status, documents] = await Promise.all([
        getEmbeddingStatus(projectId),
        getProjectDocuments(projectId, project.ownerUserId),
      ]);

      return NextResponse.json({
        projectId,
        ...status,
        documents,
      });
    } catch (error) {
      const accessError = toProjectErrorResponse(error);
      if (accessError) return accessError;
      console.error("Failed to get project status:", error);
      return NextResponse.json(
        { error: "Failed to get project status" },
        { status: 500 },
      );
    }
  },
);
