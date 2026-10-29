import { Buffer } from "node:buffer";
import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import {
  PREVIEW_MAX_COLS,
  PREVIEW_MAX_ROWS,
  type SheetPreview,
  WorkbookParseError,
  cellToString,
  formatXlsxPreviewText,
  parseXlsxPreview,
} from "./xlsx";

/**
 * These tests write a real workbook with exceljs and read it back through the
 * parser. Round-tripping through the library the app actually ships is the
 * point: it proves the read API against the installed version rather than
 * against a hand-made fixture that could encode a wrong assumption.
 */
async function workbookBuffer(
  build: (workbook: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseXlsxPreview", () => {
  test("reads a header and its data rows", async () => {
    const buffer = await workbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet("Positionen");
      sheet.addRow(["Artikel", "Menge", "Preis"]);
      sheet.addRow(["Beratung", 3, 1200]);
      sheet.addRow(["Setup", 1, 450]);
    });

    const { sheets, totalSheets } = await parseXlsxPreview(buffer);

    expect(totalSheets).toBe(1);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({
      name: "Positionen",
      header: ["Artikel", "Menge", "Preis"],
      rows: [
        ["Beratung", "3", "1200"],
        ["Setup", "1", "450"],
      ],
      totalRows: 3,
      totalColumns: 3,
      truncated: false,
    });
  });

  test("keeps every sheet, in order", async () => {
    const buffer = await workbookBuffer((workbook) => {
      workbook.addWorksheet("Summary").addRow(["Total", 1650]);
      workbook.addWorksheet("Detail").addRow(["Line"]);
    });

    const { sheets } = await parseXlsxPreview(buffer);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Summary", "Detail"]);
  });

  test("shows the value Excel cached for a formula", async () => {
    const buffer = await workbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet("Calc");
      sheet.addRow(["a", "b", "sum"]);
      const row = sheet.addRow([2, 3]);
      row.getCell(3).value = { formula: "A2+B2", result: 5 };
    });

    const { sheets } = await parseXlsxPreview(buffer);

    expect(sheets[0].rows[0]).toEqual(["2", "3", "5"]);
  });

  test("renders dates, rich text, hyperlinks and booleans", async () => {
    const buffer = await workbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet("Mixed");
      sheet.addRow(["date", "rich", "link", "flag"]);
      const row = sheet.addRow(["", "", "", ""]);
      row.getCell(1).value = new Date("2026-09-08T00:00:00.000Z");
      row.getCell(2).value = {
        richText: [{ text: "Total " }, { text: "due" }],
      };
      row.getCell(3).value = {
        text: "Invoice",
        hyperlink: "https://example.com/i",
      };
      row.getCell(4).value = true;
    });

    const { sheets } = await parseXlsxPreview(buffer);
    const [date, rich, link, flag] = sheets[0].rows[0];

    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(rich).toBe("Total due");
    expect(link).toBe("Invoice");
    expect(flag).toBe("TRUE");
  });

  test("caps rows and columns while reporting the real size", async () => {
    const buffer = await workbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet("Big");
      sheet.addRow(["c1", "c2", "c3", "c4", "c5"]);
      for (let i = 0; i < 8; i += 1) {
        sheet.addRow([i, i, i, i, i]);
      }
    });

    const { sheets } = await parseXlsxPreview(buffer, {
      maxRows: 2,
      maxCols: 3,
    });

    expect(sheets[0].header).toEqual(["c1", "c2", "c3"]);
    expect(sheets[0].rows).toHaveLength(2);
    expect(sheets[0].rows[0]).toHaveLength(3);
    // The UI needs the true size to say what it left out.
    expect(sheets[0].totalRows).toBe(9);
    expect(sheets[0].totalColumns).toBe(5);
    expect(sheets[0].truncated).toBe(true);
  });

  test("caps the sheet count and still reports the total", async () => {
    const buffer = await workbookBuffer((workbook) => {
      for (let i = 0; i < 4; i += 1) {
        workbook.addWorksheet(`S${i}`).addRow(["x"]);
      }
    });

    const preview = await parseXlsxPreview(buffer, { maxSheets: 2 });

    expect(preview.sheets).toHaveLength(2);
    expect(preview.totalSheets).toBe(4);
  });

  test("handles an empty sheet without inventing a header", async () => {
    const buffer = await workbookBuffer((workbook) => {
      workbook.addWorksheet("Empty");
    });

    const { sheets } = await parseXlsxPreview(buffer);

    expect(sheets[0]).toMatchObject({
      header: [],
      rows: [],
      totalRows: 0,
      truncated: false,
    });
  });

  test("treats a single row as the header, with no data rows", async () => {
    const buffer = await workbookBuffer((workbook) => {
      workbook.addWorksheet("One").addRow(["only", "row"]);
    });

    const { sheets } = await parseXlsxPreview(buffer);

    expect(sheets[0].header).toEqual(["only", "row"]);
    expect(sheets[0].rows).toEqual([]);
  });

  test("rejects a buffer that is not a workbook", async () => {
    await expect(
      parseXlsxPreview(Buffer.from("this is not a spreadsheet")),
    ).rejects.toBeInstanceOf(WorkbookParseError);
  });

  test("defaults are the shared caps", async () => {
    const buffer = await workbookBuffer((workbook) => {
      const sheet = workbook.addWorksheet("Default");
      sheet.addRow(["h"]);
      for (let i = 0; i < PREVIEW_MAX_ROWS + 5; i += 1) sheet.addRow([i]);
    });

    const { sheets } = await parseXlsxPreview(buffer);

    expect(sheets[0].rows).toHaveLength(PREVIEW_MAX_ROWS);
    expect(PREVIEW_MAX_COLS).toBeGreaterThan(0);
  });
});

describe("cellToString", () => {
  test("renders each shape exceljs produces", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString(undefined)).toBe("");
    expect(cellToString("text")).toBe("text");
    expect(cellToString(42)).toBe("42");
    expect(cellToString(false)).toBe("FALSE");
    expect(cellToString({ formula: "A1", result: 7 })).toBe("7");
    expect(cellToString({ error: "#DIV/0!" })).toBe("#DIV/0!");
    expect(cellToString({ richText: [{ text: "a" }, { text: "b" }] })).toBe(
      "ab",
    );
    expect(cellToString({ hyperlink: "https://x.test", text: "X" })).toBe("X");
    expect(cellToString({ hyperlink: "https://x.test" })).toBe(
      "https://x.test",
    );
  });

  test("formats dates, date-only when the time is midnight", () => {
    expect(cellToString(new Date("2026-09-08T00:00:00.000Z"))).toBe(
      "2026-09-08",
    );
    expect(cellToString(new Date("2026-09-08T14:30:05.000Z"))).toBe(
      "2026-09-08T14:30:05",
    );
    expect(cellToString(new Date("nonsense"))).toBe("");
  });

  test("previews a formula with no cached result as empty", () => {
    // A workbook written by a library that does not calculate has no result.
    expect(cellToString({ formula: "SUM(A:A)" })).toBe("");
  });

  test("keeps a formula whose cached result is an error", () => {
    expect(cellToString({ formula: "1/0", result: { error: "#DIV/0!" } })).toBe(
      "#DIV/0!",
    );
  });
});

describe("formatXlsxPreviewText", () => {
  const sheet = (over: Partial<SheetPreview> = {}): SheetPreview => ({
    name: "Q1",
    header: ["Artikel", "Menge"],
    rows: [["Beratung", "3"]],
    totalRows: 2,
    totalColumns: 2,
    truncated: false,
    ...over,
  });

  test("writes one markdown table per sheet", () => {
    const { text, truncated } = formatXlsxPreviewText(
      "book.xlsx",
      { sheets: [sheet(), sheet({ name: "Q2" })], totalSheets: 2 },
      { maxChars: 10_000 },
    );

    expect(text).toContain("book.xlsx");
    expect(text).toContain("### Q1");
    expect(text).toContain("### Q2");
    expect(text).toContain("| Artikel | Menge |");
    expect(truncated).toBe(false);
  });

  test("escapes a pipe so one cell cannot rewrite the table", () => {
    const { text } = formatXlsxPreviewText(
      "book.xlsx",
      { sheets: [sheet({ header: ["a|b", "c"] })], totalSheets: 1 },
      { maxChars: 10_000 },
    );

    expect(text).toContain("| a\\|b | c |");
  });

  test("drops a sheet that does not fit rather than cutting it mid-row", () => {
    const big = sheet({
      name: "Big",
      rows: Array.from({ length: 100 }, () => ["x".repeat(50), "y"]),
    });

    const { text, truncated } = formatXlsxPreviewText(
      "book.xlsx",
      { sheets: [sheet(), big], totalSheets: 2 },
      { maxChars: 400 },
    );

    expect(text).toContain("### Q1");
    expect(text).not.toContain("### Big");
    expect(truncated).toBe(true);
    // A half-read record would be worse than a named omission: the model
    // cannot tell a cut row from a short one.
    expect(text).toMatch(/python-execution/);
  });

  test("says a sheet the parser already capped is partial", () => {
    const { truncated } = formatXlsxPreviewText(
      "book.xlsx",
      { sheets: [sheet({ truncated: true })], totalSheets: 1 },
      { maxChars: 10_000 },
    );

    expect(truncated).toBe(true);
  });

  test("names an empty sheet instead of writing an empty table", () => {
    const { text } = formatXlsxPreviewText(
      "book.xlsx",
      {
        sheets: [sheet({ header: [], rows: [], totalRows: 0 })],
        totalSheets: 1,
      },
      { maxChars: 10_000 },
    );

    expect(text).toContain("(empty)");
  });
});
