import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { NotificationTable } from "@/lib/db/pg/schema.pg";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

// Notification types are short snake_case identifiers (varchar(40)), with an
// optional `.suffix` (e.g. `cockpit_update.warn`).
const TypeListSchema = z
  .string()
  .max(400)
  .transform((v) => [...new Set(v.split(",").map((t) => t.trim()))])
  .pipe(
    z
      .array(z.string().regex(/^[a-z0-9_:.]{1,40}$/))
      .min(1)
      .max(10),
  );

/**
 * GET /api/notifications?limit=20[&type=cockpit_update,other_type]
 * Latest notifications for the current user plus the unread count. With
 * `type`, both the list and the unread count are limited to those types.
 */
export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const rawType = searchParams.get("type");
    const types = rawType === null ? null : TypeListSchema.safeParse(rawType);
    if (types && !types.success) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    const typeFilter = types?.success
      ? inArray(NotificationTable.type, types.data)
      : undefined;
    const limit = Math.min(
      Math.max(Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1),
      50,
    );

    const [notifications, [unread]] = await Promise.all([
      pgDb
        .select()
        .from(NotificationTable)
        .where(and(eq(NotificationTable.userId, session.user.id), typeFilter))
        .orderBy(desc(NotificationTable.createdAt))
        .limit(limit),
      pgDb
        .select({ count: count() })
        .from(NotificationTable)
        .where(
          and(
            eq(NotificationTable.userId, session.user.id),
            isNull(NotificationTable.readAt),
            typeFilter,
          ),
        ),
    ]);

    return NextResponse.json({
      notifications,
      unreadCount: unread?.count ?? 0,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
});
