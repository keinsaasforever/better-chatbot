import {
  INGEST_SUPPORTED_MIME,
  SUMMARIZE_SUPPORTED_MIME,
} from "@/lib/ai/ingest/formats";

export const DEFAULT_FILE_PART_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // PDF removed: Now handled via server-side text extraction (INGEST_SUPPORTED_MIME)
] as const;

export const OPENAI_FILE_MIME_TYPES = [
  ...DEFAULT_FILE_PART_MIME_TYPES,
] as const;

export const GEMINI_FILE_MIME_TYPES = [
  ...DEFAULT_FILE_PART_MIME_TYPES,
] as const;

export const ANTHROPIC_FILE_MIME_TYPES = [
  ...DEFAULT_FILE_PART_MIME_TYPES,
] as const;

export const XAI_FILE_MIME_TYPES = [...DEFAULT_FILE_PART_MIME_TYPES] as const;

const DEFAULT_FILE_PART_MIME_SET = new Set<string>(
  DEFAULT_FILE_PART_MIME_TYPES,
);

/**
 * Mime types whose content the chat route extracts for the model.
 *
 * Derived from the format registry rather than listed again here: this set,
 * the media-type regex in `app/api/chat/chat/slim-history.ts` and each
 * ingester's matcher all used to be maintained by hand, and adding a format to
 * one and forgetting another failed silently.
 */
export { INGEST_SUPPORTED_MIME, SUMMARIZE_SUPPORTED_MIME };

export const isFilePartSupported = (
  mime?: string,
  supportedMimeTypes?: readonly string[],
) => {
  if (!mime) return false;
  if (supportedMimeTypes !== undefined) {
    return supportedMimeTypes.includes(mime);
  }
  return DEFAULT_FILE_PART_MIME_SET.has(mime);
};

export const isIngestSupported = (mime?: string) =>
  !!mime && INGEST_SUPPORTED_MIME.has(mime);

/**
 * Whether the composer's Summarize action can do anything with this file.
 *
 * Narrower than `isIngestSupported` on purpose: the button posts to
 * `/api/storage/ingest`, which handles CSV only and 400s on everything else —
 * including the PDFs the button used to appear for.
 */
export const isSummarizeSupported = (mime?: string) =>
  !!mime && SUMMARIZE_SUPPORTED_MIME.has(mime);
