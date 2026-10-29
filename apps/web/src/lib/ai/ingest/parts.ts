/**
 * What ingestion adds to the user's message before the model sees it.
 *
 * Both shapes carry `ingestionPreview: true`, which is the marker the rest of
 * the app keys off: `message.tsx` hides these parts from the transcript (the
 * user attached a file, they did not type its contents), and `slim-history`
 * drops the duplicate raw file part on older turns so the same bytes are not
 * billed twice.
 */

export type IngestionTextPart = {
  type: "text";
  text: string;
  ingestionPreview: true;
};

/**
 * A rendered page, shaped as a UI file part.
 *
 * `url` rather than `data`: this is a UIMessage part, and
 * `convertToModelMessages` is what turns the data: URL into the model's file
 * part. Carrying the bytes inline avoids a storage round trip and keeps the
 * page out of the attachments bucket.
 */
export type IngestionFilePart = {
  type: "file";
  url: string;
  mediaType: string;
  filename: string;
  ingestionPreview: true;
};

export type IngestionPart = IngestionTextPart | IngestionFilePart;

export const textPart = (text: string): IngestionTextPart => ({
  type: "text",
  text,
  ingestionPreview: true as const,
});
