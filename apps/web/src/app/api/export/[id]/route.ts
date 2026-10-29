import { withAuth } from "auth/route-guard";
import { chatExportRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

export const DELETE = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;

      // Check if user has permission to delete this export
      const hasAccess = await chatExportRepository.checkAccess(
        id,
        session.user.id,
      );

      if (!hasAccess) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      await chatExportRepository.deleteById(id);

      return NextResponse.json({ success: true });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || "Failed to delete export" },
        { status: 500 },
      );
    }
  },
);
