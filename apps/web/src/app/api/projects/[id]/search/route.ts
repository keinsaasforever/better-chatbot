import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { searchProjectKnowledge } from "@/lib/agentset/retrieval";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export const POST = withAuth(
  async (
    request: Request,
    _session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id: projectId } = await params;
      const { query, limit = 5 } = await request.json();

      if (!query || typeof query !== "string") {
        return NextResponse.json(
          { error: "Query is required and must be a string" },
          { status: 400 },
        );
      }

      const { project } = await requireProjectAccess({ projectId });

      const out = await searchProjectKnowledge({
        userId: project.ownerUserId,
        projectId,
        query,
        limit: typeof limit === "number" ? limit : 5,
      });

      return NextResponse.json({
        query,
        backend: out.backend,
        results: out.results,
        count: out.results.length,
      });
    } catch (error) {
      const accessError = toProjectErrorResponse(error);
      if (accessError) return accessError;
      console.error("[RAG search] API /projects/[id]/search failed:", error);
      return NextResponse.json(
        { error: "Failed to search documents" },
        { status: 500 },
      );
    }
  },
);
