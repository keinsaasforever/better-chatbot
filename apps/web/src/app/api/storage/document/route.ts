import { withAuth } from "auth/route-guard";
import { FileNotFoundError } from "lib/errors";
import {
  MAX_DOCUMENT_HTML_BYTES,
  MAX_PREVIEW_BYTES,
} from "lib/file-ingest/preview-limits";
import { serverFileStorage } from "lib/file-storage";
import logger from "lib/logger";
import { NextResponse } from "next/server";

// mammoth and jszip need node built-ins, so this can never run on edge.
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Reads a stored document so the artifact panel can show it.
 *
 * GET /api/storage/document?key=<userId>/<uuid>-<filename>.<ext>
 *
 * The guard order is copied from `/api/storage/sheet` rather than abstracted:
 * these two are the only routes that hand a user's stored bytes to a parser,
 * and a shared helper is a single place to get an ownership check subtly wrong
 * for both. Cheap rejections come first so nothing heavy is imported for a
 * request that was never going to be served, and there is exactly one storage
 * round trip — `exists()` is a Supabase `list` over the user's whole folder,
 * and its cost grows with how many files they have ever uploaded.
 *
 * Errors carry a `reason` the panel branches on, so it can say "too large"
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

  const kind = previewKindForKey(key);
  if (!kind) {
    return NextResponse.json(
      { error: "This file type cannot be previewed", reason: "unsupported" },
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

  if (isPreviewDisabled(kind)) {
    return NextResponse.json(
      { error: "Previews are switched off", reason: "disabled" },
      { status: 503 },
    );
  }

  try {
    const buffer = await serverFileStorage.download(key);

    if (buffer.byteLength > MAX_PREVIEW_BYTES[kind]) {
      return NextResponse.json(
        { error: "This file is too large to preview", reason: "too_large" },
        { status: 413 },
      );
    }

    const body = await render(kind, buffer);
    if (!body) {
      return NextResponse.json(
        { error: "This file is too large to preview", reason: "too_large" },
        { status: 413 },
      );
    }

    return NextResponse.json(body, {
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
    logger.error(`[storage] document preview failed key=${key}`, err);
    return NextResponse.json(
      { error: "The file could not be read", reason: "unreadable" },
      { status: 500 },
    );
  }
});

type PreviewKind = "document" | "slides" | "text";

/**
 * What this route will render, by extension.
 *
 * An allowlist rather than a mime check: the mime on a request is whatever the
 * caller wrote, while the extension is part of the storage key the upload was
 * written under.
 */
function previewKindForKey(key: string): PreviewKind | null {
  const extension = key.toLowerCase().split(".").pop() ?? "";
  if (extension === "docx") return "document";
  if (extension === "pptx") return "slides";
  if (["txt", "md", "json"].includes(extension)) return "text";
  return null;
}

/**
 * Read at request time, not at module scope: Next can bake a build-time value
 * into a server module, which is how an env-driven switch silently stops
 * switching.
 */
function isPreviewDisabled(kind: PreviewKind): boolean {
  return (process.env.PREVIEW_DISABLED_KINDS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes(kind);
}

async function render(kind: PreviewKind, buffer: Buffer) {
  if (kind === "slides") {
    // Imported here, not at module scope: every rejection above returns
    // without needing a parser, so none of this is on the cold-start path.
    const { parsePptxPreview } = await import("lib/file-ingest/pptx");
    const preview = await parsePptxPreview(buffer);
    return { kind, ...preview };
  }

  if (kind === "text") {
    const { decodeTextFile } = await import("lib/file-ingest/text");
    const { MAX_PREVIEW_TEXT_CHARS } = await import(
      "lib/file-ingest/preview-limits"
    );
    return {
      kind,
      ...decodeTextFile(buffer, { maxChars: MAX_PREVIEW_TEXT_CHARS }),
    };
  }

  const { renderDocxHtml } = await import("lib/file-ingest/docx-html");
  const html = await renderDocxHtml(buffer);
  // Over the cap the answer is the download, not a document cut in half: the
  // reader cannot tell a truncated contract from a short one.
  if (html.length > MAX_DOCUMENT_HTML_BYTES) return null;
  return { kind, html, truncated: false };
}
