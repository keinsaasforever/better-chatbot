import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { PushSubscriptionTable } from "@/lib/db/pg/schema.pg";
import { isWebPushConfigured } from "@/lib/push/web-push-client";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export const POST = withAuth(async (request, session) => {
  try {
    const body = SubscribeSchema.parse(await request.json());
    const userAgent = request.headers.get("user-agent") ?? undefined;

    await pgDb
      .insert(PushSubscriptionTable)
      .values({
        userId: session.user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [PushSubscriptionTable.userId, PushSubscriptionTable.endpoint],
        set: {
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to subscribe" },
      { status: 400 },
    );
  }
});

export const DELETE = withAuth(async (request, session) => {
  try {
    const body = UnsubscribeSchema.parse(await request.json());

    await pgDb
      .delete(PushSubscriptionTable)
      .where(
        and(
          eq(PushSubscriptionTable.userId, session.user.id),
          eq(PushSubscriptionTable.endpoint, body.endpoint),
        ),
      );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to unsubscribe" },
      { status: 400 },
    );
  }
});

export const GET = withAuth(async (_request, _session) => {
  return NextResponse.json({
    configured: isWebPushConfigured(),
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  });
});
