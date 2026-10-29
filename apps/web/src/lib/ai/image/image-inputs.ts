import type { ModelMessage } from "ai";

/**
 * Input image for the dedicated image APIs (`generateImage`).
 *
 * This is the subset of the SDK's `DataContent` we produce: an `http(s)` or
 * `data:` URL string, or raw bytes. The SDK reads a string that starts with
 * `http` as a URL the provider fetches itself and a `data:` string as an
 * inline file; any other string it would decode as base64, so
 * `toImageInput` never lets one through. Uploads and generated images are
 * public storage URLs, which is the cheap path: nothing is downloaded here.
 *
 * Kept free of imports beyond types so both the server action in
 * `generate-image.ts` and the tool context builder can use it without
 * pulling the tool registry into a "use server" module.
 */
export type ImageInput = string | Uint8Array;

const isImageUrlString = (value: string): boolean =>
  value.startsWith("http://") ||
  value.startsWith("https://") ||
  value.startsWith("data:");

export function toImageInput(data: unknown): ImageInput | undefined {
  if (data instanceof Uint8Array) return data;
  if (data instanceof URL) {
    const value = data.toString();
    return isImageUrlString(value) ? value : undefined;
  }
  if (typeof data === "string") {
    return isImageUrlString(data) ? data : undefined;
  }
  return undefined;
}

/**
 * Whether a client-supplied image URL may be fetched server-side. With the
 * storage origin configured, only that exact origin passes (the URLs are
 * ours: an upload or a mask PNG; a local http storage counts because the
 * origin carries the scheme). Without it, any https URL does. Never anything
 * that is not a URL.
 */
export function isAllowedImageSourceUrl(
  url: string,
  storageBaseUrl?: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!storageBaseUrl) return parsed.protocol === "https:";
  try {
    return parsed.origin === new URL(storageBaseUrl).origin;
  } catch {
    return false;
  }
}

/** Longest prompt sent to a single-shot image API; the rest is dilution. */
const MAX_PROMPT_CHARS = 600;

/**
 * Strip everything the app added to the user's message before it is used as an
 * image prompt.
 *
 * A user turn is not just what was typed: the composer prepends an "Attached
 * files" list, and ingestion inserts a preamble plus an `<attachment>` block
 * per readable file. Handed to a text model that is all useful context, but an
 * image model reads a prompt as a description of the picture — an inpainting
 * model literally painted the file names and storage URLs into the masked
 * region as text.
 */
export function sanitizeImagePrompt(text: string): string {
  return (
    text
      // Before the blocks themselves: the preamble names the tag, so a block
      // regex run first would swallow from the preamble to the first close.
      .replace(/The <attachment> blocks below[^\n]*/gi, " ")
      .replace(/<attachment\b[\s\S]*?<\/attachment>/gi, " ")
      // The composer's list: the header plus the numbered lines under it.
      .replace(/Attached files:\n(?:\s*\d+\..*\n?)*/gi, " ")
      .replace(/\bhttps?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_PROMPT_CHARS)
      .trim()
  );
}

/**
 * The instruction for a single-shot image API: the user's latest words, with
 * the app's own additions removed.
 */
export function extractLatestUserText(context: ModelMessage[]): string {
  for (const message of [...context].reverse()) {
    if (message.role !== "user") continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n");
    const cleaned = sanitizeImagePrompt(text);
    if (cleaned) return cleaned;
  }
  return "";
}
