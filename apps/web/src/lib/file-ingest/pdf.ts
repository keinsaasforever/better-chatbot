import { Buffer } from "node:buffer";
import { extractText, getDocumentProxy } from "unpdf";

export type PdfPreview = {
  text: string; // Extracted text (truncated if needed)
  pages: number; // Total page count
  totalChars: number; // Original text length before truncation
  truncated: boolean; // Was text truncated?
};

/**
 * Parse PDF buffer and extract text content with optional truncation.
 * Mirrors the CSV preview pattern for consistent file ingestion.
 *
 * @param content - PDF file as Buffer
 * @param opts - Options for parsing (maxChars to limit token usage)
 * @returns PdfPreview with extracted text and metadata
 */
export async function parsePdfPreview(
  content: Buffer,
  opts: { maxChars?: number } = {},
): Promise<PdfPreview> {
  const maxChars = Math.max(1, opts.maxChars ?? 50000); // ~12K tokens default

  try {
    // Convert Buffer to Uint8Array for unpdf
    const uint8Array = new Uint8Array(content);

    // Get PDF document proxy
    const pdf = await getDocumentProxy(uint8Array);

    // Extract text from all pages
    const { text: fullText, totalPages } = await extractText(pdf, {
      mergePages: true,
    });

    const totalChars = fullText.length;
    const truncated = totalChars > maxChars;

    const text = truncated
      ? fullText.slice(0, maxChars) + "\n\n[...content truncated due to length]"
      : fullText;

    return {
      text,
      pages: totalPages || 0,
      totalChars,
      truncated,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Format PDF preview text for LLM consumption.
 * Creates a structured prompt similar to CSV preview formatting.
 *
 * @param name - Filename or identifier
 * @param preview - Parsed PDF preview data
 * @returns Formatted text string for LLM
 */
export function formatPdfPreviewText(
  name: string,
  preview: PdfPreview,
): string {
  const truncNote = preview.truncated
    ? ` (showing first ${preview.text.length.toLocaleString()} of ${preview.totalChars.toLocaleString()} characters)`
    : "";

  return `Here is the content of ${name} (${preview.pages} page${preview.pages !== 1 ? "s" : ""}${truncNote}). Analyze or summarize as needed.\n\n${preview.text}`;
}
