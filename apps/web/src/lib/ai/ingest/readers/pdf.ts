import type { IngestionPart } from "../parts";
import { maxRasterPages, rasterizePdfPages } from "../pdf-rasterize";
import type { Reader } from "./reader";

/**
 * A PDF, in up to two representations.
 *
 * - Extracted text, always. It is cheap and it is exact: the model reads the
 *   real characters instead of guessing them off a picture, which matters for
 *   names, figures and anything it has to quote back.
 * - Rendered page images, when the model can see. Text extraction throws the
 *   document away and keeps only the words, so a model asked about a layout has
 *   nothing to work from. It is also the only representation that carries
 *   anything at all for a scanned PDF.
 *
 * Sending the raw PDF was the obvious third option and is not used:
 * `lib/ai/file-support.ts` registers `application/pdf` for no model, so a file
 * part would be dropped or rejected depending on the provider. A rendered page
 * is an ordinary image, which every vision model accepts.
 */
export const readPdf: Reader = async ({
  buffer,
  label,
  maxChars,
  supportsVision,
}) => {
  // unpdf is heavy and only this path needs it.
  const { formatPdfPreviewText, parsePdfPreview } = await import(
    "@/lib/file-ingest/pdf"
  );
  const preview = await parsePdfPreview(buffer, { maxChars });
  const text = formatPdfPreviewText(label, preview);

  if (!supportsVision || maxRasterPages() <= 0) {
    return { text, truncated: preview.truncated };
  }

  const pages = await rasterizePdfPages(buffer);
  if (!pages.length) return { text, truncated: preview.truncated };

  const extraParts: IngestionPart[] = pages.map((page) => ({
    type: "file",
    url: `data:${page.mediaType};base64,${page.base64}`,
    mediaType: page.mediaType,
    filename: `${label} (page ${page.pageNumber})`,
    ingestionPreview: true as const,
  }));

  const plural = pages.length > 1;
  extraParts.push({
    type: "text",
    text: `The ${pages.length} image${plural ? "s" : ""} above ${
      plural ? "are" : "is"
    } rendered page${plural ? "s" : ""} 1-${pages.length} of "${label}"${
      preview.pages > pages.length ? `, out of ${preview.pages} pages` : ""
    }. Use them for anything about layout, styling or appearance; use the extracted text for exact wording.`,
    ingestionPreview: true as const,
  });

  return {
    text,
    truncated: preview.truncated || preview.pages > pages.length,
    extraParts,
  };
};
