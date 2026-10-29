import type { Reader } from "./reader";

/** A .docx as text. mammoth is deferred: only this path needs it. */
export const readDocument: Reader = async ({ buffer, label, maxChars }) => {
  const { formatDocxPreviewText, parseDocxPreview } = await import(
    "@/lib/file-ingest/docx"
  );
  const preview = await parseDocxPreview(buffer, { maxChars });
  return {
    text: formatDocxPreviewText(label, preview),
    truncated: preview.truncated,
  };
};
