import { withAuth } from "auth/route-guard";
import { chatRepository } from "lib/db/repository";
import { getActiveStreamThreadIds } from "@/lib/ai/chat-stream-context";

// Stream pointer keys live for 360s (chat-stream-context KEY_TTL_SECONDS), so
// only threads with activity inside that horizon can possibly be running.
const RUNNING_CANDIDATE_WINDOW_MS = 6 * 60 * 1000;
const RUNNING_CANDIDATE_LIMIT = 20;

export const GET = withAuth(async (_request, session) => {
  const threads = await chatRepository.selectThreadsByUserId(session.user.id);

  // Decorate recently-active threads with a live "running" status from the
  // Redis stream pointers (covers background/scheduled runs too). Empty set
  // when Redis is unconfigured — the sidebar just shows no status.
  const now = Date.now();
  const candidates = threads
    .filter((thread) => {
      const lastActivity = new Date(
        thread.lastMessageAt || thread.createdAt,
      ).getTime();
      return now - lastActivity < RUNNING_CANDIDATE_WINDOW_MS;
    })
    .slice(0, RUNNING_CANDIDATE_LIMIT)
    .map((thread) => thread.id);
  const runningIds = await getActiveStreamThreadIds(candidates);

  return Response.json(
    threads.map((thread) => ({
      ...thread,
      status: runningIds.has(thread.id) ? ("running" as const) : undefined,
    })),
  );
});
