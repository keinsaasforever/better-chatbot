/**
 * Bounds on what one chat turn may spend reading its attachments.
 *
 * Ingestion runs *before* the stream opens, because the model needs the text
 * in its first prompt — so every millisecond and megabyte here is paid by
 * time-to-first-token, and by every other request sharing the instance. Vercel
 * Fluid Compute puts concurrent invocations on one instance, which is why
 * `4fc4ea0` put a firm byte cap in front of exceljs rather than trusting the
 * average case.
 *
 * Dependency-free: imported by the chat route, the ingesters and the client.
 */

/**
 * Attachments read per message.
 *
 * `ChatAttachmentSchema` had no bound at all, so a client could send an
 * arbitrarily long array and each entry cost a download and a parse.
 */
export const MAX_INGESTED_ATTACHMENTS = 10;

/**
 * Longest attachment URL accepted.
 *
 * Generous next to a real storage URL (~200 chars) and still small enough that
 * a hostile array cannot become a payload in itself.
 */
export const MAX_ATTACHMENT_URL_CHARS = 2048;

/**
 * Bytes downloaded before a parser is allowed to run, per format kind.
 *
 * Checked on the buffer, after the download: `getMetadata` reports `size: 0`
 * when Supabase has no metadata row, so a pre-check would fail *open* on
 * exactly the objects it is meant to stop. Downloading a large file to refuse
 * it is bounded by the 50 MB client upload cap and is the rare path.
 *
 * xlsx keeps the value `4fc4ea0` justified (exceljs materialises the workbook,
 * 50-100 MB heap per parse). pptx is higher because only slide XML is
 * inflated, never media. pdf is highest because unpdf streams text out rather
 * than building an object per page.
 */
export const MAX_INGEST_BYTES: Record<string, number> = {
  csv: 5 * 1024 * 1024,
  text: 5 * 1024 * 1024,
  sheet: 5 * 1024 * 1024,
  document: 10 * 1024 * 1024,
  slides: 15 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
};

/** Characters of extracted text kept from a single file (~12k tokens). */
export const MAX_INGEST_CHARS_PER_FILE = 50_000;

/**
 * Characters of extracted text kept across all attachments in one message.
 *
 * ~37k tokens, which leaves a 128k-context model room for the conversation it
 * is supposed to be having. Files are read in attachment order and each gets
 * whatever budget the ones before it left.
 */
export const MAX_INGEST_CHARS_PER_MESSAGE = 150_000;

/**
 * How long one file may keep the turn waiting.
 *
 * Neither mammoth nor exceljs accepts an abort signal, so this stops *waiting*
 * on a parse, not the parse itself: the work finishes on the instance either
 * way. It protects time-to-first-token. The byte caps above are what protect
 * the instance.
 */
export const INGEST_DEADLINE_MS = 20_000;
