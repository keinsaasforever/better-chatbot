import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { searchKnowledgeBaseServer } from "@/lib/ai/tools/knowledge-base/search-knowledge-base";

/**
 * Global knowledge base search (across all user documents)
 * For project-specific search, use /api/projects/[id]/search
 */
export const POST = withAuth(async (request, session) => {
  try {
    const {
      query,
      limit = 5,
      threshold = 0.5,
      projectId,
    } = await request.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required and must be a string" },
        { status: 400 },
      );
    }

    const results = await searchKnowledgeBaseServer({
      query,
      userId: session.user.id,
      projectId,
      limit: typeof limit === "number" ? limit : 5,
      threshold: typeof threshold === "number" ? threshold : 0.5,
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to search knowledge base:", error);
    return NextResponse.json(
      { error: "Failed to search knowledge base" },
      { status: 500 },
    );
  }
});
