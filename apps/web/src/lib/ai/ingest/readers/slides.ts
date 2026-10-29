import type { Reader } from "./reader";

/** Slides read for the model. Fewer than the panel shows: these are tokens. */
const MAX_SLIDES = 60;

/**
 * A .pptx as slide-by-slide text.
 *
 * Always `partial`: charts, SmartArt, embedded workbooks and speaker notes are
 * not read, and the model is told so rather than left to conclude the deck has
 * nothing to say about them.
 */
export const readSlides: Reader = async ({ buffer, label, maxChars }) => {
  const { formatPptxPreviewText, parsePptxPreview } = await import(
    "@/lib/file-ingest/pptx"
  );
  const preview = await parsePptxPreview(buffer, {
    maxSlides: MAX_SLIDES,
    maxChars,
  });
  return {
    text: formatPptxPreviewText(label, preview),
    truncated: preview.truncated || preview.skipped > 0,
    partial: true,
  };
};
