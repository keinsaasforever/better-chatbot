"use client";

import type { DisplayArtifact } from "lib/code-runner/artifact-media";
import { formatBytes } from "lib/utils";
import {
  DownloadIcon,
  FileArchiveIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";

const ICON_BY_EXTENSION: Record<string, LucideIcon> = {
  xlsx: FileSpreadsheetIcon,
  xls: FileSpreadsheetIcon,
  csv: FileSpreadsheetIcon,
  tsv: FileSpreadsheetIcon,
  pdf: FileTextIcon,
  docx: FileTextIcon,
  doc: FileTextIcon,
  pptx: FileTextIcon,
  txt: FileTextIcon,
  md: FileTextIcon,
  json: FileJsonIcon,
  zip: FileArchiveIcon,
  tar: FileArchiveIcon,
  gz: FileArchiveIcon,
  html: FileCodeIcon,
  xml: FileCodeIcon,
  py: FileCodeIcon,
  js: FileCodeIcon,
};

function iconFor(filename: string, mimeType?: string): LucideIcon {
  if (mimeType?.startsWith("image/")) return FileImageIcon;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return ICON_BY_EXTENSION[extension] ?? FileIcon;
}

/**
 * A generated file, shown where the user will see it: name, type, size and a
 * Download button.
 *
 * The button is a plain same-origin `download` anchor. No `target="_blank"`:
 * a download anchor never navigates or opens a window, so the desktop shell
 * does not end up with a blank BrowserWindow the way it did with the old chip.
 */
export const ArtifactFileCard = memo(function ArtifactFileCard({
  artifact,
}: {
  artifact: DisplayArtifact;
}) {
  const t = useTranslations("Chat.Tool");
  const Icon = iconFor(artifact.filename, artifact.mimeType);
  const extension = artifact.filename.split(".").pop()?.toUpperCase() || "FILE";
  const canDownload = Boolean(artifact.href) && !artifact.unavailable;

  return (
    <div className="flex max-w-md items-center gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex-shrink-0 rounded-xl bg-muted p-3">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className="line-clamp-1 text-sm font-medium text-foreground"
          title={artifact.filename}
        >
          {artifact.filename}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant="outline"
            className="uppercase tracking-wide px-2 py-0.5"
          >
            {extension}
          </Badge>
          {typeof artifact.sizeBytes === "number" && artifact.sizeBytes > 0 && (
            <span>{formatBytes(artifact.sizeBytes, 1)}</span>
          )}
          {artifact.unavailable && <span>{t("fileUnavailable")}</span>}
        </div>
      </div>
      {canDownload && (
        <Button asChild variant="outline" size="sm" className="flex-shrink-0">
          <a
            href={artifact.href}
            download={artifact.filename}
            aria-label={t("downloadFile", { filename: artifact.filename })}
          >
            <DownloadIcon />
            {t("download")}
          </a>
        </Button>
      )}
    </div>
  );
});
