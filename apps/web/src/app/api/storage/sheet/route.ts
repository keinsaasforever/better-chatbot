import { withAuth } from "auth/route-guard";
import { FileNotFoundError } from "lib/errors";
import type { CsvPreview } from "lib/file-ingest/csv";
import type { WorkbookPreview } from "lib/file-ingest/xlsx";
import { PREVIEW_MAX_COLS, PREVIEW_MAX_ROWS } from "lib/file-ingest/xlsx";
import { MAX_SHEET_PREVIEW_BYTES } from "lib/file-ingest/xlsx-preview-limits";
import { serverFileStorage } from "lib/file-storage";
import logger from "lib/logger";
import { NextResponse } from "next/server";

// exceljs needs node built-ins (`stream`, `zlib`), so this can never run on edge.
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Reads a stored .xlsx or .csv into rows so the artifact panel can show it as
 * a table.
 *
 * GET /api/storage/sheet?key=<userId>/<uuid>-<filename>.(xlsx|csv)
 *
 * Deliberately one storage round trip. `exists()` and `getMetadata()` are both
 * a Supabase `list` over the key's directory — which for attachments is the
 * user's whole folder — so their cost grows with how many files that user has
 * ever uploaded. `download()` throws `FileNotFoundError` for a missing object,
 * which is the 404, and `byteLength` is an exact size once the bytes are here.
 * `getMetadata` could not gate size anyway: it reports 0 when Supabase omits
 * metadata, so a `size > max` check would fail open.
 *
 * Errors carry a `reason` the panel can branch on, so it can say "too large"
 * rather than "something went wrong" and fall back to offering the download.
 */
export const GET = withAuth(async (req: Request, session) => {
  const key = new URL(req.url).searchParams.get("key");
  if (!key || key.includes("..")) {
    return NextResponse.json(
      { error: "A valid storage key is required", reason: "invalid_key" },
      { status: 400 },
    );
  }

  // exceljs reads the OOXML format only; the old binary .xls is not a workbook
  // it can open, so refuse before spending a download on it. A CSV is not a
  // workbook either, but it is a table, and the panel draws it with the same
  // component — so it is adapted below rather than given a route of its own.
  const lowercased = key.toLowerCase();
  const isCsv = lowercased.endsWith(".csv");
  if (!lowercased.endsWith(".xlsx") && !isCsv) {
    return NextResponse.json(
      {
        error: "Only .xlsx and .csv files can be previewed",
        reason: "unsupported",
      },
      { status: 400 },
    );
  }

  // Keys are namespaced by owner; only the owner may read one.
  if (!key.startsWith(`${session.user.id}/`)) {
    return NextResponse.json(
      { error: "Forbidden", reason: "forbidden" },
      { status: 403 },
    );
  }

  try {
    const buffer = await serverFileStorage.download(key);

    if (buffer.byteLength > MAX_SHEET_PREVIEW_BYTES) {
      return NextResponse.json(
        { error: "This workbook is too large to preview", reason: "too_large" },
        { status: 413 },
      );
    }

    // Imported here, not at module scope: exceljs is a heavy dependency and
    // every rejection above returns without needing it, so it stays off this
    // route's cold-start path. The CSV parser is cheap but takes the same
    // treatment for symmetry.
    const preview = isCsv
      ? csvAsWorkbook(
          await import("lib/file-ingest/csv").then((mod) =>
            mod.parseCsvPreview(buffer, {
              maxRows: PREVIEW_MAX_ROWS,
              maxCols: PREVIEW_MAX_COLS,
            }),
          ),
        )
      : await import("lib/file-ingest/xlsx").then((mod) =>
          mod.parseXlsxPreview(buffer),
        );

    return NextResponse.json(preview, {
      // Private-bucket content: never let a shared cache hold it.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json(
        { error: "File not found", reason: "not_found" },
        { status: 404 },
      );
    }
    logger.error(`[storage] sheet preview failed key=${key}`, err);
    return NextResponse.json(
      { error: "The workbook could not be read", reason: "unreadable" },
      { status: 500 },
    );
  }
});

/**
 * A CSV preview in the shape the panel already knows.
 *
 * One synthetic sheet rather than a second response shape and a second viewer:
 * the panel's table is the same table either way, and a CSV that arrives as a
 * `WorkbookPreview` needs no client change at all.
 */
function csvAsWorkbook(preview: CsvPreview): WorkbookPreview {
  return {
    sheets: [
      {
        name: "",
        header: preview.header,
        rows: preview.rows,
        totalRows: preview.totalRows,
        // A CSV has no column extent beyond its widest row, and the header is
        // as much of that as the preview kept.
        totalColumns: preview.columns,
        truncated: preview.truncated,
      },
    ],
    totalSheets: 1,
  };
}
