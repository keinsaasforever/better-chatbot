import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { NotificationTable } from "@/lib/db/pg/schema.pg";
import { and, eq, inArray, isNull } from "drizzle-orm";
import z from "zod";

const MarkReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(100).optional(),
    all: z.boolean().optional(),
  })
  .strip();

/**
 * POST /api/notifications/read
 * Mark notifications as read: { ids: [...] } or { all: true }.
 */
export const POST = withAuth(async (request, session) => {
  try {
    const parsed = MarkReadSchema.safeParse(await request.json());
    if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const { ids, all } = parsed.data;

    await pgDb
      .update(NotificationTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(NotificationTable.userId, session.user.id),
          isNull(NotificationTable.readAt),
          all ? undefined : inArray(NotificationTable.id, ids!),
        ),
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking notifications read:", error);
    return NextResponse.json(
      { error: "Failed to update notifications" },
      { status: 500 },
    );
  }
});
