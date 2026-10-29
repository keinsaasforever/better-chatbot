import type { Buffer } from "node:buffer";

/**
 * A .docx as plain text.
 *
 * mammoth's `extractRawText` is what the deferred Document toolkit already
 * uses (`lib/document/extract-text.ts`), so this is the same library on the
 * same file format rather than a second implementation — the difference is the
 * character cap and that the import is deferred, since the chat route must not
 * carry mammoth on its cold start for turns with no attachment.
 *
 * Structure is lost: headings, lists and tables all come back as lines. That is
 * the trade mammoth makes for reading any Word file without a layout engine,
 * and it is why the preview route renders HTML while the model gets this.
 */

export type DocxPreview = {
  text: string;
  truncated: boolean;
};

export async function parseDocxPreview(
  content: Buffer,
  opts: { maxChars?: number } = {},
): Promise<DocxPreview> {
  const maxChars = Math.max(1, opts.maxChars ?? 50_000);

  const { default: mammoth } = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: content });

  // Word writes a lot of empty paragraphs; three blank lines in a row are
  // tokens spent on nothing.
  const text = value.replace(/\n{3,}/g, "\n\n").trim();
  const truncated = text.length > maxChars;

  return { text: truncated ? text.slice(0, maxChars) : text, truncated };
}

export function formatDocxPreviewText(
  name: string,
  preview: DocxPreview,
): string {
  const header = preview.truncated
    ? `Here is the text of ${name}, truncated to its first ${preview.text.length} characters. Use python-execution to read the rest if the question needs it.`
    : `Here is the text of ${name}.`;
  return `${header}\n\n${preview.text}`;
}
