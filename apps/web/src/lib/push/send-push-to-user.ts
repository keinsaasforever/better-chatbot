import { eq } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { PushSubscriptionTable } from "@/lib/db/pg/schema.pg";
import { ensureWebPushConfigured, webpush } from "@/lib/push/web-push-client";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  kind?: string;
  tag?: string;
};

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!ensureWebPushConfigured()) {
    return { sent: 0, failed: 0 };
  }

  const subscriptions = await pgDb
    .select()
    .from(PushSubscriptionTable)
    .where(eq(PushSubscriptionTable.userId, userId));

  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await pgDb
            .delete(PushSubscriptionTable)
            .where(eq(PushSubscriptionTable.id, subscription.id));
        }
      }
    }),
  );

  return { sent, failed };
}
