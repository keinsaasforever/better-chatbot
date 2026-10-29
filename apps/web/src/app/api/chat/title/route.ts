import { withAuth } from "auth/route-guard";
import { colorize } from "consola/utils";
import { chatRepository } from "lib/db/repository";
import globalLogger from "logger";

import { ChatModel } from "app-types/chat";
import {
  THREAD_TITLE_MODEL,
  generateThreadTitle,
} from "lib/chat/generate-thread-title";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Title API: `),
});

/**
 * Generates and persists a thread title, then returns it.
 *
 * This deliberately does not stream. The title is ~10 tokens and no surface
 * renders it progressively, while streaming forced the write into an `onEnd`
 * callback that the client's `/api/thread` refetch — and Vercel's post-response
 * freeze — could both outrun, leaving the thread titled "" forever. Persisting
 * before responding makes the caller's refetch race-free by construction.
 */
export const POST = withAuth(async (request, session) => {
  try {
    const json = await request.json();

    const {
      chatModel,
      message = "",
      threadId,
    } = json as {
      chatModel?: ChatModel;
      message: string;
      threadId: string;
    };

    if (!threadId) {
      return new Response("threadId is required", { status: 400 });
    }

    // Block renaming another user's thread. A brand-new thread does not exist
    // yet (upsert inserts it), so only reject when it exists and is owned by
    // someone else.
    const existingThread = await chatRepository.selectThread(threadId);
    if (existingThread && existingThread.userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    // Already titled — by the chat route's fallback, a rename, or a duplicate
    // request. Don't pay for a model call or overwrite a good title.
    const existingTitle = existingThread?.title?.trim();
    if (existingTitle) {
      return Response.json({ title: existingTitle });
    }

    logger.info(
      `titleModel: ${THREAD_TITLE_MODEL.provider}/${THREAD_TITLE_MODEL.model} (requested: ${chatModel?.provider}/${chatModel?.model}), threadId: ${threadId}`,
    );

    const title = await generateThreadTitle({
      seed: message,
      telemetryId: "chat.title",
      telemetryMetadata: {
        threadId,
        provider: chatModel?.provider,
        modelId: chatModel?.model,
      },
      // Intentionally not wired to request.signal: a client that navigates away
      // mid-request used to abort the run and leave the thread untitled for
      // good. The call is short and cheap; let it finish and land.
    });

    if (!title) {
      return Response.json({ title: "" });
    }

    if (!existingThread) {
      // Brand-new thread: the chat POST may not have inserted it yet.
      const created = await chatRepository.upsertThread({
        id: threadId,
        title,
        userId: session.user.id,
      });
      return Response.json({ title: created.title });
    }

    // The chat run titles an untitled thread too, so first write wins and we
    // report whatever actually stands — never a title the DB does not hold.
    const stored = await chatRepository.setThreadTitleIfEmpty(threadId, title);
    return Response.json({ title: stored });
  } catch (err) {
    logger.error(err);
    return new Response("Failed to generate thread title", { status: 500 });
  }
});
