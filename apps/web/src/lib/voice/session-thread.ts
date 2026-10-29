import "server-only";
import type { UIMessage } from "ai";
import { chatRepository } from "lib/db/repository";
import globalLogger from "logger";
import {
  capVoiceTurnParts,
  deriveVoiceThreadTitle,
  type VoiceSessionThreadRequest,
} from "./session-thread-contract";
import { VoiceActor } from "./types";

const logger = globalLogger.withDefaults({ message: "Voice Thread: " });

export type PersistVoiceSessionResult =
  | { ok: true; threadId: string; created: boolean; persisted: number }
  | { ok: false; code: "forbidden" };

/**
 * Write a batch of completed voice turns into the session's chat thread.
 *
 * The thread id comes from the client, which mints one per voice session, so
 * ownership is checked rather than assumed: a caller could otherwise name any
 * thread id and append to someone else's conversation. `onConflictDoNothing`
 * on the create makes the first flush and every later one take the same path,
 * and messages upsert on their realtime id, so a re-sent turn is corrected in
 * place instead of duplicated.
 */
export async function persistVoiceSessionTurns({
  actor,
  request,
  fallbackTitle,
}: {
  actor: VoiceActor;
  request: VoiceSessionThreadRequest;
  /** Used when the batch has no user speech to name the thread after. */
  fallbackTitle: string;
}): Promise<PersistVoiceSessionResult> {
  const existing = await chatRepository.selectThread(request.threadId);
  if (existing && existing.userId !== actor.userId) {
    return { ok: false, code: "forbidden" };
  }

  let created = false;
  if (!existing) {
    await chatRepository.insertThreadWithDefaults({
      id: request.threadId,
      title: deriveVoiceThreadTitle(
        request.turns,
        request.title?.trim() || fallbackTitle,
      ),
      userId: actor.userId,
      projectId: actor.projectId ?? undefined,
    });
    created = true;
  }

  let persisted = 0;
  for (const turn of request.turns) {
    try {
      await chatRepository.upsertMessage({
        // Namespaced by thread: `chat_message.id` is a global primary key and
        // the upsert updates a row's parts without moving its `thread_id`, so
        // a realtime id that happened to collide with an existing message
        // would rewrite that other conversation's turn.
        id: `${request.threadId}:${turn.id}`,
        threadId: request.threadId,
        role: turn.role,
        parts: capVoiceTurnParts(turn.parts) as UIMessage["parts"],
        metadata: {
          source: "voice_realtime",
          voiceSessionId: request.voiceSessionId,
          ...(request.agentId ? { agentId: request.agentId } : {}),
        },
      });
      persisted += 1;
    } catch (error) {
      // One malformed turn must not cost the rest of the conversation: the
      // whole point of this is that the user keeps what was said.
      logger.warn(
        `Failed to persist turn ${turn.id}`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { ok: true, threadId: request.threadId, created, persisted };
}
