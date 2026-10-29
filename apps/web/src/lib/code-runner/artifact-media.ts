import {
  CSV_MIME,
  DOCX_MIME,
  INGEST_FORMATS,
  type IngestKind,
  PPTX_MIME,
  XLSX_MIME,
} from "@/lib/ai/ingest/formats";
import { isAppDownloadHref } from "./artifact-links";
import type { E2BArtifact } from "./code-runner.interface";
import { storageKeyFromDownloadUrl } from "./storage-key";

/** A generated file, resolved for display in the artifact panel. */
export interface ArtifactFile {
  filename: string;
  /** Attachment URL — saves the file to disk. */
  url: string;
  /**
   * Inline-rendering URL, present only for types a browser can display.
   * The attachment URL cannot be rendered in an iframe.
   */
  previewUrl?: string;
  mimeType: string;
  sizeBytes?: number;
}

/** A generated file the chat lists as a card with a Download button. */
export type DisplayArtifact = {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Download target: the durable app route, or a data: URI when the upload failed. */
  href?: string;
  /**
   * No bytes reached the user (too large, or the upload failed); the card
   * names the file but cannot download it.
   */
  unavailable: boolean;
};

/**
 * Splits generated files into ones the artifact panel can open (PDFs, images
 * and spreadsheets that reached storage) and ones the chat lists as download
 * cards.
 *
 * A produced file used to surface only as a small download chip inside the
 * execution log, which is collapsed by default — so a user could ask for an
 * Excel file, get one, and never see it. Every non-panel file is a card
 * outside that disclosure now, including one that could not be delivered
 * (too large, upload failed): it is named without a button so the user knows
 * what happened.
 *
 * Only artifacts that made it to storage can be opened in the panel: the
 * viewer takes a URL, and the base64 fallback (used when the upload failed)
 * has nothing to point an iframe at, so it stays a download card.
 */
export function splitArtifactsForPanel(artifacts: E2BArtifact[]): {
  files: ArtifactFile[];
  downloads: DisplayArtifact[];
} {
  const files: ArtifactFile[] = [];
  const downloads: DisplayArtifact[] = [];

  for (const artifact of artifacts) {
    const type = artifactPreviewType(artifact);

    if (type && artifact.url) {
      files.push({
        filename: artifact.filename,
        url: artifact.url,
        // Only a type the browser renders from a URL gets one. Everything
        // else is read by the panel through a route that parses it by storage
        // key, and asking for an inline disposition would do nothing: the
        // download route's allowlist deliberately excludes those types.
        previewUrl:
          type === "pdf" || type === "image"
            ? inlinePreviewUrl(artifact.url)
            : undefined,
        mimeType: artifact.mimeType ?? mimeFallbackFor(type, artifact.filename),
        sizeBytes: sizeOf(artifact),
      });
      // Not also listed as a card — the panel carries its own download
      // control, so a second entry would be noise.
      continue;
    }

    const href =
      artifact.url ??
      (artifact.contentBase64
        ? `data:${artifact.mimeType ?? "application/octet-stream"};base64,${artifact.contentBase64}`
        : undefined);
    // Nothing to download and no reason given: nothing to show either.
    if (!href && !artifact.error) continue;

    downloads.push({
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      sizeBytes: sizeOf(artifact),
      href,
      unavailable: !href,
    });
  }

  return { files, downloads };
}

/** The app route that serves stored artifacts; the only URL shape we rewrite. */
const STORAGE_DOWNLOAD_PATH = "/api/storage/download";

/**
 * Point a preview at the inline variant of the durable download route.
 *
 * `/api/storage/download` answers with an attachment disposition by default,
 * and a browser will not render an attachment inside an iframe — the viewer
 * showed a blank frame and, because `onError` never fires for that, sat on
 * its loading state. Asking for `disposition=inline` is what makes the
 * preview render at all.
 *
 * Every other URL (a data: fallback, a signed bucket URL, an MCP-supplied
 * link) is returned untouched: the param means nothing to them, and appending
 * it to a signed URL can invalidate the signature.
 */
export function inlinePreviewUrl(url: string): string {
  if (!url.startsWith(STORAGE_DOWNLOAD_PATH)) return url;
  if (/[?&]disposition=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}disposition=inline`;
}

// Re-exported so existing callers keep one import path for these.
export { CSV_MIME, DOCX_MIME, PPTX_MIME, XLSX_MIME };

/**
 * How the panel can render a file. `IngestKind` plus `image`, which the
 * browser draws itself and so is not a format the server ever parses.
 */
export type ArtifactPreviewType = IngestKind | "image";

/**
 * What the panel can open this artifact as, if anything.
 *
 * The mime type is derived from the filename extension at collection time, so
 * fall back to the extension when it is missing or generic.
 *
 * SVG is deliberately absent: the storage route refuses to serve it inline
 * (it scripts in this origin), so a preview would render nothing.
 *
 * A server-rendered kind — a workbook, a document, a deck, a text file — only
 * counts when it is on the app's own download route. The panel previews one by
 * asking a route to parse it by storage key, and a foreign URL or an inline
 * base64 fallback has no key to give it.
 */
export function artifactPreviewType(
  artifact: E2BArtifact,
): ArtifactPreviewType | undefined {
  const mime = artifact.mimeType?.toLowerCase() ?? "";
  const name = artifact.filename?.toLowerCase() ?? "";

  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === "image/svg+xml" || name.endsWith(".svg")) return undefined;
  if (mime.startsWith("image/")) return "image";
  if (/\.(png|jpe?g|gif|webp)$/.test(name)) return "image";

  if (!isAppDownloadHref(artifact.url)) return undefined;
  return previewKindForFile({
    mimeType: mime || mimeFallbackForFilename(name),
  });
}

/**
 * A mime for an artifact that arrived without one.
 *
 * The filename decides, not the kind: several formats share a kind now, so a
 * CSV that lost its mime must not be labelled xlsx and sent to a parser that
 * cannot read it.
 */
function mimeFallbackFor(
  type: ArtifactPreviewType,
  filename: string | undefined,
): string {
  const fromName = mimeFallbackForFilename(filename ?? "");
  if (fromName !== "application/octet-stream") return fromName;
  if (type === "pdf") return "application/pdf";
  return "image/png";
}

/**
 * How the panel should render this file, from its mime alone.
 *
 * Replaces three hand-written `mimeType === XLSX_MIME` comparisons that had to
 * be kept in step by hand (the viewer, the panel header icon and the chip
 * icon). Mime only: by the time a file reaches the panel it always has one,
 * and the extension has already had its say in `mimeFallbackFor`.
 */
export function previewKindForFile(file: {
  mimeType: string;
  previewUrl?: string;
}): ArtifactPreviewType | undefined {
  const mime = file.mimeType?.toLowerCase() ?? "";
  if (mime === "application/pdf") return "pdf";
  // SVG scripts in this origin, so the download route refuses to serve it
  // inline and a preview would render nothing.
  if (mime === "image/svg+xml") return undefined;
  if (mime.startsWith("image/")) return "image";
  const format = INGEST_FORMATS.find((entry) => entry.mimes.includes(mime));
  return format?.kind;
}

/**
 * Whether the panel has a viewer for this file, rather than only a download.
 *
 * The panel branches on the kind and the chip labels itself from this, so the
 * two cannot disagree: a chip that promises a view and lands on a download
 * card is worse than one that promised nothing. Widen this and the branch in
 * `FilePanelContent` together.
 */
export function canPreviewInPanel(file: {
  mimeType: string;
  url?: string;
  previewUrl?: string;
}): boolean {
  const kind = previewKindForFile(file);
  if (!kind) return false;
  // Everything but a PDF and an image is read server-side and drawn, so it
  // needs no preview URL — only a storage key, which the panel takes from the
  // download URL.
  if (kind === "pdf" || kind === "image") return Boolean(file.previewUrl);
  return isAppDownloadHref(file.url);
}

/**
 * Turn an uploaded attachment into the same shape a generated file uses, so
 * both open in one panel and download through one route.
 *
 * Two things make this work without a new backend. TUS writes uploads to
 * `userId/uuid-name.ext`, the identical key shape generated artifacts use, so
 * `/api/storage/download` and `/api/storage/sheet` already accept an upload's
 * key under the same ownership check. And the URL persisted on the message is
 * rewritten here rather than at the source: images are handed to the model as
 * an absolute URL it fetches itself, and threads already hold the old shape,
 * so changing what is stored would break both.
 *
 * Returns null for anything that is not one of our storage objects — a pasted
 * link, a data: URI — which keeps those on the plain card they render today.
 */
export function attachmentToArtifactFile(attachment: {
  url?: string;
  filename?: string;
  mediaType?: string;
}): ArtifactFile | null {
  const key = storageKeyFromDownloadUrl(attachment.url ?? "");
  if (!key) return null;

  const filename = attachment.filename || key.split("/").pop() || "attachment";
  const url = `/api/storage/download?key=${encodeURIComponent(key)}`;
  const mimeType =
    attachment.mediaType && attachment.mediaType !== "application/octet-stream"
      ? attachment.mediaType
      : mimeFallbackForFilename(filename);

  const kind = previewKindForFile({ mimeType });
  return {
    filename,
    url,
    // Only a type the browser renders from a URL gets one; everything else is
    // read server-side and drawn, or is a download.
    previewUrl:
      kind === "pdf" || kind === "image" ? inlinePreviewUrl(url) : undefined,
    mimeType,
  };
}

/** Best-effort mime from an extension, for an upload that arrived without one. */
function mimeFallbackForFilename(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const format = INGEST_FORMATS.find((entry) => entry.exts.includes(ext));
  if (format) return format.mimes[0];
  if (/^(png|jpe?g|gif|webp)$/.test(ext)) {
    return `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  return "application/octet-stream";
}

/**
 * The storage key behind an app download URL, for the routes that take one.
 * Null for anything else, which is what keeps a foreign URL out of them.
 */
export function artifactStorageKey(url: string | undefined): string | null {
  if (!isAppDownloadHref(url)) return null;
  const query = url.slice(url.indexOf("?"));
  return new URLSearchParams(query).get("key");
}

/**
 * Byte length: measured at collection time when the collector recorded it,
 * otherwise derived from the inline base64 fallback, otherwise unknown.
 */
function sizeOf(artifact: E2BArtifact): number | undefined {
  if (typeof artifact.sizeBytes === "number") return artifact.sizeBytes;
  if (!artifact.contentBase64) return undefined;
  return Math.round((artifact.contentBase64.length * 3) / 4);
}
