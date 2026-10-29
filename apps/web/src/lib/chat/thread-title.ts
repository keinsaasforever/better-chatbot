import type { UIMessage } from "ai";
import { truncateString } from "lib/utils";

/**
 * Hard cap for a stored thread title. Mirrors the limit stated in
 * CREATE_THREAD_TITLE_PROMPT; the model is asked to respect it but nothing
 * guarantees it does, so every write goes through normalizeThreadTitle.
 */
export const MAX_THREAD_TITLE_LENGTH = 80;

const SURROUNDING_QUOTES = /^["'`“”‘’«»]+|["'`“”‘’«»]+$/g;

/**
 * Makes a model completion safe to store as a title: single line, unquoted and
 * bounded. Returns "" for anything unusable so callers can fall back instead of
 * persisting whitespace that renders as "New Chat" anyway.
 */
export function normalizeThreadTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const unquoted = collapsed.replace(SURROUNDING_QUOTES, "").trim();
  if (!unquoted) return "";
  return unquoted.length > MAX_THREAD_TITLE_LENGTH
    ? unquoted.slice(0, MAX_THREAD_TITLE_LENGTH).trimEnd()
    : unquoted;
}

/**
 * Last-resort title taken straight from the user's own text. Used when the
 * model call fails or returns nothing — a truncated first message beats leaving
 * the thread permanently untitled.
 */
export function deriveThreadTitleFromText(text: unknown): string {
  if (typeof text !== "string") return "";
  // Seeds are built as "user: ...\n\nassistant: ..." (see the extractors
  // below); only the user's own words make a sensible fallback title.
  const firstLine =
    text
      .split("\n")
      .map((line) => line.replace(/^(user|assistant):\s*/i, "").trim())
      .find(Boolean) ?? "";
  return normalizeThreadTitle(firstLine);
}

type TextPart = { type: "text"; text: string };

function isTextPart(part: unknown): part is TextPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as { type: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

/** Per-message cap on the seed so a long paste does not blow up the prompt. */
const TITLE_SEED_PART_LIMIT = 500;

/**
 * Builds the titling prompt seed from persisted messages, in the same
 * "role: text" shape the client sends, so both trigger paths produce
 * comparable titles.
 */
export function buildThreadTitleSeed(
  messages: Array<{ role: string; parts?: unknown }>,
): string {
  return messages
    .flatMap((message) => {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      return parts
        .filter(isTextPart)
        .map((part) => part.text.trim())
        .filter(Boolean)
        .map(
          (text) =>
            `${message.role}: ${truncateString(text, TITLE_SEED_PART_LIMIT)}`,
        );
    })
    .join("\n\n");
}

export function extractTitleSeedFromSendMessage(
  message: Parameters<
    import("@ai-sdk/react").UseChatHelpers<UIMessage>["sendMessage"]
  >[0],
): string | null {
  if (!message || typeof message !== "object") return null;

  const parts = "parts" in message ? message.parts : undefined;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .filter(isTextPart)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n");

  if (!text) return null;
  return `user: ${truncateString(text, TITLE_SEED_PART_LIMIT)}`;
}
