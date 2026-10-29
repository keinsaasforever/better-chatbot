/**
 * Shared by the sheet route and the panel that calls it.
 *
 * Kept apart from ./xlsx.ts on purpose: that module reaches for exceljs, which
 * needs node built-ins, so a client component importing a value from it would
 * drag the parser into the browser bundle. This file has no dependencies.
 */

/**
 * Largest workbook the preview will parse.
 *
 * `workbook.xlsx.load` materialises the whole sheet in the lambda heap, and
 * Fluid Compute shares an instance across concurrent invocations, so this is
 * the ceiling on what one preview can cost everyone else. A generated 50k-row
 * export is 3-5 MB, so real files sit well inside it; anything larger is a
 * download, not a preview.
 */
export const MAX_SHEET_PREVIEW_BYTES = 5 * 1024 * 1024;
