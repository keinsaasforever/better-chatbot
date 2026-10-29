import { type UIMessage, isToolUIPart } from "ai";
import { INGESTED_MEDIA_TYPE } from "@/lib/ai/ingest/formats";

/**
 * Trims bulky content out of *older* turns before a chat request is sent.
 *
 * Chat history is windowed by message count (CHAT_MESSAGE_WINDOW), not by size,
 * so a single web search (~15KB) or PDF ingestion preview (up to 50k chars) was
 * re-sent at full price on every later turn of the thread. This strips that
 * weight from turns the model has already acted on, while leaving the recent
 * turns - the ones a follow-up question is actually about - untouched.
 *
 * Applies to the model payload only. The persisted transcript and the UI are
 * unaffected, so nothing the user can see is lost.
 *
 * Must stay deterministic: the same history has to produce the same bytes on
 * every request, or the prompt cache is invalidated each time.
 */

/** Recent turns left completely untouched. A "turn" starts at a user message. */
export const SLIM_KEEP_RECENT_TURNS = 2;

/** Cap for a single truncated part, in characters (~500 tokens). */
export const SLIM_MAX_PART_CHARS = 2000;

const TRUNCATION_MARKER = "…[truncated —";

const truncate = (value: string): string => {
  // Already trimmed: the marker itself pushes the result back over the cap, so
  // without this guard a second pass would truncate the marker and the bytes
  // would drift on every application.
  if (value.includes(TRUNCATION_MARKER)) return value;
  if (value.length <= SLIM_MAX_PART_CHARS) return value;
  const omitted = value.length - SLIM_MAX_PART_CHARS;
  // Fixed marker: anything length- or time-dependent beyond the omitted count
  // would make the same history serialize differently between requests.
  return `${value.slice(0, SLIM_MAX_PART_CHARS)}\n${TRUNCATION_MARKER} ${omitted} characters omitted from an earlier turn]`;
};

/**
 * Index of the first message belonging to the last `turns` user turns.
 * Falls back to 0 (slim nothing) when the thread is shorter than that.
 */
const firstIndexOfRecentTurns = (
  messages: UIMessage[],
  turns: number,
): number => {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    seen++;
    if (seen === turns) return i;
  }
  return 0;
};

const slimPart = (part: any): any => {
  // Ingestion previews: the full document text was useful on the turn it was
  // attached; later turns only need enough to know what the document was.
  if (
    part?.type === "text" &&
    part.ingestionPreview &&
    typeof part.text === "string"
  ) {
    const text = truncate(part.text);
    return text === part.text ? part : { ...part, text };
  }

  // Tool results: settled outputs only. An in-flight call has no output yet,
  // and rewriting one would desync it from its tool call.
  if (isToolUIPart(part) && part.state === "output-available") {
    const serialized =
      typeof part.output === "string"
        ? part.output
        : safeStringify(part.output);
    if (serialized === undefined || serialized.length <= SLIM_MAX_PART_CHARS) {
      return part;
    }
    return { ...part, output: truncate(serialized) };
  }

  return part;
};

const safeStringify = (value: unknown): string | undefined => {
  try {
    return JSON.stringify(value);
  } catch {
    // Circular or otherwise unserializable output: leave it alone rather than
    // risk changing what the model sees in an unpredictable way.
    return undefined;
  }
};

const slimMessage = (message: UIMessage): UIMessage => {
  const parts = message.parts ?? [];
  if (!parts.length) return message;

  // A PDF/CSV attachment is sent twice: once as extracted preview text and once
  // as the raw file. On older turns the preview alone is enough - keeping both
  // bills the same document to the provider twice.
  const hasIngestionPreview = parts.some(
    (p: any) => p?.type === "text" && p.ingestionPreview,
  );

  const nextParts = parts
    .filter((p: any) => {
      if (!hasIngestionPreview) return true;
      if (p?.type !== "file") return true;
      return !INGESTED_MEDIA_TYPE.test(p.mediaType ?? "");
    })
    .map(slimPart);

  const changed =
    nextParts.length !== parts.length ||
    nextParts.some((p, i) => p !== parts[i]);

  return changed ? ({ ...message, parts: nextParts } as UIMessage) : message;
};

export const slimHistoryForModel = (messages: UIMessage[]): UIMessage[] => {
  if (messages.length <= 1) return messages;

  const keepFrom = firstIndexOfRecentTurns(messages, SLIM_KEEP_RECENT_TURNS);
  if (keepFrom === 0) return messages;

  let changed = false;
  const next = messages.map((message, index) => {
    if (index >= keepFrom) return message;
    const slimmed = slimMessage(message);
    if (slimmed !== message) changed = true;
    return slimmed;
  });

  return changed ? next : messages;
};
