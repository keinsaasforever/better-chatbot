import type { Buffer } from "node:buffer";
import { decodeUtf8 } from "./text";

export type CsvPreview = {
  header: string[];
  rows: string[][]; // limited by maxRows/maxCols
  columns: number;
  totalRows: number;
  markdownTable: string; // simple markdown table for the chat
  /** The file has more rows, columns or cell text than the preview shows. */
  truncated: boolean;
  /** At least one byte sequence was not valid UTF-8 and became U+FFFD. */
  replacedInvalidBytes: boolean;
};

/**
 * Longest cell kept in the preview.
 *
 * A single field can legitimately hold a whole document — a quoted description
 * column, a base64 blob — and one of those would otherwise be the entire
 * preview, pushing the actual data out of the model's budget. Generous enough
 * that a real cell survives intact.
 */
export const MAX_CSV_CELL_CHARS = 1000;

/**
 * The first rows of a CSV, as a markdown table.
 *
 * Only comma-separated input is understood. A `;`-delimited export (common from
 * German-locale Excel) previews as a single column — readable, but not a table;
 * delimiter sniffing is a tracked follow-up. `lib/organization/invite-csv.ts`
 * has a `sniffDelimiter` if that day comes.
 *
 * The scan runs to the end of the file but stops *storing* rows once the caps
 * are met, so `totalRows` is exact for a file far larger than the preview. That
 * matters for the quoting state machine too: abandoning the scan early inside a
 * quoted field would count every comma and newline in the rest of the file as a
 * separator.
 */
export function parseCsvPreview(
  content: Buffer,
  opts: { maxRows?: number; maxCols?: number; maxCellChars?: number } = {},
): CsvPreview {
  const maxRows = Math.max(1, opts.maxRows ?? 50);
  const maxCols = Math.max(1, opts.maxCols ?? 12);
  const maxCellChars = Math.max(1, opts.maxCellChars ?? MAX_CSV_CELL_CHARS);
  const { text, replacedInvalidBytes } = decodeUtf8(content);

  // One header row plus `maxRows` of data.
  const keepRows = maxRows + 1;
  const rows: string[][] = [];
  let totalRows = 0;
  let clipped = false;

  let i = 0;
  let field = "";
  let fieldClipped = false;
  let inQuotes = false;
  let row: string[] = [];
  /** Columns seen in this row, including the ones past `maxCols`. */
  let rowColumns = 0;
  /**
   * Whether any field in this row held a character. Tracked separately from
   * the stored row because the stored row is capped and, past the caps, not
   * stored at all — and the final row of a file with no trailing newline is
   * counted only if it had content.
   */
  let rowHasContent = false;
  /** Off once the caps are met: the scan continues, the rows are dropped. */
  let keeping = true;

  const addChar = (ch: string) => {
    rowHasContent = true;
    if (!keeping) return;
    if (field.length < maxCellChars) {
      field += ch;
      return;
    }
    fieldClipped = true;
  };

  const pushField = () => {
    rowColumns += 1;
    if (keeping && rowColumns <= maxCols) {
      row.push(fieldClipped ? `${field}…` : field);
    }
    if (fieldClipped) clipped = true;
    field = "";
    fieldClipped = false;
  };

  const pushRow = () => {
    totalRows += 1;
    if (rowColumns > maxCols) clipped = true;
    if (keeping) {
      rows.push(row);
      // Stop accumulating, keep scanning: `totalRows` and the quoting state
      // both have to survive to the end of the file.
      if (rows.length >= keepRows) keeping = false;
    }
    row = [];
    rowColumns = 0;
    rowHasContent = false;
  };

  while (i < text.length) {
    const ch = text[i++];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i] === '"') {
          addChar('"');
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        addChar(ch);
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        pushField();
      } else if (ch === "\n") {
        pushField();
        pushRow();
      } else if (ch === "\r") {
        // ignore CR (handle CRLF)
      } else {
        addChar(ch);
      }
    }
  }
  // Flush the last field, and the last row when the file did not end on a
  // newline. A file that did ends with one empty trailing field, which is not
  // a row.
  pushField();
  if (rowHasContent) pushRow();

  const header = rows[0] ?? [];
  const limitedRows = rows.slice(1);
  const columns = header.length;

  const mdHeader = `| ${header.join(" | ")} |`;
  const mdSep = `| ${header.map(() => "---").join(" | ")} |`;
  const mdBody = limitedRows
    .map(
      (r) => `| ${r.map((c) => (c ?? "").replace(/\|/g, "\\|")).join(" | ")} |`,
    )
    .join("\n");
  const markdownTable = [mdHeader, mdSep, mdBody].join("\n");

  return {
    header,
    rows: limitedRows,
    columns,
    totalRows,
    markdownTable,
    truncated: clipped || totalRows > keepRows,
    replacedInvalidBytes,
  };
}

export const formatCsvPreviewText = (
  name: string,
  preview: CsvPreview,
): string => {
  const notes = [
    preview.truncated ? "some rows, columns or cells were cut" : null,
    preview.replacedInvalidBytes
      ? "some bytes were not valid UTF-8 and were replaced"
      : null,
  ].filter(Boolean);
  const suffix = notes.length ? ` — ${notes.join("; ")}` : "";

  return `Here is a preview of ${name} (rows: ${preview.totalRows}, cols: ${preview.columns})${suffix}. Summarize or analyze as needed.\n\n${preview.markdownTable}`;
};
