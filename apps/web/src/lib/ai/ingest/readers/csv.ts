import { formatCsvPreviewText, parseCsvPreview } from "@/lib/file-ingest/csv";
import type { Reader } from "./reader";

/** Rows and columns of a CSV the model is shown. Unchanged from before. */
const MAX_ROWS = 50;
const MAX_COLS = 12;

export const readCsv: Reader = async ({ buffer, label, maxChars }) => {
  const preview = parseCsvPreview(buffer, {
    maxRows: MAX_ROWS,
    maxCols: MAX_COLS,
  });
  const text = formatCsvPreviewText(label, preview);
  return {
    // The row and column caps almost always bind first; the character clamp
    // is the backstop for a file of very wide cells.
    text: text.slice(0, maxChars),
    truncated: preview.truncated || text.length > maxChars,
  };
};
