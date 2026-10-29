import "server-only";
import Redis from "ioredis";
import globalLogger from "logger";
import { after } from "next/server";
import {
  type ResumableStreamContext,
  createResumableStreamContext,
} from "resumable-stream/ioredis";

/**
 * Redis-backed control plane for chat streams:
 *  - a resumable-stream context (buffers the live SSE so a reopened tab can
 *    catch up mid-generation), and
 *  - two tiny keys per thread: the active stream id (threadId -> streamId, so
 *    the reconnect GET can find the buffer) and a stop flag the detached /stop
 *    endpoint sets for the running function to poll.
 *
 * Everything is gated on REDIS_URL (or KV_URL, the name the Vercel/Upstash
 * integration provisions and the one `resumable-stream` itself falls back to).
 * Without either every helper is a no-op and the chat route falls back to
 * Phase 1 viewer-bound abort: a closed tab or a reload aborts the run and the
 * partial is persisted as "cancelled", with no resume and no detached stop.
 * That fallback is silent by design, so `getStreamContext` logs which mode an
 * instance is in the first time it is asked.
 */
const REDIS_URL = process.env.REDIS_URL || process.env.KV_URL;

// maxDuration on the chat route is 300s; 360s covers the longest run plus slack
// before the pointer/flag self-expire. streamId buffers keep resumable-stream's
// own 24h expiry.
const KEY_TTL_SECONDS = 360;

const logger = globalLogger.withDefaults({ message: "[Chat Stream]: " });

let streamContext: ResumableStreamContext | null | undefined;
let keyClient: Redis | null | undefined;

/** Lazily-built resumable-stream context, or null when Redis is unconfigured. */
export function getStreamContext(): ResumableStreamContext | null {
  if (streamContext !== undefined) return streamContext;
  if (!REDIS_URL) {
    // Once per instance. Without this line a production deployment that lost
    // (or never had) its Redis URL is indistinguishable in the logs from one
    // where resume works, and the only symptom is "This response was
    // stopped" after a tab close.
    logger.warn(
      "resumable streams disabled: neither REDIS_URL nor KV_URL is set; runs are viewer-bound (tab close / reload cancels them)",
    );
    streamContext = null;
    return streamContext;
  }
  try {
    // resumable-stream/ioredis builds its own pub/sub clients from REDIS_URL.
    // `after` keeps the serverless function alive until the buffer is flushed.
    streamContext = createResumableStreamContext({ waitUntil: after });
    logger.info(
      "resumable streams enabled (Redis-backed resume + detached stop)",
    );
  } catch (error) {
    logger.error(
      "Failed to create resumable stream context; resume disabled",
      error,
    );
    streamContext = null;
  }
  return streamContext;
}

/** Plain ioredis client for the thread pointer + stop flag, or null. */
function getKeyClient(): Redis | null {
  if (keyClient !== undefined) return keyClient;
  if (!REDIS_URL) {
    keyClient = null;
    return keyClient;
  }
  const client = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  client.on("error", (error) => logger.warn("stream key redis error", error));
  keyClient = client;
  return keyClient;
}

const streamKey = (threadId: string) => `chat:stream:${threadId}`;
const stopKey = (threadId: string) => `chat:stop:${threadId}`;

export async function setActiveStream(threadId: string, streamId: string) {
  await getKeyClient()?.set(
    streamKey(threadId),
    streamId,
    "EX",
    KEY_TTL_SECONDS,
  );
}

export async function getActiveStream(
  threadId: string,
): Promise<string | null> {
  return (await getKeyClient()?.get(streamKey(threadId))) ?? null;
}

/**
 * Which of the given threads have a live stream right now (one MGET). Without
 * Redis this returns an empty set — callers treat that as "nothing running".
 */
export async function getActiveStreamThreadIds(
  threadIds: string[],
): Promise<Set<string>> {
  const client = getKeyClient();
  if (!client || threadIds.length === 0) return new Set();
  try {
    const values = await client.mget(threadIds.map(streamKey));
    return new Set(threadIds.filter((_, index) => values[index] != null));
  } catch (error) {
    logger.warn("active-stream lookup failed", error);
    return new Set();
  }
}

export async function clearActiveStream(threadId: string) {
  await getKeyClient()?.del(streamKey(threadId));
}

export async function requestStop(threadId: string) {
  await getKeyClient()?.set(stopKey(threadId), "1", "EX", KEY_TTL_SECONDS);
}

export async function isStopRequested(threadId: string): Promise<boolean> {
  return (await getKeyClient()?.get(stopKey(threadId))) === "1";
}

export async function clearStop(threadId: string) {
  await getKeyClient()?.del(stopKey(threadId));
}
