/**
 * The one place that knows which file formats the app can read.
 *
 * Before this, the answer lived in three that could drift: the mime set in
 * `lib/ai/file-support.ts`, the media-type regex in
 * `app/api/chat/chat/slim-history.ts`, and a private `isXLikeAttachment`
 * matcher inside each ingester. A format added to one and forgotten in another
 * fails quietly — the model reads the file but the duplicate raw part is never
 * dropped, or the composer offers an action the server refuses. Everything is
 * derived from the table below instead, and `formats.test.ts` asserts the
 * derivations agree with it.
 *
 * Dependency-free on purpose: the client imports it for chip icons and preview
 * dispatch, so nothing here may reach for a parser or a node built-in.
 */

import type { ChatAttachment } from "app-types/chat";

export const CSV_MIME = "text/csv";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** How a format is read and rendered. Several formats can share a kind. */
export type IngestKind =
  | "pdf"
  | "csv"
  | "sheet"
  | "document"
  | "slides"
  | "text";

export type IngestFormatId = "pdf" | "csv" | "xlsx" | "docx" | "pptx" | "text";

export type IngestFormat = {
  readonly id: IngestFormatId;
  readonly kind: IngestKind;
  /** Mime types that identify this format, first one being canonical. */
  readonly mimes: readonly string[];
  /** Lowercase extensions, no dot. */
  readonly exts: readonly string[];
  /**
   * Whether the chat route extracts this format's content for the model.
   * A format can be listed here before it is read — `slim-history` and the
   * panel still need to recognise it — so this is not the same as "known".
   */
  readonly ingest: boolean;
};

/**
 * Every format here is read today. The `ingest` flag stays because it is how
 * the next one arrives: a format is listed first — `slim-history` and the
 * artifact panel need to recognise it before anything can parse it — and
 * switched on once it has a reader, caps and tests of its own. Operators can
 * switch one back off at runtime with `INGEST_DISABLED_FORMATS`.
 */
export const INGEST_FORMATS: readonly IngestFormat[] = [
  {
    id: "pdf",
    kind: "pdf",
    mimes: ["application/pdf"],
    exts: ["pdf"],
    ingest: true,
  },
  {
    id: "csv",
    kind: "csv",
    mimes: [CSV_MIME, "application/csv"],
    exts: ["csv"],
    ingest: true,
  },
  {
    id: "xlsx",
    kind: "sheet",
    // The legacy `.xls` mime is listed because browsers and Office send it for
    // real `.xlsx` uploads; the binary `.xls` format itself is not supported.
    mimes: [XLSX_MIME, "application/vnd.ms-excel"],
    exts: ["xlsx"],
    ingest: true,
  },
  {
    id: "docx",
    kind: "document",
    mimes: [DOCX_MIME],
    exts: ["docx"],
    ingest: true,
  },
  {
    id: "pptx",
    kind: "slides",
    mimes: [PPTX_MIME],
    exts: ["pptx"],
    ingest: true,
  },
  {
    id: "text",
    kind: "text",
    mimes: ["text/plain", "text/markdown", "application/json"],
    exts: ["txt", "md", "json"],
    ingest: true,
  },
] as const;

const byId = new Map(INGEST_FORMATS.map((format) => [format.id, format]));

export function ingestFormatById(
  id: IngestFormatId | string,
): IngestFormat | undefined {
  return byId.get(id as IngestFormatId);
}

/**
 * Formats an operator has switched off, as a comma-separated `INGEST_DISABLED_FORMATS`.
 *
 * Read per call rather than at module scope: Next can bake a build-time value
 * into a server module, which is how an env-driven switch silently stops
 * switching (see `docs/pdf-artifacts-plan.md`). The precedent is
 * `PDF_VISION_MAX_PAGES`.
 */
export function isFormatEnabled(id: IngestFormatId): boolean {
  const disabled = (process.env.INGEST_DISABLED_FORMATS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return !disabled.includes(id);
}

/** Mime types whose content the chat route extracts for the model. */
export const INGEST_SUPPORTED_MIME: ReadonlySet<string> = new Set(
  INGEST_FORMATS.filter((format) => format.ingest).flatMap(
    (format) => format.mimes,
  ),
);

/**
 * Every mime this app recognises, ingested or not.
 *
 * `slim-history` uses this to drop a raw file part on an older turn once a text
 * preview of the same document exists, so it has to cover formats that are
 * merely recognised too — otherwise the same bytes are billed twice.
 */
export const INGESTED_MEDIA_TYPE: RegExp = new RegExp(
  `^(${INGEST_FORMATS.flatMap((format) => format.mimes)
    .map((mime) => mime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})`,
  "i",
);

/** Formats the composer's Summarize action can actually send somewhere. */
export const SUMMARIZE_SUPPORTED_MIME: ReadonlySet<string> = new Set(
  ingestFormatById("csv")?.mimes ?? [],
);

function extensionOf(name: string): string {
  // Query and fragment first, then the last path segment: `a.csv?x=1.pdf` is a
  // CSV, and `user/uuid-deck.pptx` is a deck rather than a directory.
  const withoutQuery = name.split(/[?#]/)[0] ?? name;
  const basename = withoutQuery.split(/[/\\]/).pop() ?? withoutQuery;
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? "" : basename.slice(dot + 1).toLowerCase();
}

/**
 * Identify an attachment's format from what the client claimed.
 *
 * Three signals, in descending trustworthiness: the declared mime, the file
 * extension, and a `contentType=` query parameter some upload paths append.
 * This mirrors what each ingester used to do privately; the point
 * of hoisting it is that every format now matches the same way.
 *
 * None of these are authority over the *bytes* — a parser still rejects a file
 * that is not what it claims. This only decides which parser to try.
 */
export function formatForAttachment(
  attachment: Pick<ChatAttachment, "mediaType" | "filename" | "url">,
  key: string,
): IngestFormat | null {
  const mediaType = (attachment.mediaType || "").toLowerCase();
  if (mediaType) {
    for (const format of INGEST_FORMATS) {
      if (format.mimes.some((mime) => mime.toLowerCase() === mediaType)) {
        return format;
      }
    }
  }

  const ext = extensionOf((attachment.filename || key || "").toLowerCase());
  if (ext) {
    for (const format of INGEST_FORMATS) {
      if (format.exts.includes(ext)) return format;
    }
  }

  const url = attachment.url || "";
  if (url) {
    for (const format of INGEST_FORMATS) {
      for (const mime of format.mimes) {
        const escaped = mime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (
          new RegExp(`(^|[?&])content-?type=${escaped}(&|$)`, "i").test(url)
        ) {
          return format;
        }
      }
    }
  }

  return null;
}
