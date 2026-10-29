"use client";

import { useSheetPreview } from "@/hooks/queries/use-sheet-preview";
import {
  type ArtifactFile,
  artifactStorageKey,
} from "lib/code-runner/artifact-media";
import { MAX_SHEET_PREVIEW_BYTES } from "lib/file-ingest/xlsx-preview-limits";
import { cn } from "lib/utils";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Skeleton } from "ui/skeleton";
import { FileDownloadFallback } from "./file-download-fallback";

/**
 * A generated .xlsx as a table.
 *
 * The rows come from `/api/storage/sheet`, which parses the stored workbook
 * server-side. Nothing is parsed in the browser: the file itself is never
 * downloaded here, only the first rows of it as JSON.
 *
 * Every failure — too large, unreadable, gone — falls back to the download,
 * which is what the panel offered before this existed.
 */
export function SheetPreview({ file }: { file: ArtifactFile }) {
  const t = useTranslations("Chat.Artifact");
  const [activeSheet, setActiveSheet] = useState(0);

  const storageKey = artifactStorageKey(file.url);
  // The size travelled with the artifact, so an oversized workbook costs no
  // request at all. The route enforces the same cap: this value comes from the
  // client, so it is a shortcut, never the authority.
  const knownTooLarge =
    typeof file.sizeBytes === "number" &&
    file.sizeBytes > MAX_SHEET_PREVIEW_BYTES;

  const { preview, isLoading, isError, reason } = useSheetPreview(
    knownTooLarge ? null : storageKey,
  );

  if (knownTooLarge || reason === "too_large") {
    return <FileDownloadFallback file={file} message={t("sheetTooLarge")} />;
  }
  if (isError || !storageKey) {
    return <FileDownloadFallback file={file} message={t("sheetLoadFailed")} />;
  }
  if (isLoading || !preview) {
    return <SheetSkeleton label={t("sheetLoading")} />;
  }

  const sheet = preview.sheets[activeSheet] ?? preview.sheets[0];
  if (!sheet) {
    return <FileDownloadFallback file={file} message={t("sheetEmpty")} />;
  }

  const columnCount = Math.max(sheet.header.length, 1);

  return (
    <div className="h-full flex flex-col">
      {preview.sheets.length > 1 && (
        <div
          className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 shrink-0"
          role="tablist"
        >
          {preview.sheets.map((entry, index) => (
            <button
              key={`${entry.name}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === activeSheet}
              onClick={() => setActiveSheet(index)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                index === activeSheet
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {entry.name || `#${index + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {sheet.header.length === 0 ? (
          <p className="p-8 text-center text-xs text-muted-foreground">
            {t("sheetEmpty")}
          </p>
        ) : (
          <table className="w-max min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-background">
              <tr>
                {/* Row numbers, so the preview reads like the spreadsheet. */}
                <th className="w-10 border-b border-r bg-muted/40 px-2 py-1.5 text-right font-normal text-muted-foreground" />
                {sheet.header.map((cell, index) => (
                  <th
                    key={index}
                    className="max-w-[20rem] truncate border-b border-r px-2 py-1.5 text-left font-medium"
                    title={cell}
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-accent/30">
                  <td className="border-b border-r bg-muted/40 px-2 py-1 text-right text-muted-foreground tabular-nums">
                    {rowIndex + 2}
                  </td>
                  {Array.from({ length: columnCount }, (_, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="max-w-[20rem] truncate border-b border-r px-2 py-1"
                      title={row[cellIndex] ?? ""}
                    >
                      {row[cellIndex] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sheet.truncated && (
        <p className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">
          {/* The header is a row too, on both sides of the count. */}
          {t("sheetTruncated", {
            rows: sheet.rows.length + (sheet.header.length > 0 ? 1 : 0),
            totalRows: sheet.totalRows,
            columns: Math.min(sheet.header.length, sheet.totalColumns),
            totalColumns: sheet.totalColumns,
          })}
        </p>
      )}
    </div>
  );
}

function SheetSkeleton({ label }: { label: string }) {
  return (
    <div className="h-full p-4 flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 8 }, (_, row) => (
        <Skeleton key={row} className="h-6 w-full" />
      ))}
    </div>
  );
}
