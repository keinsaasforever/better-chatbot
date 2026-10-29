import { withAuth } from "auth/route-guard";
import { chatExportRepository } from "lib/db/repository";
import { ChatExportCommentCreateSchema } from "app-types/chat-export";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/app/api/chat/actions";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = await getUserId().catch(() => undefined);

    const comments = await chatExportRepository.selectCommentsByExportId(
      id,
      userId,
    );
    return NextResponse.json(comments);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get comments" },
      { status: 500 },
    );
  }
}

export const POST = withAuth(
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();

      const validatedData = ChatExportCommentCreateSchema.parse({
        exportId: id,
        authorId: session.user.id,
        parentId: body.parentId,
        content: body.content,
      });

      await chatExportRepository.insertComment(validatedData);

      return NextResponse.json({ success: true });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || "Failed to create comment" },
        { status: 500 },
      );
    }
  },
);
