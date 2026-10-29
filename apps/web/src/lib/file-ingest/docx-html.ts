import type { Buffer } from "node:buffer";

/**
 * A .docx as HTML, for display inside a sandboxed frame.
 *
 * This repo carries no HTML sanitizer, and adding one to render a document the
 * user uploaded to themselves would be the wrong shape of defence anyway. Two
 * things make the output safe to show:
 *
 * - mammoth does not pass the document's own markup through. It walks the
 *   OOXML and emits a small, fixed vocabulary of elements — paragraphs,
 *   headings, lists, tables, runs — so there is no path from Word content to a
 *   `<script>` tag or an event-handler attribute.
 * - the panel renders the result in an iframe with `sandbox=""` and a CSP that
 *   allows nothing but inline styles, so even if the first point were wrong,
 *   nothing would execute and nothing would be fetched.
 *
 * Two things are still removed here rather than left to the frame:
 *
 * - **Images.** `convertImage` returning nothing drops them. A Word file's
 *   images are its bulk, and inlining them as base64 would put megabytes on
 *   the wire and into the DOM for a preview.
 * - **Links.** A sandboxed frame cannot open a popup or navigate the top
 *   window, but it may still navigate *itself*: clicking a link in the
 *   document would load a third-party page inside the panel. The anchors
 *   become spans, so the text survives and the navigation does not.
 */

export async function renderDocxHtml(content: Buffer): Promise<string> {
  const { default: mammoth } = await import("mammoth");

  const { value } = await mammoth.convertToHtml(
    { buffer: content },
    {
      // An empty source is what stops mammoth base64-inlining every image,
      // which is the expensive default. The tags are then dropped below.
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    },
  );

  return declaw(value);
}

/**
 * Drop the two element kinds that would still reach outward, and nothing else.
 *
 * A regex is the right tool for exactly this input and no other: the string
 * comes from mammoth, whose output vocabulary is fixed, not from arbitrary
 * HTML. It is a second line of defence behind the sandbox and the CSP, not the
 * only one.
 */
function declaw(html: string): string {
  return html
    .replace(/<a\b[^>]*>/gi, "<span>")
    .replace(/<\/a>/gi, "</span>")
    .replace(/<img\b[^>]*>/gi, "");
}
