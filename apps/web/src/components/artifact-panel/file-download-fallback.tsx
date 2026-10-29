"use client";

import type { ArtifactFile } from "lib/code-runner/artifact-media";
import { formatBytes } from "lib/utils";
import { Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "ui/button";

/**
 * What the panel shows when it cannot render the file itself: its name, its
 * size, why there is no preview, and the download.
 *
 * Shared so every failure path lands somewhere useful — a file type with no
 * viewer, a workbook too large to parse, a parse that failed — instead of an
 * empty frame or a spinner that never resolves.
 */
export function FileDownloadFallback({
  file,
  message,
}: {
  file: ArtifactFile;
  /** Why there is no preview. Defaults to "this type cannot be shown here". */
  message?: string;
}) {
  const t = useTranslations("Chat.Artifact");

  return (
    <div className="h-full flex items-center justify-center p-8 text-center">
      <div className="max-w-xs">
        <FileText className="size-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium break-all">{file.filename}</p>
        {file.sizeBytes ? (
          <p className="text-xs text-muted-foreground mt-1">
            {formatBytes(file.sizeBytes)}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground mt-2">
          {message ?? t("previewUnavailable")}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <a href={file.url} download={file.filename}>
            <Download className="size-3.5" />
            {t("download")}
          </a>
        </Button>
      </div>
    </div>
  );
}
