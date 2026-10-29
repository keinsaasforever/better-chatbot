import type { Reader } from "./reader";

/**
 * Rows and columns of each sheet the model is shown.
 *
 * Lower than the panel's 100 x 40: the panel renders a table the user scrolls,
 * while every cell here is tokens spent before the answer starts, on every
 * sheet in the book.
 */
const MAX_ROWS = 40;
const MAX_COLS = 20;
const MAX_SHEETS = 10;

/**
 * An .xlsx as markdown tables.
 *
 * exceljs materialises the whole workbook (50-100 MB of heap for a large one),
 * which is why the byte cap in front of this one is the tightest of the set and
 * why the import is deferred to here rather than sitting at module scope on the
 * chat route's cold-start path.
 */
export const readSheet: Reader = async ({ buffer, label, maxChars }) => {
  const { formatXlsxPreviewText, parseXlsxPreview } = await import(
    "@/lib/file-ingest/xlsx"
  );
  const preview = await parseXlsxPreview(buffer, {
    maxRows: MAX_ROWS,
    maxCols: MAX_COLS,
    maxSheets: MAX_SHEETS,
  });
  return formatXlsxPreviewText(label, preview, { maxChars });
};
