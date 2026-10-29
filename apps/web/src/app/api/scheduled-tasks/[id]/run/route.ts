import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ScheduledTaskTable } from "@/lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";
import { runScheduledTaskNow } from "@/lib/scheduled-tasks/runner";

// The run holds this route open for the full loopback /api/chat stream.
export const maxDuration = 300;

/**
 * POST /api/scheduled-tasks/[id]/run
 * Runs the scheduled task once, synchronously, WITHOUT Inngest — a manual
 * "Run now" that tests the whole agent-run route on demand and isolates
 * Inngest-connectivity issues from run-logic issues.
 */
export const POST = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;

      // Ownership check before running (the runner itself is org/agent aware
      // but the task row must belong to the caller).
      const [task] = await pgDb
        .select({ id: ScheduledTaskTable.id })
        .from(ScheduledTaskTable)
        .where(
          and(
            eq(ScheduledTaskTable.id, id),
            eq(ScheduledTaskTable.userId, session.user.id),
          ),
        )
        .limit(1);

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      const outcome = await runScheduledTaskNow(id);
      return NextResponse.json(outcome);
    } catch (error) {
      console.error("Error running scheduled task:", error);
      return NextResponse.json(
        { error: "Failed to run scheduled task" },
        { status: 500 },
      );
    }
  },
);
