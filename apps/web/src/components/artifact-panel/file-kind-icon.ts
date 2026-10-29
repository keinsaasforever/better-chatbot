import {
  type ArtifactFile,
  previewKindForFile,
} from "lib/code-runner/artifact-media";
import {
  FileIcon,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  type LucideIcon,
  Presentation,
} from "lucide-react";

/**
 * The icon for a file, from the same kind the panel renders it by.
 *
 * The panel header, the generated-file chip and the upload chip each used to
 * carry their own `mimeType === XLSX_MIME ? … : …` ladder, so a format added to
 * the registry showed up as a spreadsheet in one place and a document in
 * another. One mapping now, keyed off `previewKindForFile`.
 */
export function iconForFile(
  file: Pick<ArtifactFile, "mimeType"> | undefined,
): LucideIcon {
  switch (file && previewKindForFile(file)) {
    case "image":
      return ImageIcon;
    case "sheet":
    case "csv":
      return FileSpreadsheet;
    case "slides":
      return Presentation;
    case "pdf":
    case "document":
    case "text":
      return FileText;
    default:
      // A format with no viewer still gets a name and a download.
      return FileIcon;
  }
}
