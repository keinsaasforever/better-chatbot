import { withAuth } from "auth/route-guard";
import { chatExportRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

export const DELETE = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string; commentId: string }> },
  ) => {
    try {
      const { commentId } = await params;

      // Check if user has permission to delete this comment
      const hasAccess = await chatExportRepository.checkCommentAccess(
        commentId,
        session.user.id,
      );

      if (!hasAccess) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      await chatExportRepository.deleteComment(commentId, session.user.id);

      return NextResponse.json({ success: true });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || "Failed to delete comment" },
        { status: 500 },
      );
    }
  },
);
