import type { Buffer } from "node:buffer";

/**
 * Reads the first rows of a workbook so the artifact panel can show a
 * generated .xlsx as a table. The shape mirrors `CsvPreview` in ./csv.ts so
 * both preview paths hand the UI the same thing.
 *
 * This is a PREVIEW, never a full read: the caps below bound both the JSON
 * sent to the browser and the DOM the panel builds from it. The whole file is
 * one click away on the panel's Download button.
 */

/**
 * Rows and columns kept per sheet. 100 x 40 is 4,000 cells worst case, which a
 * plain table renders without virtualization — the repo has none, and the
 * largest table it renders today is 20 rows (`interactive-table.tsx`).
 */
export const PREVIEW_MAX_ROWS = 100;
export const PREVIEW_MAX_COLS = 40;
/** Sheets kept. Enough for any real workbook; stops a pathological one. */
export const PREVIEW_MAX_SHEETS = 20;

export type SheetPreview = {
  name: string;
  /** Row one. Always the header when the sheet has any rows, as in csv.ts. */
  header: string[];
  /** Data rows, header excluded, capped at `maxRows`. */
  rows: string[][];
  /** Real counts, before the caps, so the UI can say what it left out. */
  totalRows: number;
  totalColumns: number;
  truncated: boolean;
};

export type WorkbookPreview = {
  sheets: SheetPreview[];
  totalSheets: number;
};

/** Thrown for a buffer that is not a readable workbook. */
export class WorkbookParseError extends Error {
  constructor(cause?: unknown) {
    super("The workbook could not be read");
    this.name = "WorkbookParseError";
    this.cause = cause;
  }
}

export async function parseXlsxPreview(
  content: Buffer,
  opts: { maxRows?: number; maxCols?: number; maxSheets?: number } = {},
): Promise<WorkbookPreview> {
  const maxRows = Math.max(1, opts.maxRows ?? PREVIEW_MAX_ROWS);
  const maxCols = Math.max(1, opts.maxCols ?? PREVIEW_MAX_COLS);
  const maxSheets = Math.max(1, opts.maxSheets ?? PREVIEW_MAX_SHEETS);

  // Imported here rather than at module scope: exceljs is heavy, and the route
  // that calls this rejects most bad requests before ever reaching the parse.
  const { default: ExcelJS } = await import("exceljs");

  const workbook = new ExcelJS.Workbook();
  try {
    // The caller caps the input size; a workbook is fully materialised here.
    //
    // The cast bridges a types-only disagreement: @types/node describes a
    // buffer as `Buffer<ArrayBufferLike>` while exceljs's own declaration
    // wants `Buffer<ArrayBuffer>`. Same object at runtime — only the
    // backing-store generic differs. Deriving the target from `load` itself
    // means this cannot drift if either package restates it.
    await workbook.xlsx.load(
      content as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch (error) {
    throw new WorkbookParseError(error);
  }

  // Every sheet is included, hidden ones too: a preview should show what the
  // file contains rather than quietly dropping part of it.
  const worksheets = workbook.worksheets ?? [];
  const sheets = worksheets
    .slice(0, maxSheets)
    .map((worksheet) => readSheet(worksheet, maxRows, maxCols));

  return { sheets, totalSheets: worksheets.length };
}

/**
 * A workbook as text for the model: one markdown table per sheet.
 *
 * The panel and the prompt read the same `WorkbookPreview`, but they can afford
 * different amounts of it — a table the browser renders instantly is still
 * thousands of tokens — so the caller passes the character budget and the
 * sheets share it in order. A sheet that does not fit is named and skipped
 * rather than cut mid-row, which would leave the model reading half a record as
 * though it were whole.
 */
export function formatXlsxPreviewText(
  name: string,
  preview: WorkbookPreview,
  opts: { maxChars: number },
): { text: string; truncated: boolean } {
  const header = `Here is a preview of the workbook ${name} (${preview.totalSheets} sheet${
    preview.totalSheets === 1 ? "" : "s"
  }). Summarize or analyze as needed.`;

  const blocks: string[] = [];
  let used = header.length;
  let truncated = preview.sheets.length < preview.totalSheets;

  for (const sheet of preview.sheets) {
    const block = formatSheet(sheet);
    if (used + block.length > opts.maxChars) {
      truncated = true;
      continue;
    }
    used += block.length;
    blocks.push(block);
    if (sheet.truncated) truncated = true;
  }

  const notice = truncated
    ? "\n\nSome sheets, rows or columns are not shown. Use python-execution to read the whole workbook if the question needs it."
    : "";

  return { text: `${header}\n\n${blocks.join("\n\n")}${notice}`, truncated };
}

function formatSheet(sheet: SheetPreview): string {
  if (!sheet.header.length) {
    return `### ${sheet.name || "(unnamed sheet)"}\n\n(empty)`;
  }

  const escape = (cell: string) => cell.replace(/\|/g, "\\|");
  const lines = [
    `| ${sheet.header.map(escape).join(" | ")} |`,
    `| ${sheet.header.map(() => "---").join(" | ")} |`,
    ...sheet.rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ];

  const extent = `rows: ${sheet.totalRows}, cols: ${sheet.totalColumns}`;
  return `### ${sheet.name || "(unnamed sheet)"} (${extent})\n\n${lines.join("\n")}`;
}

/**
 * Only what this file reads. Written out rather than imported from exceljs so
 * the module carries no type dependency on a library it loads dynamically;
 * exceljs's own `Worksheet` satisfies it structurally.
 */
type Worksheet = {
  name?: string;
  rowCount?: number;
  columnCount?: number;
  actualRowCount?: number;
  actualColumnCount?: number;
  getRow: (index: number) => { getCell: (index: number) => { value: unknown } };
};

function readSheet(
  worksheet: Worksheet,
  maxRows: number,
  maxCols: number,
): SheetPreview {
  // The sheet's extent, not its populated-cell count. `actual*Count` skips
  // gaps, so a sheet with data in rows 1-3 and row 90 reports 4 — which would
  // disagree with the row numbers the panel prints beside each row. Reading by
  // position keeps the preview and its row numbers describing the same sheet.
  const totalRows = worksheet.rowCount ?? worksheet.actualRowCount ?? 0;
  const totalColumns =
    worksheet.columnCount ?? worksheet.actualColumnCount ?? 0;

  const columns = Math.min(totalColumns, maxCols);
  // One header row plus up to `maxRows` of data.
  const lastRow = Math.min(totalRows, maxRows + 1);

  const readRow = (rowNumber: number): string[] => {
    const row = worksheet.getRow(rowNumber);
    const cells: string[] = [];
    for (let column = 1; column <= columns; column += 1) {
      cells.push(cellToString(row.getCell(column).value));
    }
    return cells;
  };

  const header = totalRows > 0 ? readRow(1) : [];
  const rows: string[][] = [];
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    rows.push(readRow(rowNumber));
  }

  return {
    name: worksheet.name ?? "",
    header,
    rows,
    totalRows,
    totalColumns,
    truncated: totalRows - 1 > maxRows || totalColumns > maxCols,
  };
}

/**
 * One cell as display text.
 *
 * exceljs hands back a union rather than a primitive, and every arm here is a
 * shape it really produces. A formula cell carries the value Excel last
 * calculated; a workbook written by a library that does not compute formulas
 * has no cached result, so those cells preview as empty. That is the file's
 * content, not a bug in this function.
 */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // Excel's own rendering, so a preview reads like the spreadsheet does.
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return formatDate(value);

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;

    // Formula and shared formula: show what Excel calculated.
    if ("result" in candidate) return cellToString(candidate.result);
    if ("error" in candidate) return String(candidate.error);
    if ("richText" in candidate && Array.isArray(candidate.richText)) {
      return candidate.richText
        .map((run) => String((run as { text?: unknown })?.text ?? ""))
        .join("");
    }
    if ("hyperlink" in candidate) {
      const text = candidate.text;
      return text === undefined || text === null
        ? String(candidate.hyperlink)
        : cellToString(text);
    }
    // A formula with no cached result at all.
    if ("formula" in candidate || "sharedFormula" in candidate) return "";
  }

  return String(value);
}

/** Date-only when the time is midnight UTC, otherwise seconds precision. */
function formatDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return "";
  const iso = value.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19);
}
