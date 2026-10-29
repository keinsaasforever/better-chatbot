import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { NotificationTable } from "@/lib/db/pg/schema.pg";
import { sendPushToUser } from "@/lib/push/send-push-to-user";

export type CreateNotificationsInput = {
  userIds: string[];
  type: string;
  title: string;
  body?: string | null;
  url?: string | null;
  /**
   * Per-user idempotency key. Rows that already exist for (user, key) are
   * skipped and receive no push, so a replayed producer stays silent.
   */
  dedupeKey?: string | null;
  threadId?: string | null;
  agentId?: string | null;
  push?: { kind?: string; tag?: string } | false;
};

/**
 * Insert one in-app notification per recipient and push to the ones that were
 * actually inserted. Push failures are logged and never thrown: the bell row is
 * the durable record, push is best-effort.
 */
export async function createNotifications(input: CreateNotificationsInput) {
  const userIds = [...new Set(input.userIds)];
  if (!userIds.length)
    return { inserted: [] as Array<{ id: string; userId: string }> };

  const inserted = await pgDb
    .insert(NotificationTable)
    .values(
      userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
        dedupeKey: input.dedupeKey ?? null,
        threadId: input.threadId ?? null,
        agentId: input.agentId ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: NotificationTable.id, userId: NotificationTable.userId });

  const push = input.push === false ? null : (input.push ?? {});
  if (push && inserted.length) {
    await Promise.allSettled(
      inserted.map(async (row) => {
        try {
          await sendPushToUser(row.userId, {
            title: input.title,
            body: input.body ?? "",
            url: input.url ?? undefined,
            kind: push.kind,
            tag: push.tag,
          });
        } catch (error) {
          console.warn("[notifications] push failed", row.userId, error);
        }
      }),
    );
  }

  return { inserted };
}
