import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { triggerScheduledTaskForUser } from "@/lib/scheduled-tasks/trigger";

/**
 * POST /api/scheduled-tasks/[id]/trigger
 * Manually trigger a scheduled task
 */
export const POST = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;

      const task = await triggerScheduledTaskForUser(session.user.id, id);
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: "Task triggered successfully",
      });
    } catch (error) {
      console.error("Error triggering scheduled task:", error);
      return NextResponse.json(
        { error: "Failed to trigger scheduled task" },
        { status: 500 },
      );
    }
  },
);
