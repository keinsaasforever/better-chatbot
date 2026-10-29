/**
 * What the artifact panel is allowed to load.
 *
 * Separate from `lib/ai/ingest/limits.ts` on purpose: those bound what goes
 * into a prompt, where a row is tokens paid before the answer starts. These
 * bound what goes into a browser, where a hundred rows render instantly. The
 * shared constraint is the server: both parse on an instance Fluid Compute
 * shares with live requests, so both cap bytes before a parser runs.
 *
 * Dependency-free: imported by the preview routes and by the client.
 */

/** Bytes downloaded before a preview parser is allowed to run. */
export const MAX_PREVIEW_BYTES: Record<"document" | "slides" | "text", number> =
  {
    // mammoth materialises the document and its HTML.
    document: 10 * 1024 * 1024,
    // Only slide XML is inflated, never media — see `ooxml.ts`.
    slides: 15 * 1024 * 1024,
    text: 5 * 1024 * 1024,
  };

/**
 * Rendered HTML returned for a .docx.
 *
 * Bounds the JSON on the wire and the DOM the panel builds from it, which are
 * two different costs that a single "document size" number would conflate.
 * Over the cap the panel offers the download instead: a contract cut in half
 * is worse than one the reader knows they have to open.
 */
export const MAX_DOCUMENT_HTML_BYTES = 1024 * 1024;

/** Characters of a .txt/.md/.json shown in the panel. */
export const MAX_PREVIEW_TEXT_CHARS = 200_000;
